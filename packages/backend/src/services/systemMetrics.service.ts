import os from 'os';
import * as fs from 'fs';
import { logger } from '../utils/logger';
import { AppDataSource } from '../database';
import { WebSocketService } from './websocket.service';
import { AIService } from './ai.service';
import { BaseLog } from '@admin-ai/shared/src/types/logs';
import { SystemMetrics as DBSystemMetrics } from '../database/entities/SystemMetrics';
import { ErrorLog as DBErrorLog } from '../database/entities/ErrorLog';
import { RequestLocation as DBRequestLocation } from '../database/entities/RequestLocation';
import { Repository, MoreThan } from 'typeorm';
import { EventEmitter } from 'events';
import { AISettingsService } from './aiSettings.service';
import { AppError } from '../middleware/errorHandler';
import { SecurityEvent } from '../database/entities/SecurityEvent';
import { v4 as uuidv4 } from 'uuid';
import { CacheService } from './cache.service';
import type { AIAnalysis } from '@admin-ai/shared/src/types/ai';
import type { SystemHealth, SystemMetrics } from '@admin-ai/shared/src/types/metrics';
import type { ErrorLog } from '@admin-ai/shared/src/types/error';
import type { WebSocketEvents } from '@admin-ai/shared/src/types/websocket';
import { checkDiskSpace } from '../utils/diskSpaceChecker';

interface AuthLog {
  timestamp: string;
  userId: string;
  action: 'login' | 'logout' | 'failed_login' | 'register';
  ip: string;
  userAgent: string;
  location?: {
    country: string;
    city: string;
    latitude: number;
    longitude: number;
  };
}

interface RequestMetric {
  timestamp: string;
  path: string;
  method: string;
  statusCode: number;
  duration: number;
  ip: string;
  location?: {
    country: string;
    city: string;
    latitude: number;
    longitude: number;
  };
  userAgent?: string;
  referer?: string;
  query?: string;
}

interface RequestLocation {
  ip: string;
  latitude: number;
  longitude: number;
  count: number;
  lastSeen: string;
  city: string;
  country: string;
  uniqueIps: number;
}

const MAX_ERROR_LOGS = 100;

const CACHE_KEYS = {
  SYSTEM_HEALTH: 'system:health',
  SYSTEM_METRICS: 'system:metrics',
  ERROR_LOGS: 'system:errors',
  AI_ANALYSIS: 'system:ai:analysis'
};

interface SystemMetric {
  timestamp: Date;
  type: string;
  value: number;
  metadata?: Record<string, any>;
}

interface AIActivity {
  type: string;
  timestamp: Date;
  data: any;
  metadata?: Record<string, any>;
}

interface SystemNotification {
  type: string;
  severity: string;
  message: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

interface ServiceHealth {
  status: 'up' | 'down' | 'degraded';
  lastCheck: string;
  message?: string;
}

export class SystemMetricsService extends EventEmitter {
  private static instance: SystemMetricsService;
  private startTime: number;
  private authLogs: AuthLog[] = [];
  private requestMetrics: RequestMetric[] = [];
  private requestLocations: Map<string, RequestLocation> = new Map();
  private locationIps: Map<string, Set<string>> = new Map();
  private maxLogsToKeep = 1000;
  private readonly cleanupInterval = 3600000; // 1 hour in milliseconds
  private wsService: WebSocketService | null = null;
  private aiService: AIService | null = null;
  private aiSettingsService?: AISettingsService;
  private startMetricsCollection(): void {
    logger.info('Starting metrics collection');
    // Initialize metrics collection
    this.collectAndPublishMetrics().catch(error => {
      logger.error('Failed to collect and publish initial metrics:', error);
    });
  }
  private metricsInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private metricsRepository!: Repository<DBSystemMetrics>;
  private errorRepository!: Repository<DBErrorLog>;
  private locationRepository!: Repository<DBRequestLocation>;
  private securityRepository!: Repository<SecurityEvent>;
  private isInitialized = false;
  private readonly METRICS_INTERVAL = 60000; // 1 minute
  private readonly cacheService: CacheService;
  private lastBroadcast: number = 0;
  private readonly broadcastDebounceMs = 5000;
  private kafkaService: any = null; // Add Kafka service
  private lastCPUMeasurements: { idle: number; total: number } | null = null;

  private constructor() {
    super();
    this.startTime = Date.now();
    this.cacheService = CacheService.getInstance();
    this.locationBroadcastInterval = null;
  }

  private locationBroadcastInterval: NodeJS.Timeout | null;

