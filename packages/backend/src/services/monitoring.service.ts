import { EventEmitter } from 'events';
import { CacheService } from './cache.service';
import { SystemMetricsService } from './systemMetrics.service';
import { AIService } from './ai.service';
import { WebSocketService } from './websocket.service';
import type { AIAnalysis } from '@admin-ai/shared/src/types/ai';
import type { SystemHealth, SystemMetrics } from '@admin-ai/shared/src/types/metrics';
import type { ErrorLog } from '@admin-ai/shared/src/types/error';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

const CACHE_KEYS = {
  SYSTEM_HEALTH: 'system:health',
  SYSTEM_METRICS: 'system:metrics',
  ERROR_LOGS: 'system:errors',
  AI_ANALYSIS: 'system:ai:analysis'
};

const MAX_ERROR_LOGS = 100;

export class MonitoringService extends EventEmitter {
  private static instance: MonitoringService;
  private aiService?: AIService;
  private webSocketService?: WebSocketService;
  private readonly cacheService: CacheService;
  private updateInterval?: NodeJS.Timeout;
  private lastBroadcast: number = 0;
  private readonly broadcastDebounceMs = 5000;

  private constructor() {
    super();
    this.cacheService = CacheService.getInstance();
  }

  public static getInstance(): MonitoringService {
    if (!MonitoringService.instance) {
      MonitoringService.instance = new MonitoringService();
    }
    return MonitoringService.instance;
  }

  public setAIService(service: AIService) {
    this.aiService = service;
  }

  public setWebSocketService(service: WebSocketService) {
    this.webSocketService = service;
  }

  public async initialize() {
    this.startPeriodicUpdates();
    logger.info('Monitoring service initialized');
  }

  private startPeriodicUpdates() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    this.updateInterval = setInterval(() => this.updateMetrics(), 60000);
    this.updateMetrics().catch(error => {
      logger.error('Failed to update metrics:', error);
    });
  }

  private async updateMetrics() {
    try {
      const metricsService = SystemMetricsService.getInstance();
      const rawHealth = await metricsService.getSystemHealth();
      
      const health = await this.processHealthData(rawHealth);
      const metrics = await metricsService.getSystemMetrics();
      const status = await this.processMetricsData(metrics);

      await this.cacheService.set(CACHE_KEYS.SYSTEM_HEALTH, health);
      await this.cacheService.set(CACHE_KEYS.SYSTEM_METRICS, status);

      // Broadcast updates to connected clients
      const now = Date.now();
      if (now - this.lastBroadcast >= this.broadcastDebounceMs) {
        this.webSocketService?.broadcast('metrics:update', {
          health,
          metrics: status,
          timestamp: new Date().toISOString()
        });
        this.lastBroadcast = now;
      }

      // Trigger AI analysis if available
      if (this.aiService) {
        const systemAnalysis = await this.aiService.analyzeMetrics(status);
        if (systemAnalysis) {
          await this.cacheService.set(CACHE_KEYS.AI_ANALYSIS, systemAnalysis);
          this.webSocketService?.broadcast('metrics:analysis', systemAnalysis);
        }
      }
    } catch (error) {
      logger.error('Error updating metrics:', error);

      const errorLog: ErrorLog = {
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        type: 'system_error',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        metadata: {
          severity: 'high',
          source: 'monitoring_service',
          details: {
            context: 'metrics_update'
          }
        }
      };

      const recentErrors = await this.getRecentErrors();
      const trimmedErrors = [...recentErrors, errorLog].slice(-MAX_ERROR_LOGS);
      await this.cacheService.set(CACHE_KEYS.ERROR_LOGS, trimmedErrors);

      // Broadcast error to connected clients
      this.webSocketService?.broadcast('error:new', errorLog);

      // If this is a high severity error, trigger AI analysis
      if (errorLog.metadata.severity === 'high' && this.aiService) {
        const [_, metrics] = await this.getSystemStatus();
        const errorAnalysis = await this.aiService.analyzeMetrics({
          cpuUsage: metrics?.cpuUsage || 0,
          memoryUsage: metrics?.memoryUsage || 0,
          errorCount: (metrics?.errorCount || 0) + 1,
          totalRequests: metrics?.totalRequests || 0,
          activeUsers: metrics?.activeUsers || 0,
          ...metrics
        });

        if (errorAnalysis && this.webSocketService) {
          this.webSocketService.broadcast('error:analysis', {
            error: errorLog,
            analysis: errorAnalysis
          });
        }
      }
    }
  }

  public async logError(error: ErrorLog) {
    try {
      const recentErrors = await this.getRecentErrors();
      const errorLog: ErrorLog = {
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        type: 'system_error',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        metadata: {
          severity: 'high',
          source: 'monitoring_service',
          details: {
            context: 'metrics_update'
          }
        }
      };

      const trimmedErrors = [...recentErrors, errorLog].slice(-MAX_ERROR_LOGS);
      await this.cacheService.set(CACHE_KEYS.ERROR_LOGS, trimmedErrors);

      // Broadcast error to connected clients
      this.webSocketService?.broadcast('error:new', errorLog);

      // If this is a high severity error, trigger AI analysis
      if (errorLog.metadata.severity === 'high' && this.aiService) {
        const errorAnalysis = await this.aiService.analyzeError({
          error: errorLog,
          context: {
            type: 'error',
            source: 'monitoring_service',
            timestamp: new Date().toISOString()
          }
        });

        if (errorAnalysis && this.webSocketService) {
          this.webSocketService.broadcast('error:analysis', {
            error: errorLog,
            analysis: errorAnalysis
          });
        }
      }
    } catch (err) {
      logger.error('Error logging error:', err);
    }
  }

  public async getRecentErrors(): Promise<ErrorLog[]> {
    const errors = await this.cacheService.get<ErrorLog[]>(CACHE_KEYS.ERROR_LOGS);
    return errors || [];
  }

  public async getSystemStatus(): Promise<[SystemHealth | null, SystemMetrics | null]> {
    const [health, metrics] = await Promise.all([
      this.cacheService.get<SystemHealth>(CACHE_KEYS.SYSTEM_HEALTH),
      this.cacheService.get<SystemMetrics>(CACHE_KEYS.SYSTEM_METRICS)
    ]);

    return [health, metrics];
  }

  private async processHealthData(rawHealth: SystemHealth): Promise<SystemHealth> {
    return {
      timestamp: new Date().toISOString(),
      score: rawHealth.score ?? 100,
      services: rawHealth.services || {},
      resources: {
        cpu: {
          usage: rawHealth.resources?.cpu?.usage || 0,
          status: rawHealth.resources?.cpu?.status || 'normal'
        },
        memory: {
          usage: rawHealth.resources?.memory?.usage || 0,
          status: rawHealth.resources?.memory?.status || 'normal'
        },
        disk: {
          usage: rawHealth.resources?.disk?.usage || 0,
          status: rawHealth.resources?.disk?.status || 'normal'
        }
      }
    };
  }

  private async processMetricsData(metrics: SystemMetrics): Promise<SystemMetrics> {
    return {
      cpuUsage: metrics.cpuUsage,
      memoryUsage: metrics.memoryUsage,
      errorCount: metrics.errorCount,
      totalRequests: metrics.totalRequests,
      activeUsers: metrics.activeUsers,
      cpu: metrics.cpu,
      memory: metrics.memory,
      disk: metrics.disk
    };
  }
}
