import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { WebSocketService } from './services/websocket.service';
import { createAuthRoutes } from './routes/auth.routes';
import { createAIRoutes } from './routes/ai.routes';
import { createMetricsRoutes } from './routes/metrics.routes';
import { createSettingsRoutes } from './routes/settings.routes';
import { createApiKeysRoutes } from './routes/apiKeys.routes';
import { createCrudRoutes } from './routes/crud.routes';
import { createOpenClawRoutes } from './routes/openclaw.routes';
import { createBillingRoutes } from './routes/billing.routes';
import { createHealthRoutes } from './routes/health.routes';
import configRoutes from './routes/config.routes';
import { errorHandler } from './middleware/errorHandler';
import { requestTrackerMiddleware } from './middleware/requestTracker';
import { authMiddleware } from './middleware/auth.middleware';
import { AppEngine } from './engine/AppEngine';
import { logger } from './utils/logger';
import path from 'path';

export async function createApp(wsService: WebSocketService) {
  // Initialize AppEngine
  const appEngine = await AppEngine.getInstance();
  
  const app = express();

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'img-src': ["'self'", 'data:', 'blob:'],
      },
    },
  }));
  
  app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
      ? process.env.FRONTEND_URL 
      : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Range', 'X-Content-Range']
  }));
  
  app.use(express.json());

  // Add a simple test endpoint
  app.get('/test', (req, res) => {
    res.json({ message: 'Backend server is working!' });
  });

  // Serve static files
  app.use(express.static(path.join(__dirname, '../public')));

  // Rate limiting
  const limiter = rateLimit({
    windowMs: process.env.NODE_ENV === 'production' ? 15 * 60 * 1000 : 1 * 60 * 1000, // 15 minutes in prod, 1 minute in dev
    max: process.env.NODE_ENV === 'production' ? 100 : 1000, // 100 in prod, 1000 in dev
    message: 'Too many requests, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/', limiter);  // Only apply rate limiting to API routes

  // Request tracking for API routes only
  app.use('/api/', requestTrackerMiddleware);

  // Store WebSocket service in app
  app.set('wsService', wsService);
  app.set('appEngine', appEngine);
  
  // Store AI service in app
  try {
    const aiService = appEngine.getAIService();
    app.set('aiService', aiService);
    logger.info('AI service set in Express app');
  } catch (error) {
    logger.warn('Failed to set AI service in Express app:', error);
  }

  // Health check and config routes (public)
  app.use('/health', createHealthRoutes());
  app.use('/api/config', configRoutes);

  // Public routes
  app.use('/api/auth', createAuthRoutes(wsService));
  app.use('/api', createBillingRoutes());

  // Protected routes
  app.use('/api/', authMiddleware.requireAuth);  // Apply auth middleware only to API routes
  app.use('/api/ai', createAIRoutes(wsService));
  app.use('/api/metrics', createMetricsRoutes(wsService));
  app.use('/api/settings', createSettingsRoutes(wsService));
  app.use('/api/keys', createApiKeysRoutes(wsService));
  app.use('/api/crud', createCrudRoutes(wsService));
  app.use('/api/openclaw', createOpenClawRoutes());

  // Billing routes (plans are public, billing management is protected above)

  // Handle static asset requests
  app.get('*', (req, res) => {
    if (req.url.match(/\.(ico|png|jpg|jpeg|gif|svg)$/)) {
      res.sendFile(path.join(__dirname, '../public', 'favicon.ico'));
    } else {
      res.sendStatus(404);
    }
  });

  // Error handling
  app.use(errorHandler);

  return app;
}    