  private async startLocationBroadcast(): Promise<void> {
    if (this.locationBroadcastInterval) {
      return;
    }

    this.locationBroadcastInterval = setInterval(async () => {
      try {
        const locations = await this.getRecentLocations();
        if (this.wsService && locations.length > 0) {
          this.wsService.broadcast('globe:locations', {
            locations,
            timestamp: new Date().toISOString()
          });
        }
      } catch (error) {
        logger.error('Error broadcasting locations:', error);
      }
    }, 10000); // Broadcast every 10 seconds
  }

  private async getRecentLocations(): Promise<Array<{
    ip: string;
    latitude: number;
    longitude: number;
    city: string;
    country: string;
    count: number;
    lastSeen: string;
  }>> {
    try {
      const locations = await this.locationRepository
        .createQueryBuilder('location')
        .select([
          'location.ip',
          'location.latitude',
          'location.longitude',
          'location.city',
          'location.country',
          'COUNT(location.ip) as count',
          'MAX(location.timestamp) as lastSeen'
        ])
        .where('location.timestamp > :cutoff', {
          cutoff: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
        })
        .groupBy('location.ip')
        .addGroupBy('location.latitude')
        .addGroupBy('location.longitude')
        .addGroupBy('location.city')
        .addGroupBy('location.country')
        .getRawMany();

      return locations.map(loc => ({
        ip: loc.location_ip,
        latitude: parseFloat(loc.location_latitude),
        longitude: parseFloat(loc.location_longitude),
        city: loc.location_city,
        country: loc.location_country,
        count: parseInt(loc.count),
        lastSeen: new Date(loc.lastSeen).toISOString()
      }));
    } catch (error) {
      logger.error('Error fetching recent locations:', error);
      return [];
    }
  }

  public async trackLocation(location: {
    ip: string;
    latitude: number;
    longitude: number;
    city: string;
    country: string;
    method: string;
    path: string;
    statusCode: number;
    duration: number;
    userId?: string;
  }): Promise<void> {
    try {
      const requestLocation = this.locationRepository.create({
        ...location,
        timestamp: new Date(),
        requestId: uuidv4()
      });

      await this.locationRepository.save(requestLocation);

      if (this.wsService) {
        this.wsService.broadcast('globe:location:new', {
          location: {
            ip: location.ip,
            latitude: location.latitude,
            longitude: location.longitude,
            city: location.city,
            country: location.country,
            timestamp: new Date().toISOString()
          }
        });
      }
    } catch (error) {
      logger.error('Error tracking location:', error);
    }
  }

  public static getInstance(): SystemMetricsService {
    if (!SystemMetricsService.instance) {
      SystemMetricsService.instance = new SystemMetricsService();
    }
    return SystemMetricsService.instance;
  }

  public async initializeServices(wsService: WebSocketService, aiService: AIService | null = null): Promise<void> {
    if (this.isInitialized) {
      logger.info('System metrics service already initialized');
      return;
    }

    try {
      await this.ensureDatabaseConnection();
      await this.initializeRepositories();
      
      this.wsService = wsService;
      this.aiService = aiService;
      
      // Initialize AISettingsService
      const aiSettingsService = await AISettingsService.getInstance();
      if (aiSettingsService instanceof AISettingsService) {
        this.aiSettingsService = aiSettingsService;
      }

      // Initialize Kafka service
      try {
        this.kafkaService = require('./kafka.service').kafkaService;
        logger.info('Kafka service initialized for SystemMetricsService');
      } catch (error) {
        logger.warn('Failed to initialize Kafka service for SystemMetricsService:', error);
      }

      await this.startCollectingMetrics();
      
      this.isInitialized = true;
      logger.info('System metrics service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize system metrics service:', error);
      throw new AppError(500, 'Failed to initialize system metrics service');
    }
  }

