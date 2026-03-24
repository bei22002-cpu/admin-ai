import { AppDataSource } from '../database';
import { Organization } from '../database/entities/Organization';
import { logger } from '../utils/logger';

export interface PlanConfig {
  name: string;
  price: number; // monthly price in cents
  limits: {
    maxUsers: number;
    maxSkills: number;
    maxMessages: number;
  };
  features: string[];
}

export const PLANS: Record<string, PlanConfig> = {
  free: {
    name: 'Free',
    price: 0,
    limits: { maxUsers: 1, maxSkills: 3, maxMessages: 100 },
    features: ['3 Business Skills', '100 AI Messages/month', 'Basic Dashboard', 'Community Support'],
  },
  starter: {
    name: 'Starter',
    price: 2900, // $29/mo
    limits: { maxUsers: 5, maxSkills: 6, maxMessages: 1000 },
    features: ['All 6 Business Skills', '1,000 AI Messages/month', 'Full Dashboard', 'Email Support', 'Conversation History'],
  },
  pro: {
    name: 'Pro',
    price: 7900, // $79/mo
    limits: { maxUsers: 25, maxSkills: 20, maxMessages: 10000 },
    features: ['Unlimited Skills', '10,000 AI Messages/month', 'Priority Support', 'Custom Skills', 'API Access', 'Team Management'],
  },
  enterprise: {
    name: 'Enterprise',
    price: 0, // custom pricing
    limits: { maxUsers: -1, maxSkills: -1, maxMessages: -1 },
    features: ['Everything in Pro', 'Unlimited Messages', 'Dedicated Support', 'SLA', 'Custom Integrations', 'On-Premise Option'],
  },
};

export class BillingService {
  private orgRepo = AppDataSource.getRepository(Organization);

  async getPlans(): Promise<Record<string, PlanConfig>> {
    return PLANS;
  }

  async getOrgBilling(orgId: string) {
    const org = await this.orgRepo.findOneBy({ id: orgId });
    if (!org) {
      throw new Error('Organization not found');
    }

    const plan = PLANS[org.plan] || PLANS.free;
    return {
      organization: {
        id: org.id,
        name: org.name,
        plan: org.plan,
        stripeCustomerId: org.stripeCustomerId,
        stripeSubscriptionId: org.stripeSubscriptionId,
      },
      currentPlan: plan,
      limits: org.limits,
      usage: await this.getUsage(orgId),
    };
  }

  async getUsage(orgId: string) {
    // Get usage counts for the current billing period
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const messageCount = await AppDataSource
      .createQueryBuilder()
      .select('COUNT(*)', 'count')
      .from('openclaw_conversation', 'c')
      .innerJoin('user', 'u', 'u.id = c."userId"')
      .where('u."organizationId" = :orgId', { orgId })
      .andWhere('c."createdAt" >= :start', { start: startOfMonth })
      .getRawOne();

    const userCount = await AppDataSource
      .createQueryBuilder()
      .select('COUNT(*)', 'count')
      .from('user', 'u')
      .where('u."organizationId" = :orgId', { orgId })
      .getRawOne();

    return {
      messagesUsed: parseInt(messageCount?.count || '0', 10),
      usersCount: parseInt(userCount?.count || '0', 10),
      periodStart: startOfMonth.toISOString(),
    };
  }

  async changePlan(orgId: string, newPlan: string) {
    const plan = PLANS[newPlan];
    if (!plan) {
      throw new Error(`Invalid plan: ${newPlan}`);
    }

    const org = await this.orgRepo.findOneBy({ id: orgId });
    if (!org) {
      throw new Error('Organization not found');
    }

    // Update plan and limits
    org.plan = newPlan as Organization['plan'];
    org.limits = plan.limits;
    await this.orgRepo.save(org);

    logger.info(`Organization ${orgId} changed plan to ${newPlan}`);

    return {
      organization: org,
      plan: plan,
    };
  }

  async checkUsageLimit(orgId: string, resource: 'messages' | 'users' | 'skills'): Promise<boolean> {
    const org = await this.orgRepo.findOneBy({ id: orgId });
    if (!org) return false;

    const usage = await this.getUsage(orgId);
    const limits = org.limits;

    switch (resource) {
      case 'messages':
        return limits.maxMessages === -1 || usage.messagesUsed < limits.maxMessages;
      case 'users':
        return limits.maxUsers === -1 || usage.usersCount < limits.maxUsers;
      case 'skills':
        return limits.maxSkills === -1; // skills don't have usage tracking yet
      default:
        return true;
    }
  }

  // Stripe webhook handler — ready for integration when stripe package is added
  async handleStripeWebhook(event: { type: string; data: { object: Record<string, unknown> } }) {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const orgId = session.metadata as unknown as { orgId: string };
        if (orgId?.orgId) {
          await this.orgRepo.update(orgId.orgId, {
            stripeCustomerId: session.customer as string,
            stripeSubscriptionId: session.subscription as string,
          });
        }
        break;
      }
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const org = await this.orgRepo.findOneBy({
          stripeSubscriptionId: subscription.id as string,
        });
        if (org) {
          // Map Stripe price to plan
          logger.info(`Subscription updated for org ${org.id}`);
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const org = await this.orgRepo.findOneBy({
          stripeSubscriptionId: subscription.id as string,
        });
        if (org) {
          org.plan = 'free';
          org.limits = PLANS.free.limits;
          org.stripeSubscriptionId = '';
          await this.orgRepo.save(org);
          logger.info(`Subscription cancelled for org ${org.id}, downgraded to free`);
        }
        break;
      }
      default:
        logger.debug(`Unhandled Stripe event: ${event.type}`);
    }
  }
}
