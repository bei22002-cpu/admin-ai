import { Router } from 'express';
import { createOpenClawController } from '../controllers/openclaw.controller';
import { asyncHandler } from '../utils/asyncHandler';

export function createOpenClawRoutes() {
  const router = Router();
  const controller = createOpenClawController();

  // Status and configuration
  router.get('/status', asyncHandler(controller.getStatus.bind(controller)));
  router.get('/config', asyncHandler(controller.getConfig.bind(controller)));
  router.put('/config', asyncHandler(controller.updateConfig.bind(controller)));

  // Skills management
  router.get('/skills', asyncHandler(controller.getSkills.bind(controller)));
  router.get('/skills/:skillId', asyncHandler(controller.getSkill.bind(controller)));
  router.post('/skills', asyncHandler(controller.addSkill.bind(controller)));
  router.patch('/skills/:skillId/toggle', asyncHandler(controller.toggleSkill.bind(controller)));
  router.patch('/skills/:skillId/config', asyncHandler(controller.updateSkillConfig.bind(controller)));
  router.delete('/skills/:skillId', asyncHandler(controller.removeSkill.bind(controller)));

  // Skill actions
  router.post('/skills/:skillId/actions/:actionId', asyncHandler(controller.executeAction.bind(controller)));

  // Messaging
  router.post('/message', asyncHandler(controller.sendMessage.bind(controller)));

  return router;
}
