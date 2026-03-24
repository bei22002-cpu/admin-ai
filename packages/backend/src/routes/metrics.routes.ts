import { Router, Request, Response, NextFunction } from 'express';
import { MetricsController } from '../controllers/metrics.controller';
import { WebSocketService } from '../services/websocket.service';
import { AIService } from '../services/ai.service';
import { asyncHandler } from '../utils/asyncHandler';
import { authMiddleware } from '../middleware/auth.middleware';
import { cacheMiddleware } from '../middleware/cache.middleware';
import { RequestWithUser } from '../types/express';
import { User } from '../database/entities/User';
import { ParamsDictionary } from 'express-serve-static-core';
import { ParsedQs } from 'qs';

// Helper function to ensure request has user and return user ID
const ensureUser = (req: Request): string => {
  if (!req.user) {
    throw new Error('User not authenticated');
  }
  return req.user.id;
};

// Helper function to create cache key with prefix
const createCacheKey = (prefix: string) => (req: Request): string => {
  try {
    const userId = ensureUser(req);
    const queryParams = Object.entries(req.query)
      .map(([key, value]) => `${key}:${value}`)
      .join(':');
    return `${prefix}:${queryParams}:${userId}`;
  } catch (error) {
    // Fallback if user is not available
    return `${prefix}:${req.originalUrl}`;
  }
};

// Helper function to wrap controller methods with proper typing
const wrapController = (
  fn: (req: any, res: Response) => Promise<any>
) => {
  return asyncHandler(async (req, res, next) => {
    // The asyncHandler will check for authentication with requireAuth=true
    // and throw an error if user is not authenticated
    await fn(req as RequestWithUser, res);
  }, true);
};

export function createMetricsRoutes(wsService: WebSocketService) {
  const router = Router();
  const aiService = new AIService();
  const metricsController = new MetricsController(aiService, wsService);
  
  // Set the metrics controller in the WebSocket service
  wsService.setMetricsController(metricsController as any);

  // Health endpoint should be public (no auth required)
  router.get('/health', 
    cacheMiddleware({ 
      ttl: 30,
      key: (req: Request): string => `health:${req.originalUrl}`
    }),
    asyncHandler(async (req, res) => {
      await metricsController.getSystemHealth(req as RequestWithUser, res);
    }, false) // false means don't require auth
  );

  // All other routes require authentication
  router.use(authMiddleware.requireAuth);

  // Health and system metrics with caching
  router.get('/system', 
    cacheMiddleware({ 
      ttl: 60,
      key: createCacheKey('system')
    }),
    wrapController(metricsController.getSystemMetrics)
  );

  router.get('/requests', 
    cacheMiddleware({ 
      ttl: 300,
      key: createCacheKey('requests')
    }),
    wrapController(metricsController.getRequestMetrics)
  );

  router.get('/locations', 
    cacheMiddleware({ 
      ttl: 600,
      key: createCacheKey('locations')
    }),
    wrapController(metricsController.getLocationHeatmap)
  );

  router.get('/ai', 
    cacheMiddleware({ 
      ttl: 120,
      key: createCacheKey('ai')
    }),
    wrapController(metricsController.getAIMetrics)
  );

  // Insights routes with conditional caching
  router.get('/insights/performance', 
    cacheMiddleware({ 
      ttl: 300,
      condition: (req) => !req.query.realtime,
      key: createCacheKey('insights:performance')
    }),
    wrapController(metricsController.getPerformanceInsights)
  );

  router.get('/insights/security', 
    cacheMiddleware({ 
      ttl: 300,
      key: createCacheKey('insights:security')
    }),
    wrapController(metricsController.getSecurityInsights)
  );

  router.get('/insights/usage', 
    cacheMiddleware({ 
      ttl: 600,
      key: createCacheKey('insights:usage')
    }),
    wrapController(metricsController.getUsageInsights)
  );

  // Logs routes with short-lived caching
  router.get('/logs/recent', 
    cacheMiddleware({ 
      ttl: 30,
      key: createCacheKey('logs:recent')
    }),
    wrapController(metricsController.getRecentLogs)
  );

  router.get('/logs/errors', 
    cacheMiddleware({ 
      ttl: 60,
      key: createCacheKey('logs:errors')
    }),
    wrapController(metricsController.getRecentErrors)
  );

  router.get('/logs/auth', 
    cacheMiddleware({ 
      ttl: 120,
      key: createCacheKey('logs:auth')
    }),
    wrapController(metricsController.getAuthLogs)
  );

  return router;
}
