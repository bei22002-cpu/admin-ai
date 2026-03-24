import { Request, Response } from 'express';
import { SystemMetricsService, systemMetricsService } from '../services/systemMetrics.service';
import { AIService } from '../services/ai.service';
import { WebSocketService } from '../services/websocket.service';
import { RequestWithUser } from '../middleware/auth';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';
import { AIMessageMetadata } from '../types/metrics';
import { SystemMetrics, SystemHealth } from '../types/metrics';
import { ErrorLog, LogEntry, SecurityEvent } from '../types/logs';

/**
 * Controller for system metrics and monitoring
 */
export class MetricsController {
  private systemMetricsService: SystemMetricsService;
  private aiService: AIService;
  private wsService: WebSocketService;

  constructor(aiService: AIService, wsService: WebSocketService) {
    this.aiService = aiService;
    this.wsService = wsService;
    this.systemMetricsService = systemMetricsService;
    this.systemMetricsService.initializeServices(wsService, aiService);
  }

  public handleMetricsUpdate = (data: { health: SystemHealth; metrics: SystemMetrics; timestamp: string }): void => {
    this.wsService.broadcast('metrics:update', data);
  };

  public getSystemHealth = async (req: RequestWithUser, res: Response) => {
    try {
      const health = await this.systemMetricsService.getSystemHealth();

      const cpuScore = health.resources.cpu.status === 'normal' ? 100 :
        health.resources.cpu.status === 'warning' ? 70 : 40;
      const memoryScore = health.resources.memory.status === 'normal' ? 100 :
        health.resources.memory.status === 'warning' ? 70 : 40;
      const diskScore = health.resources.disk.status === 'normal' ? 100 :
        health.resources.disk.status === 'warning' ? 70 : 40;

      const healthScore = Math.round((cpuScore + memoryScore + diskScore) / 3);

      // Log the health check
      logger.info('System health check', {
        status: healthScore >= 80 ? 'success' : healthScore >= 60 ? 'warning' : 'error',
        score: healthScore,
        page: 'System Metrics',
        controller: 'MetricsController',
        action: 'getSystemHealth',
        details: health
      });

      // Send notification for system health status
      this.wsService.broadcast('system:notification', {
        type: 'health_check',
        message: `System health check completed: ${healthScore >= 80 ? 'healthy' : healthScore >= 60 ? 'degraded' : 'critical'} (${healthScore}%)`,
        severity: healthScore >= 80 ? 'info' : healthScore >= 60 ? 'warning' : 'error',
        timestamp: new Date().toISOString(),
        metadata: {
          score: healthScore,
          cpu: health.resources.cpu,
          memory: health.resources.memory,
          disk: health.resources.disk
        }
      });

      const responseHealth = {
        ...health,
        score: healthScore,
        status: healthScore >= 80 ? 'healthy' : healthScore >= 60 ? 'warning' : 'critical'
      };

      res.json(responseHealth);
    } catch (error) {
      logger.error('Failed to get system health:', error);
      throw new AppError(500, 'Failed to get system health');
    }
  };

  public getSystemMetrics = async (req: RequestWithUser, res: Response) => {
    try {
      const metrics = await this.systemMetricsService.getSystemMetrics();
      const analysis = await this.aiService.analyzeMetrics(metrics);

      res.json({
        metrics,
        analysis
      });
    } catch (error) {
      logger.error('Failed to get system metrics:', error);
      throw new AppError(500, 'Failed to get system metrics');
    }
  };

  public getRequestMetrics = async (req: RequestWithUser, res: Response) => {
    try {
      const metrics = await this.systemMetricsService.getCurrentMetrics();
      
      // Handle null metrics case
      if (!metrics) {
        return res.json({
          metrics: [],
          analysis: {
            summary: "No metrics data available",
            recommendations: ["Start collecting metrics data"]
          }
        });
      }
      
      const analysis = await this.aiService.analyzeMetrics({
        cpuUsage: metrics.cpuUsage || 0,
        memoryUsage: metrics.memoryUsage || 0,
        diskUsage: 0,
        totalRequests: metrics.totalRequests || 0,
        errorCount: metrics.errorCount || 0,
        activeUsers: metrics.activeUsers || 0,
        averageResponseTime: metrics.averageResponseTime || 0
      });

      res.json({
        metrics,
        analysis
      });
    } catch (error) {
      logger.error('Failed to get request metrics:', error);
      throw new AppError(500, 'Failed to get request metrics');
    }
  };