  private async ensureDatabaseConnection(): Promise<void> {
    const maxRetries = 3;
    let retries = 0;

    while (retries < maxRetries) {
      try {
        if (!AppDataSource.isInitialized) {
          await AppDataSource.initialize();
          logger.info('Database connection established successfully');
          return;
        }

        await AppDataSource.query('SELECT 1');
        logger.debug('Database connection verified');
        return;
      } catch (error) {
        retries++;
        logger.error(`Database connection attempt ${retries} failed:`, error);

        if (retries < maxRetries) {
          const delay = retries * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw new AppError(500, 'Failed to establish database connection');
  }

  private async initializeRepositories(): Promise<void> {
    if (!AppDataSource.isInitialized) {
      throw new AppError(500, 'Database connection must be initialized before repositories');
    }
    
    try {
      this.metricsRepository = AppDataSource.getRepository(DBSystemMetrics);
      this.errorRepository = AppDataSource.getRepository(DBErrorLog);
      this.locationRepository = AppDataSource.getRepository(DBRequestLocation);
      this.securityRepository = AppDataSource.getRepository(SecurityEvent);
      logger.info('Repositories initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize repositories:', error);
      throw new AppError(500, 'Failed to initialize repositories');
    }
  }

  private async startCollectingMetrics(): Promise<void> {
    // Start collecting metrics
    this.startMetricsCollection();
    
    // Start location broadcast
    this.startLocationBroadcast();

    this.metricsInterval = setInterval(() => {
      this.collectAndPublishMetrics().catch(error => {
        logger.error('Failed to collect and publish system metrics:', error);
      });
    }, this.METRICS_INTERVAL);

    this.healthCheckInterval = setInterval(() => {
      this.getSystemHealth().catch(error => {
        logger.error('Failed to check system health:', error);
      });
    }, this.METRICS_INTERVAL);
  }

  private async collectAndPublishMetrics(): Promise<void> {
    try {
      // Collect all metrics data
      const [
        health,
        metrics,
        recentLogs,
        errorLogs,
        authLogs,
        requestMetrics,
        locations
      ] = await Promise.all([
        this.getSystemHealth(),
        this.getSystemMetrics(),
        this.getRecentLogs ? this.getRecentLogs() : [],
        this.getRecentErrors(),
        this.getAuthLogs(),
        this.getCurrentMetrics(),
        this.getRequestLocations ? this.getRequestLocations() : []
      ]);

      // Calculate health score
      const cpuScore = health.resources.cpu.status === 'normal' ? 100 :
        health.resources.cpu.status === 'warning' ? 70 : 40;
      const memoryScore = health.resources.memory.status === 'normal' ? 100 :
        health.resources.memory.status === 'warning' ? 70 : 40;
      const diskScore = health.resources.disk.status === 'normal' ? 100 :
        health.resources.disk.status === 'warning' ? 70 : 40;

      const healthScore = Math.round((cpuScore + memoryScore + diskScore) / 3);
      
      const responseHealth = {
        ...health,
        score: healthScore,
        status: healthScore >= 80 ? 'healthy' : healthScore >= 60 ? 'warning' : 'critical'
      };

      // Prepare complete metrics package
      const completeMetrics = {
        ...metrics,
        requests: requestMetrics,
        locations,
        logs: recentLogs,
        errors: errorLogs,
        authLogs
      };

      // Publish to Kafka if available
      if (this.kafkaService) {
        await this.kafkaService.publishSystemMetrics({
          health: responseHealth,
          metrics: completeMetrics
        });
        
        // Also publish individual updates for specific widgets
        await this.kafkaService.publishDashboardUpdate('health', responseHealth);
        await this.kafkaService.publishDashboardUpdate('metrics', metrics);
        await this.kafkaService.publishDashboardUpdate('logs', recentLogs);
        await this.kafkaService.publishDashboardUpdate('errors', errorLogs);
        await this.kafkaService.publishDashboardUpdate('auth', authLogs);
        await this.kafkaService.publishDashboardUpdate('requests', requestMetrics);
        await this.kafkaService.publishDashboardUpdate('locations', locations);
      }
      
      // Also broadcast directly via WebSocket for immediate updates
      if (this.wsService) {
        this.wsService.broadcast('metrics:update', {
          health: responseHealth,
          metrics: completeMetrics,
          timestamp: new Date().toISOString()
        });
        
        this.wsService.broadcast('metrics:status', {
          health: responseHealth,
          metrics: completeMetrics,
          timestamp: new Date().toISOString()
        });
        this.wsService.broadcast('metrics:update', {
          health: responseHealth,
          metrics: completeMetrics,
          timestamp: new Date().toISOString()
        });
      }
      
      logger.debug('Collected and published metrics data');
    } catch (error) {
      logger.error('Error collecting and publishing metrics:', error);
    }
  }

  private async getDatabaseHealth(): Promise<{ status: 'up' | 'down' | 'degraded'; lastCheck: string; message?: string; }> {
    try {
      // Check database connection
      await this.metricsRepository.query('SELECT 1');
      return {
        status: 'up',
        lastCheck: new Date().toISOString(),
        message: 'Database is healthy'
      };
    } catch (error) {
      return {
        status: 'down',
        lastCheck: new Date().toISOString(),
        message: 'Database connection failed'
      };
    }
  }

  private async getCacheHealth(): Promise<ServiceHealth> {
    try {
      // Check cache connection
      const isConnected = await this.cacheService.isReady();
      if (isConnected) {
        return {
          status: 'up',
          lastCheck: new Date().toISOString(),
          message: 'Cache is healthy'
        };
      }
      return {
        status: 'down',
        lastCheck: new Date().toISOString(),
        message: 'Cache is not connected'
      };
    } catch (error) {
      return {
        status: 'down',
        lastCheck: new Date().toISOString(),
        message: 'Cache connection failed'
      };
    }
  }

  private async getQueueHealth(): Promise<ServiceHealth> {
    try {
      // Check queue connection (if using Kafka)
      if (this.kafkaService && await this.kafkaService.isConnected()) {
        return {
          status: 'up',
          lastCheck: new Date().toISOString(),
          message: 'Queue is healthy'
        };
      }
      return {
        status: 'down',
        lastCheck: new Date().toISOString(),
        message: 'Queue service not configured'
      };
    } catch (error) {
      return {
        status: 'down',
        lastCheck: new Date().toISOString(),
        message: 'Queue connection failed'
      };
    }
  }

  public async getSystemHealth(): Promise<SystemHealth> {
    try {
      const cpuUsage = await this.getCPUUsage();
      const memoryUsage = await this.getMemoryUsage();
      const diskUsage = await this.getDiskUsage();
      
      // Normalize percentages to ensure they don't exceed 100%
      const normalizedCPU = Math.min(100, Math.max(0, cpuUsage * 100));
      const normalizedMemory = Math.min(100, Math.max(0, memoryUsage * 100));
      const normalizedDisk = Math.min(100, Math.max(0, diskUsage * 100));
      
      // Calculate overall health score (0-100)
      const healthScore = Math.round((normalizedCPU + normalizedMemory + normalizedDisk) / 3);
      
      // Determine status based on health score
      let status: 'healthy' | 'warning' | 'error';
      if (healthScore >= 80) {
        status = 'healthy';
      } else if (healthScore >= 60) {
        status = 'warning';
      } else {
        status = 'error';
      }

      const health: SystemHealth = {
        timestamp: new Date().toISOString(),
        score: healthScore,
        resources: {
          cpu: {
            usage: normalizedCPU,
            status: normalizedCPU > 90 ? 'critical' : normalizedCPU > 70 ? 'warning' : 'normal'
          },
          memory: {
            usage: normalizedMemory,
            status: normalizedMemory > 90 ? 'critical' : normalizedMemory > 70 ? 'warning' : 'normal'
          },
          disk: {
            usage: normalizedDisk,
            status: normalizedDisk > 90 ? 'critical' : normalizedDisk > 70 ? 'warning' : 'normal'
          }
        },
        services: {
          database: await this.getDatabaseHealth(),
          cache: await this.getCacheHealth(),
          queue: await this.getQueueHealth()
        }
      };

      return health;
    } catch (error: any) {
      logger.error('Failed to get system health:', error);
      return {
        timestamp: new Date().toISOString(),
        score: 0,
        resources: {
          cpu: { usage: 0, status: 'critical' },
          memory: { usage: 0, status: 'critical' },
          disk: { usage: 0, status: 'critical' }
        },
        services: {
          database: { status: 'down', lastCheck: new Date().toISOString() },
          cache: { status: 'down', lastCheck: new Date().toISOString() },
          queue: { status: 'down', lastCheck: new Date().toISOString() }
        }
      };
    }
  }

  private async getCPUUsage(): Promise<number> {
    try {
      const cpus = os.cpus();
      const totalCPU = cpus.reduce((acc, cpu) => {
        acc.idle += cpu.times.idle;
        acc.total += Object.values(cpu.times).reduce((a, b) => a + b, 0);
        return acc;
      }, { idle: 0, total: 0 });
      
      // Store current measurements
      const currentMeasurements = {
        idle: totalCPU.idle,
        total: totalCPU.total
      };
      
      // Get CPU usage as a percentage (0-1)
      if (this.lastCPUMeasurements) {
        const idleDiff = currentMeasurements.idle - this.lastCPUMeasurements.idle;
        const totalDiff = currentMeasurements.total - this.lastCPUMeasurements.total;
        const usage = 1 - (idleDiff / totalDiff);
        
        // Update last measurements
        this.lastCPUMeasurements = currentMeasurements;
        
        return Math.min(1, Math.max(0, usage));
      }
      
      // First measurement
      this.lastCPUMeasurements = currentMeasurements;
      return 0;
    } catch (error) {
      logger.error('Failed to get CPU usage:', error);
      return 0;
    }
  }

  private async getMemoryUsage(): Promise<number> {
    try {
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      const usedMemory = totalMemory - freeMemory;
      
      // Return memory usage as a percentage (0-1)
      return Math.min(1, Math.max(0, usedMemory / totalMemory));
    } catch (error) {
      logger.error('Failed to get memory usage:', error);
      return 0;
    }
  }

  private async getDiskUsage(): Promise<number> {
    try {
      // Get disk usage for the root directory
      const diskInfo = await checkDiskSpace('/');
      
      // Return disk usage as a percentage (0-1)
      return Math.min(1, Math.max(0, (diskInfo.size - diskInfo.free) / diskInfo.size));
    } catch (error) {
      logger.error('Failed to get disk usage:', error);
      return 0;
    }
  }

  public async getSystemMetrics(): Promise<SystemMetrics> {
    const metrics = new DBSystemMetrics();
    metrics.timestamp = new Date();
    metrics.cpuUsage = os.loadavg()[0] / os.cpus().length;
    metrics.memoryUsage = (os.totalmem() - os.freemem()) / os.totalmem();
    metrics.totalRequests = this.requestMetrics.length;
    metrics.errorCount = 0;
    metrics.warningCount = 0;
    
    // Calculate active users from auth logs within last 15 minutes
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    metrics.activeUsers = this.authLogs.filter(log => 
      new Date(log.timestamp).getTime() > fifteenMinutesAgo.getTime() && log.action === 'login'
    ).length;

    // Calculate average response time from recent requests
    const recentRequests = this.requestMetrics.filter(metric => 
      new Date(metric.timestamp).getTime() > fifteenMinutesAgo.getTime()
    );
    metrics.averageResponseTime = recentRequests.length > 0
      ? recentRequests.reduce((sum, req) => sum + req.duration, 0) / recentRequests.length
      : 0;

    // Initialize empty arrays/objects for optional fields
    metrics.topPaths = [];
    metrics.locationStats = {};
    
    return metrics;
  }

  public async getRecentErrors(): Promise<DBErrorLog[]> {
    return this.errorRepository.find({
      order: { timestamp: 'DESC' },
      take: 100
    });
  }

  public async getSecurityEvents(): Promise<SecurityEvent[]> {
    return this.securityRepository.find({
      order: { timestamp: 'DESC' },
      take: 100
    });
  }

  public async logError(error: Partial<ErrorLog>): Promise<void> {
    try {
      const errorLog: ErrorLog = {
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        type: error.type || 'system_error',
        message: error.message || 'Unknown error',
        stack: error.stack,
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
      if (this.wsService) {
        this.wsService.broadcast('error:new', errorLog);
      }
    } catch (err) {
      logger.error('Failed to log error:', err);
    }
  }

  public async logAuth(log: AuthLog): Promise<void> {
    try {
      // Add to in-memory logs
      this.authLogs.push(log);
      
      // Trim logs if they exceed the maximum
      if (this.authLogs.length > this.maxLogsToKeep) {
        this.authLogs = this.authLogs.slice(-this.maxLogsToKeep);
      }

      // Emit event for real-time monitoring
      if (this.wsService) {
        const activityData: WebSocketEvents['activity:ai'] = {
          type: 'auth',
          data: {
            userId: log.userId,
            action: log.action,
            timestamp: new Date().toISOString(),
            details: {
              ip: log.ip,
              location: log.location,
              userAgent: log.userAgent
            }
          }
        };
        this.wsService.broadcast('activity:ai', activityData);
      }

      // Log to auth log file
      logger.info('Authentication event', {
        ...log,
        type: 'auth_log'
      });
    } catch (error) {
      logger.error('Failed to log auth event:', error);
    }
  }

  public async getAuthLogs(): Promise<AuthLog[]> {
    return this.authLogs;
  }

  public async getRecentLogs(): Promise<BaseLog[]> {
    try {
      // Return the most recent logs from the database or in-memory storage
      // This is a simplified implementation - in a real system, you would query your log storage
      const logs: BaseLog[] = this.requestMetrics.map(metric => ({
        timestamp: metric.timestamp,
        level: metric.statusCode >= 400 ? 'error' : 'info',
        message: `${metric.method} ${metric.path} ${metric.statusCode}`,
        metadata: {
          statusCode: metric.statusCode,
          duration: metric.duration,
          ip: metric.ip,
          userAgent: metric.userAgent
        }
      }));
      
      return logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 100);
    } catch (error) {
      logger.error('Failed to get recent logs:', error);
      return [];
    }
  }

  public async getRequestLocations(): Promise<RequestLocation[]> {
    try {
      // Convert the Map to an array of locations
      const locations: RequestLocation[] = Array.from(this.requestLocations.values());
      
      // Ensure we have at least some data for visualization
      if (locations.length === 0) {
        // Add some default locations for visualization
        const defaultLocations = [
          { 
            ip: '192.168.1.1',
            latitude: 40.7128, 
            longitude: -74.0060, 
            count: 15, 
            lastSeen: new Date().toISOString(),
            city: 'New York',
            country: 'US',
            uniqueIps: 5
          },
          { 
            ip: '192.168.1.2',
            latitude: 51.5074, 
            longitude: -0.1278, 
            count: 10, 
            lastSeen: new Date().toISOString(),
            city: 'London',
            country: 'GB',
            uniqueIps: 3
          },
          { 
            ip: '192.168.1.3',
            latitude: 35.6762, 
            longitude: 139.6503, 
            count: 8, 
            lastSeen: new Date().toISOString(),
            city: 'Tokyo',
            country: 'JP',
            uniqueIps: 2
          }
        ];
        return defaultLocations;
      }
      
      // Sort by count in descending order
      return locations.sort((a, b) => b.count - a.count);
    } catch (error) {
      logger.error('Failed to get request locations:', error);
      return [];
    }
  }

  public async logAIActivity(activity: AIActivity): Promise<void> {
    try {
      // Store AI activity in database
      const metric = new DBSystemMetrics();
      metric.timestamp = activity.timestamp;
      metric.type = `ai_${activity.type}`;
      metric.value = 1; // Count of activity
      metric.metadata = {
        activityType: activity.type,
        activityData: activity.data,
        ...activity.metadata
      };

      await this.metricsRepository.save(metric);
      
      // Emit event for real-time monitoring
      this.emit('ai-activity', activity);
      
      if (this.wsService) {
        this.wsService.broadcast('activity:ai', {
          type: 'activity',
          data: {
            userId: activity.data.userId,
            action: activity.type,
            timestamp: activity.timestamp.toISOString(),
            details: activity.data
          }
        });
      }
      
      logger.debug('AI activity logged', { type: activity.type });
    } catch (error) {
      logger.error('Failed to log AI activity:', error);
    }
  }

  public async logNotification(notification: SystemNotification): Promise<void> {
    try {
      // Store notification in database as a system metric
      const metric = new DBSystemMetrics();
      metric.timestamp = notification.timestamp;
      metric.type = `notification_${notification.type}`;
      metric.value = notification.severity === 'critical' ? 3 : 
                    notification.severity === 'error' ? 2 : 
                    notification.severity === 'warning' ? 1 : 0;
      metric.metadata = {
        notificationType: notification.type,
        severity: notification.severity,
        message: notification.message,
        ...notification.metadata
      };

      await this.metricsRepository.save(metric);
      
      // Emit event for real-time monitoring
      this.emit('notification', notification);
      
      // Broadcast notification to WebSocket clients
      if (this.wsService) {
        const adminNotification: WebSocketEvents['admin:notification'] = {
          id: uuidv4(),
          type: notification.type,
          message: notification.message,
          timestamp: notification.timestamp.toISOString(),
          metadata: notification.metadata
        };
        this.wsService.broadcast('admin:notification', adminNotification);
      }
      
      logger.info(`System notification: ${notification.message}`, { 
        type: notification.type,
        severity: notification.severity
      });
    } catch (error) {
      logger.error('Failed to log notification:', error);
    }
  }

  public async getCurrentMetrics(): Promise<SystemMetrics | null> {
    try {
      // Get the most recent metrics from the database
      const latestMetrics = await this.metricsRepository.findOne({
        where: {},  // Add an empty where clause to satisfy TypeORM
        order: { timestamp: 'DESC' }
      });
      
      if (!latestMetrics) {
        // If no metrics exist yet, collect and return current metrics
        return await this.getSystemMetrics();
      }
      
      return latestMetrics;
    } catch (error) {
      logger.error('Failed to get current metrics:', error);
      return null;
    }
  }

  public async getPerformanceInsights(): Promise<Record<string, any>> {
    try {
      // Get metrics from the last 24 hours
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      
      const metrics = await this.metricsRepository.find({
        where: {
          timestamp: MoreThan(oneDayAgo)
        },
        order: { timestamp: 'ASC' }
      });
      
      // Calculate performance metrics
      const cpuUsageHistory = metrics.map(m => ({ timestamp: m.timestamp, value: m.cpuUsage }));
      const memoryUsageHistory = metrics.map(m => ({ timestamp: m.timestamp, value: m.memoryUsage }));
      const responseTimeHistory = metrics.map(m => ({ timestamp: m.timestamp, value: m.averageResponseTime }));
      
      // Calculate averages
      const avgCpuUsage = cpuUsageHistory.reduce((sum, item) => sum + (item.value || 0), 0) / cpuUsageHistory.length || 0;
      const avgMemoryUsage = memoryUsageHistory.reduce((sum, item) => sum + (item.value || 0), 0) / memoryUsageHistory.length || 0;
      const avgResponseTime = responseTimeHistory.reduce((sum, item) => sum + (item.value || 0), 0) / responseTimeHistory.length || 0;
      
      return {
        cpuUsage: {
          current: cpuUsageHistory.length > 0 ? cpuUsageHistory[cpuUsageHistory.length - 1].value : 0,
          average: avgCpuUsage,
          history: cpuUsageHistory
        },
        memoryUsage: {
          current: memoryUsageHistory.length > 0 ? memoryUsageHistory[memoryUsageHistory.length - 1].value : 0,
          average: avgMemoryUsage,
          history: memoryUsageHistory
        },
        responseTime: {
          current: responseTimeHistory.length > 0 ? responseTimeHistory[responseTimeHistory.length - 1].value : 0,
          average: avgResponseTime,
          history: responseTimeHistory
        },
        uptime: process.uptime(),
        lastRestart: new Date(Date.now() - (process.uptime() * 1000))
      };
    } catch (error) {
      logger.error('Failed to get performance insights:', error);
      return {
        error: 'Failed to retrieve performance insights',
        cpuUsage: { current: 0, average: 0, history: [] },
        memoryUsage: { current: 0, average: 0, history: [] },
        responseTime: { current: 0, average: 0, history: [] },
        uptime: process.uptime()
      };
    }
  }

  public async getSuspiciousIPs(): Promise<string[]> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const ipAttempts = new Map<string, number>();
    this.authLogs
      .filter(log => log.action === 'failed_login' && new Date(log.timestamp).getTime() > sevenDaysAgo.getTime())
      .forEach(log => {
        const count = ipAttempts.get(log.ip) || 0;
        ipAttempts.set(log.ip, count + 1);
      });
    return Array.from(ipAttempts.entries())
      .filter(([_, count]) => count > 5)
      .map(([ip]) => ip);
  }

  public async getSecurityInsights(): Promise<Record<string, any>> {
    try {
      // Get security events from the last 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const securityEvents = await this.securityRepository.find({
        where: {
          timestamp: MoreThan(sevenDaysAgo)
        },
        order: { timestamp: 'DESC' }
      });
      
      // Get failed login attempts
      const failedLogins = this.authLogs.filter(log => 
        log.action === 'failed_login' && 
        new Date(log.timestamp).getTime() > sevenDaysAgo.getTime()
      );
      
      // Group by IP to detect potential brute force attacks
      const ipAttempts = new Map<string, number>();
      failedLogins.forEach(log => {
        const count = ipAttempts.get(log.ip) || 0;
        ipAttempts.set(log.ip, count + 1);
      });
      
      const suspiciousIPs = Array.from(ipAttempts.entries())
        .filter(([_, count]) => count > 5)
        .map(([ip, count]) => ({ ip, count }));
      
      return {
        recentSecurityEvents: securityEvents,
        failedLoginAttempts: failedLogins.length,
        suspiciousIPs,
        securityScore: this.calculateSecurityScore(securityEvents, suspiciousIPs.length),
        recommendations: this.generateSecurityRecommendations(securityEvents, suspiciousIPs.map(ip => ip.ip))
      };
    } catch (error) {
      logger.error('Failed to get security insights:', error);
      return {
        error: 'Failed to retrieve security insights',
        recentSecurityEvents: [],
        failedLoginAttempts: 0,
        suspiciousIPs: [],
        securityScore: 0
      };
    }
  }

