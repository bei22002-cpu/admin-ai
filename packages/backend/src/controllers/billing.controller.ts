import { Request, Response } from 'express';
import { BillingService } from '../services/billing.service';

const billingService = new BillingService();

export const billingController = {
  async getPlans(_req: Request, res: Response) {
    const plans = await billingService.getPlans();
    res.json({ plans });
  },

  async getOrgBilling(req: Request, res: Response) {
    const user = (req as Record<string, unknown>).user as { organizationId?: string };
    if (!user?.organizationId) {
      return res.json({
        currentPlan: { name: 'Free', price: 0 },
        limits: { maxUsers: 1, maxSkills: 3, maxMessages: 100 },
        usage: { messagesUsed: 0, usersCount: 1 },
        message: 'No organization linked. Create or join an organization to manage billing.',
      });
    }

    const billing = await billingService.getOrgBilling(user.organizationId);
    res.json(billing);
  },

  async changePlan(req: Request, res: Response) {
    const user = (req as Record<string, unknown>).user as { organizationId?: string };
    if (!user?.organizationId) {
      return res.status(400).json({ error: 'No organization linked' });
    }

    const { plan } = req.body;
    if (!plan) {
      return res.status(400).json({ error: 'Plan is required' });
    }

    const result = await billingService.changePlan(user.organizationId, plan);
    res.json(result);
  },

  async handleWebhook(req: Request, res: Response) {
    // Stripe webhook endpoint — ready for integration
    // In production, verify the webhook signature with Stripe secret
    const event = req.body;

    if (!event?.type) {
      return res.status(400).json({ error: 'Invalid webhook event' });
    }

    await billingService.handleStripeWebhook(event);
    res.json({ received: true });
  },
};