  public getLocationHeatmap = async (req: RequestWithUser, res: Response) => {
    try {
      // Check if the method exists
      if (typeof this.systemMetricsService.getRequestLocations !== 'function') {
        return res.json([]);
      }
      
      const locations = await this.systemMetricsService.getRequestLocations();
      
      // Ensure we always return an array
      res.json(Array.isArray(locations) ? locations : []);
    } catch (error) {
      logger.error('Failed to get location heatmap:', error);
      throw new AppError(500, 'Failed to get location heatmap');
    }
  };

  public getAIMetrics = async (req: RequestWithUser, res: Response) => {
    try {
      const metrics = await this.aiService.analyzeMetrics({
        cpuUsage: 0,
        memoryUsage: 0,
        diskUsage: 0,
        totalRequests: 0,
        errorCount: 0,
        activeUsers: 0,
        averageResponseTime: 0
      });

      res.json(metrics);
    } catch (error) {
      logger.error('Failed to get AI metrics:', error);
      throw new AppError(500, 'Failed to get AI metrics');
    }
  };

  public getPerformanceInsights = async (req: RequestWithUser, res: Response) => {
    try {
      const metrics = await this.systemMetricsService.getSystemMetrics();
      const analysis = await this.aiService.analyzeMetrics(metrics);
      
      // Create performance insights from metrics and AI analysis
      const performanceInsights = {
        cpu: {
          current: metrics.cpuUsage.toFixed(2),
          trend: metrics.cpuUsage > 70 ? 'increasing' : metrics.cpuUsage > 30 ? 'stable' : 'decreasing',
          recommendation: analysis?.recommendations?.find((r: string) => r.toLowerCase().includes('cpu')) || 'Monitor CPU usage trends'
        },
        memory: {
          current: metrics.memoryUsage.toFixed(2),
          trend: metrics.memoryUsage > 70 ? 'increasing' : metrics.memoryUsage > 30 ? 'stable' : 'decreasing',
          recommendation: analysis?.recommendations?.find((r: string) => r.toLowerCase().includes('memory')) || 'Monitor memory allocation'
        },
        database: {
          connections: metrics.database?.active_connections || 0,
          trend: 'stable',
          recommendation: analysis?.recommendations?.find((r: string) => r.toLowerCase().includes('database')) || 'Optimize database queries'
        },
        responseTime: {
          current: metrics.averageResponseTime || 0,
          trend: (metrics.averageResponseTime || 0) > 500 ? 'degrading' : 'optimal',
          recommendation: analysis?.recommendations?.find((r: string) => r.toLowerCase().includes('response')) || 'Monitor API response times'
        },
        summary: analysis?.summary || 'System performance is within normal parameters',
        score: analysis?.score || Math.round(100 - (metrics.cpuUsage + metrics.memoryUsage) / 2),
        aiProvider: analysis?.provider || 'system',
        timestamp: new Date().toISOString()
      };
      
      // Broadcast performance insights to websocket clients
      this.wsService.broadcast('ai:performance_insights', performanceInsights);
      
      res.json(performanceInsights);
    } catch (error) {
      logger.error('Failed to get performance insights:', error);
      throw new AppError(500, 'Failed to get performance insights');
    }
  };

  public getSecurityInsights = async (req: RequestWithUser, res: Response) => {
    try {
      // Get security events from the last 24 hours
      const securityEvents = await this.systemMetricsService.getSecurityEvents();
      const errorLogs = await this.systemMetricsService.getRecentErrors();
      
      // Get suspicious IPs
      const suspiciousIPs = await this.systemMetricsService.getSuspiciousIPs();
      
      // Calculate security metrics
      const failedLogins = securityEvents.filter((event: any) => 
        event.type === 'auth' && event.action === 'login' && !event.success
      ).length;
      
      const suspiciousActivities = securityEvents.filter((event: any) => 
        event.severity === 'high' || event.severity === 'critical'
      ).length;
      
      // Generate vulnerabilities based on error logs
      const vulnerabilities = errorLogs
        .filter((log: any) => log.message.toLowerCase().includes('security') || 
                      log.message.toLowerCase().includes('vulnerability') ||
                      log.message.toLowerCase().includes('exploit'))
        .slice(0, 3)
        .map((log: any) => ({
          type: log.message.split(':')[0] || 'Security Issue',
          description: log.message,
          severity: log.level === 'error' ? 'high' : 'medium'
        }));
      
      // Calculate security score
      const securityScore = this.systemMetricsService.calculateSecurityScore(securityEvents, suspiciousIPs.length);
      
      // Generate recommendations
      const recommendations = this.systemMetricsService.generateSecurityRecommendations(securityEvents, suspiciousIPs);
      
      const securityInsights = {
        failedLogins,
        suspiciousActivities,
        suspiciousIPs: suspiciousIPs.length,
        vulnerabilities: vulnerabilities.length > 0 ? vulnerabilities : [
          {
            type: 'System Scan',
            description: 'Regular security scan completed',
            severity: 'low'
          }
        ],
        score: securityScore,
        recommendations,
        timestamp: new Date().toISOString()
      };
      
      // Broadcast security insights to websocket clients
      this.wsService.broadcast('ai:security_insights', securityInsights);
      
      res.json(securityInsights);
    } catch (error) {
      logger.error('Failed to get security insights:', error);
      throw new AppError(500, 'Failed to get security insights');
    }
  };

