import type { AIMessage, AIAnalysis } from './ai.js';
import type { SystemHealth, SystemMetrics } from './metrics.js';
import type { LogEntry } from './logs.js';
import type { ErrorLog } from './error.js';

export interface WebSocketEvents {
  // Connection events
  'connected': void;
  'disconnected': void;

  // AI events
  'ai:message': AIMessage;
  'ai:start': void;
  'ai:end': void;
  'ai:error': { message: string };
  'ai:status': { 
    ready: boolean;
    initialized?: boolean;
    connected?: boolean;
    hasProviders?: boolean;
    activeProviders?: string[];
    timestamp?: string;
  };
  'ai:ready': void;
  'ai:performance_insights': {
    cpu: {
      current: string;
      trend: string;
      recommendation: string;
    };
    memory: {
      current: string;
      trend: string;
      recommendation: string;
    };
    database: {
      connections: number;
      trend: string;
      recommendation: string;
    };
    responseTime: {
      current: number;
      trend: string;
      recommendation: string;
    };
    summary: string;
    score: number;
    aiProvider: string;
    timestamp: string;
  };
  'ai:security_insights': {
    failedLogins: number;
    suspiciousActivities: number;
    suspiciousIPs: number;
    vulnerabilities: Array<{
      type: string;
      description: string;
      severity: string;
    }>;
    score: number;
    recommendations: string[];
    timestamp: string;
  };
  'ai:usage_insights': {
    totalRequests: number;
    activeUsers: number;
    topPaths: Array<{
      path: string;
      count: number;
      averageResponseTime: number;
    }>;
    timestamp: string;
  };

  // Metrics events
  'metrics:request': void;
  'metrics:update': {
    health: SystemHealth;
    metrics: SystemMetrics;
    timestamp: string;
  };
  'metrics:analysis': AIAnalysis;
  'metrics:status': {
    health: SystemHealth;
    metrics: SystemMetrics;
    timestamp: string;
  };

  // Error events
  'error:new': ErrorLog;
  'error:analysis': {
    error: ErrorLog;
    analysis: AIAnalysis;
  };
  'error:log': {
    type: string;
    data: LogEntry;
  };
  'error:logs:update': ErrorLog[];

  // Activity events
  'activity:ai': {
    type: string;
    data: {
      userId: string;
      action: string;
      timestamp: string;
      details: Record<string, any>;
    };
  };
  'activity:log': {
    type: string;
    data: LogEntry;
  };

  // Admin events
  'admin:notification': {
    id: string;
    type: string;
    message: string;
    timestamp: string;
    metadata?: Record<string, any>;
  };

  // System events
  'system:status': {
    health: SystemHealth;
    metrics: SystemMetrics;
    timestamp: string;
  };
  'system:notification': {
    type: string;
    message: string;
    severity: string;
    timestamp: string;
    metadata?: Record<string, any>;
  };

  // Log events
  'logs:update': LogEntry[];
  'auth:logs:update': LogEntry[];
  'request:metrics:update': SystemMetrics[];
  'locations:update': Array<{
    ip: string;
    latitude: number;
    longitude: number;
    city: string;
    country: string;
    count: number;
    lastSeen: string;
  }>;
  'insights:performance:update': {
    cpu: {
      current: string;
      trend: string;
      recommendation: string;
    };
    memory: {
      current: string;
      trend: string;
      recommendation: string;
    };
    database: {
      connections: number;
      trend: string;
      recommendation: string;
    };
    responseTime: {
      current: number;
      trend: string;
      recommendation: string;
    };
    summary: string;
    score: number;
    aiProvider: string;
    timestamp: string;
  };
  'insights:security:update': {
    failedLogins: number;
    suspiciousActivities: number;
    suspiciousIPs: number;
    vulnerabilities: Array<{
      type: string;
      description: string;
      severity: string;
    }>;
    score: number;
    recommendations: string[];
    timestamp: string;
  };
  'insights:usage:update': {
    totalRequests: number;
    activeUsers: number;
    topPaths: Array<{
      path: string;
      count: number;
      averageResponseTime: number;
    }>;
    timestamp: string;
  };

  // Globe visualization events
  'globe:locations': {
    locations: Array<{
      ip: string;
      latitude: number;
      longitude: number;
      city: string;
      country: string;
      count: number;
      lastSeen: string;
    }>;
    timestamp: string;
  };
  'globe:location:new': {
    location: {
      ip: string;
      latitude: number;
      longitude: number;
      city: string;
      country: string;
      timestamp: string;
    };
  };

  // OpenClaw events
  'openclaw:status': {
    connected: boolean;
    gatewayUrl: string;
    activeSkills: number;
    totalSkills: number;
    lastHeartbeat?: string;
    channels: string[];
  };
  'openclaw:skill:executed': {
    skillId: string;
    skillName: string;
    actionId: string;
    actionName: string;
    success: boolean;
    timestamp: string;
  };
  'openclaw:message': {
    content: string;
    source: string;
    timestamp: string;
  };
}
