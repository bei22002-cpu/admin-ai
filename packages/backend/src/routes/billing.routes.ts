import { Router } from 'express';
import { billingController } from '../controllers/billing.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { asyncHandler } from '../utils/asyncHandler';

export function createBillingRoutes() {
  const router = Router();

  // Public route — get available plans
  router.get('/plans', asyncHandler(billingController.getPlans));

  // Stripe webhook — no auth (verified by Stripe signature)
  router.post('/webhook', asyncHandler(billingController.handleWebhook));

  // Protected routes
  router.use(authMiddleware.requireAuth);
  router.get('/billing', asyncHandler(billingController.getOrgBilling));
  router.post('/billing/change-plan', asyncHandler(billingController.changePlan));

  return router;
}