  public calculateSecurityScore(events: SecurityEvent[], suspiciousIPCount: number): number {
    // Start with a perfect score and deduct based on security issues
    let score = 100;
    
    // Deduct for each critical security event
    const criticalEvents = events.filter(e => e.severity === 'critical');
    score -= criticalEvents.length * 10;
    
    // Deduct for suspicious IPs
    score -= suspiciousIPCount * 5;
    
    // Ensure score stays within 0-100 range
    return Math.max(0, Math.min(100, score));
  }

  public generateSecurityRecommendations(events: SecurityEvent[], suspiciousIPs: string[]): string[] {
    const recommendations: string[] = [];
    
    if (suspiciousIPs.length > 0) {
      recommendations.push('Consider implementing IP-based rate limiting for authentication endpoints');
      recommendations.push('Review and potentially block suspicious IPs with multiple failed login attempts');
    }
    
    if (events.some(e => e.type === 'unauthorized_access')) {
      recommendations.push('Review access control policies and user permissions');
    }
    
    if (events.some(e => e.type === 'data_leak')) {
      recommendations.push('Audit data access patterns and implement additional encryption');
    }
    
    // Add default recommendations if none were generated
    if (recommendations.length === 0) {
      recommendations.push('Regularly update dependencies to patch security vulnerabilities');
      recommendations.push('Implement multi-factor authentication for sensitive operations');
    }
    
    return recommendations;
  }