  public getUsageInsights = async (req: RequestWithUser, res: Response) => {
    try {
      const metrics = await this.systemMetricsService.getSystemMetrics();
      const requestTrend = this.systemMetricsService.calculateRequestTrend();
      
      const usageInsights = {
        totalRequests: metrics.totalRequests,
        activeUsers: metrics.activeUsers,
        topPaths: metrics.topPaths || [],
        timestamp: new Date().toISOString()
      };
      
      // Broadcast usage insights to websocket clients
      this.wsService.broadcast('ai:usage_insights', usageInsights);
      
      res.json(usageInsights);
    } catch (error) {
      logger.error('Failed to get usage insights:', error);
      throw new AppError(500, 'Failed to get usage insights');
    }
  };

  public getRecentErrors = async (req: RequestWithUser, res: Response) => {
    try {
      const errors = await this.systemMetricsService.getRecentErrors();
      res.json(errors);
    } catch (error) {
      logger.error('Failed to get recent errors:', error);
      throw new AppError(500, 'Failed to get recent errors');
    }
  };

  public getAuthLogs = async (req: RequestWithUser, res: Response) => {
    try {
      const logs = await this.systemMetricsService.getAuthLogs();
      res.json(logs);
    } catch (error) {
      logger.error('Failed to get auth logs:', error);
      throw new AppError(500, 'Failed to get auth logs');
    }
  };

  public getRecentLogs = async (req: RequestWithUser, res: Response) => {
    try {
      const logs = await this.systemMetricsService.getRecentLogs();
      res.json(logs);
    } catch (error) {
      logger.error('Failed to get recent logs:', error);
      throw new AppError(500, 'Failed to get recent logs');
    }
  };

  public handleWebSocketMetricsRequest = async (userId: string) => {
    try {
      const metrics = await this.systemMetricsService.getCurrentMetrics();
      const health = await this.systemMetricsService.getSystemHealth();
      const timestamp = new Date().toISOString();

      // Send metrics update
      (this.wsService as any).sendToUser(userId, 'metrics:update', {
        health,
        metrics: metrics || {},
        timestamp
      });

      // Get and send recent logs
      const recentLogs = await this.systemMetricsService.getRecentLogs();
      const errorLogs = await this.systemMetricsService.getRecentErrors();
      const authLogs = await this.systemMetricsService.getAuthLogs();
      const locations = await this.systemMetricsService.getRequestLocations();

      // Send logs updates
      (this.wsService as any).sendToUser(userId, 'logs:update', recentLogs);
      (this.wsService as any).sendToUser(userId, 'error:logs:update', errorLogs);
      (this.wsService as any).sendToUser(userId, 'auth:logs:update', authLogs);
      (this.wsService as any).sendToUser(userId, 'request:metrics:update', metrics || []);
      (this.wsService as any).sendToUser(userId, 'locations:update', locations);

      // Get and send insights
      const performanceInsights = await this.systemMetricsService.getPerformanceInsights();
      const securityInsights = await this.systemMetricsService.getSecurityInsights();
      const usageInsights = await this.systemMetricsService.getUsageInsights();

      // Send insights updates
      (this.wsService as any).sendToUser(userId, 'insights:performance:update', performanceInsights);
      (this.wsService as any).sendToUser(userId, 'insights:security:update', securityInsights);
      (this.wsService as any).sendToUser(userId, 'insights:usage:update', usageInsights);
    } catch (error) {
      logger.error('Failed to handle websocket metrics request:', error);
      throw new AppError(500, 'Failed to handle websocket metrics request');
    }
  };
}

// Export the controller instance
export const metricsController = new MetricsController(
  require('../services/ai.service').aiService,
  require('../services/websocket.service').wsService
);    