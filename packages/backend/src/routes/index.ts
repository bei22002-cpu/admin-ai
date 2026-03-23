import { Router } from 'express';
import { WebSocketService } from '../services/websocket.service';
import { createAuthRoutes } from './auth.routes';
import { createAIRoutes } from './ai.routes';
import { createMetricsRoutes } from './metrics.routes';
import { createSettingsRoutes } from './settings.routes';
import { createApiKeysRoutes } from './apiKeys.routes';
import { createOpenClawRoutes } from './openclaw.routes';

export function createRoutes(wsService: WebSocketService) {
  const router = Router();

  // Mount all routes
  router.use('/auth', createAuthRoutes(wsService));
  router.use('/ai', createAIRoutes(wsService));
  router.use('/metrics', createMetricsRoutes(wsService));
  router.use('/settings', createSettingsRoutes(wsService));
  router.use('/api-keys', createApiKeysRoutes(wsService));
  router.use('/openclaw', createOpenClawRoutes());

  return router;
}  