  public async getUsageInsights(): Promise<Record<string, any>> {
    try {
      // Get metrics from the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const metrics = await this.metricsRepository.find({
        where: {
          timestamp: MoreThan(thirtyDaysAgo)
        },
        order: { timestamp: 'ASC' }
      });
      
      // Calculate daily active users
      const dailyActiveUsers = new Map<string, number>();
      this.authLogs.forEach(log => {
        if (log.action === 'login' && new Date(log.timestamp).getTime() > thirtyDaysAgo.getTime()) {
          const dateKey = new Date(log.timestamp).toISOString().split('T')[0];
          const uniqueKey = `${dateKey}-${log.userId}`;
          dailyActiveUsers.set(uniqueKey, 1);
        }
      });
      
      // Group by date
      const dailyUsers = new Map<string, number>();
      Array.from(dailyActiveUsers.keys()).forEach(key => {
        const dateKey = key.split('-')[0];
        const count = dailyUsers.get(dateKey) || 0;
        dailyUsers.set(dateKey, count + 1);
      });
      
      // Format for chart display
      const userActivity = Array.from(dailyUsers.entries()).map(([date, count]) => ({
        date,
        activeUsers: count
      }));
      
      // Calculate request metrics
      const requestsByPath = new Map<string, number>();
      this.requestMetrics.forEach(req => {
        if (new Date(req.timestamp).getTime() > thirtyDaysAgo.getTime()) {
          const count = requestsByPath.get(req.path) || 0;
          requestsByPath.set(req.path, count + 1);
        }
      });
      
      // Get top paths
      const topPaths = Array.from(requestsByPath.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([path, count]) => ({ path, count }));
      
      return {
        userActivity,
        totalActiveUsers: dailyActiveUsers.size,
        averageDailyActiveUsers: userActivity.reduce((sum, day) => sum + day.activeUsers, 0) / userActivity.length || 0,
        topPaths,
        totalRequests: this.requestMetrics.filter(req => 
          new Date(req.timestamp).getTime() > thirtyDaysAgo.getTime()
        ).length,
        requestTrend: this.calculateRequestTrend()
      };
    } catch (error) {
      logger.error('Failed to get usage insights:', error);
      return {
        error: 'Failed to retrieve usage insights',
        userActivity: [],
        totalActiveUsers: 0,
        averageDailyActiveUsers: 0,
        topPaths: [],
        totalRequests: 0
      };
    }
  }

  public calculateRequestTrend(): Record<string, any> {
    // Calculate request trend over the last 7 days vs previous 7 days
    const now = Date.now();
    const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = now - (14 * 24 * 60 * 60 * 1000);
    
    const currentPeriodRequests = this.requestMetrics.filter(req => 
      new Date(req.timestamp).getTime() > sevenDaysAgo
    ).length;
    
    const previousPeriodRequests = this.requestMetrics.filter(req => 
      new Date(req.timestamp).getTime() > fourteenDaysAgo && 
      new Date(req.timestamp).getTime() <= sevenDaysAgo
    ).length;
    
    const percentChange = previousPeriodRequests === 0 
      ? 100 // If previous period had 0 requests, consider it 100% growth
      : ((currentPeriodRequests - previousPeriodRequests) / previousPeriodRequests) * 100;
    
    return {
      currentPeriodRequests,
      previousPeriodRequests,
      percentChange,
      trend: percentChange > 0 ? 'increasing' : percentChange < 0 ? 'decreasing' : 'stable'
    };
  }

  public logRequest(metric: RequestMetric): void {
    try {
      // Add to in-memory metrics
      this.requestMetrics.push(metric);
      
      // Trim metrics if they exceed the maximum
      if (this.requestMetrics.length > this.maxLogsToKeep) {
        this.requestMetrics = this.requestMetrics.slice(-this.maxLogsToKeep);
      }

      // Update location data if available
      if (metric.location) {
        const locationKey = `${metric.location.country}-${metric.location.city}`;
        const existingLocation = this.requestLocations.get(locationKey);
        
        if (existingLocation) {
          existingLocation.count += 1;
          existingLocation.lastSeen = metric.timestamp;
          
          // Track unique IPs
          if (!this.locationIps.has(locationKey)) {
            this.locationIps.set(locationKey, new Set());
          }
          this.locationIps.get(locationKey)?.add(metric.ip);
          existingLocation.uniqueIps = this.locationIps.get(locationKey)?.size || 0;
        } else {
          this.requestLocations.set(locationKey, {
            ip: metric.ip,
            latitude: metric.location.latitude,
            longitude: metric.location.longitude,
            count: 1,
            lastSeen: metric.timestamp,
            city: metric.location.city,
            country: metric.location.country,
            uniqueIps: 1
          });
          
          this.locationIps.set(locationKey, new Set([metric.ip]));
        }
      }
      
      // Log to request log file
      logger.debug('Request tracked', {
        ...metric,
        type: 'request_metric'
      });
    } catch (error) {
      logger.error('Failed to log request metric:', error);
    }
  }

  public async shutdown(): Promise<void> {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    this.isInitialized = false;
  }
}

export const systemMetricsService = SystemMetricsService.getInstance();
