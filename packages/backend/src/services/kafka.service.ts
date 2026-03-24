import { Kafka, Producer, Consumer, EachMessagePayload } from 'kafkajs';
import { logger } from '../utils/logger';
import { WebSocketService, getWebSocketService } from './websocket.service';
import { AIMessage } from '@admin-ai/shared/src/types/ai';

export interface KafkaMessage {
  type: string;
  userId?: string;
  jobId?: string;
  requestId?: string;
  pageId?: string;
  dataId?: string;
  data?: any;
  metrics?: Record<string, any>;
  method?: string;
  path?: string;
  priority?: 'high' | 'normal' | 'low';
  queueName?: string;
  timestamp: string;
  metadata?: {
    timestamp: string;
    source?: {
      page?: string;
      controller?: string;
      action?: string;
      details?: Record<string, any>;
    };
  };
}

export type MessageHandler = (message: any) => Promise<void>;

export class KafkaService {
  private static instance: KafkaService;
  private kafka: Kafka;
  private producer: Producer;
  private consumers: Map<string, Consumer> = new Map();
  private handlers: Map<string, MessageHandler> = new Map();
  private isConnected = false;
  private wsService?: WebSocketService;

  private constructor() {
    this.kafka = new Kafka({
      clientId: 'admin-ai',
      brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
      ssl: process.env.KAFKA_SSL === 'true',
      sasl: process.env.KAFKA_SASL_USERNAME ? {
        mechanism: 'plain',
        username: process.env.KAFKA_SASL_USERNAME,
        password: process.env.KAFKA_SASL_PASSWORD || '',
      } : undefined,
    });

    this.producer = this.kafka.producer({
      allowAutoTopicCreation: true,
      transactionTimeout: 30000,
    });
  }

  public static getInstance(): KafkaService {
    if (!KafkaService.instance) {
      KafkaService.instance = new KafkaService();
    }
    return KafkaService.instance;
  }

  public setWebSocketService(wsService: WebSocketService) {
    this.wsService = wsService;
    logger.info('WebSocket service set in KafkaService');
  }

  public async connect(): Promise<void> {
    try {
      await this.producer.connect();
      this.isConnected = true;
      logger.info('Connected to Kafka');
    } catch (error) {
      logger.error('Failed to connect to Kafka:', error);
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    try {
      await this.producer.disconnect();
      for (const consumer of this.consumers.values()) {
        await consumer.disconnect();
      }
      this.isConnected = false;
      logger.info('Disconnected from Kafka');
    } catch (error) {
      logger.error('Failed to disconnect from Kafka:', error);
      throw error;
    }
  }

  public async publish(topic: string, message: any): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Kafka service is not connected');
    }

    try {
      await this.producer.send({
        topic,
        messages: [
          {
            value: JSON.stringify(message),
            timestamp: Date.now().toString(),
          },
        ],
      });
    } catch (error) {
      logger.error(`Failed to publish message to topic ${topic}:`, error);
      throw error;
    }
  }

  public async subscribe(
    topic: string,
    groupId: string,
    handler: MessageHandler
  ): Promise<void> {
    if (this.consumers.has(topic)) {
      throw new Error(`Already subscribed to topic ${topic}`);
    }

    try {
      const consumer = this.kafka.consumer({
        groupId,
        maxWaitTimeInMs: 100,
        retry: {
          initialRetryTime: 100,
          retries: 8
        }
      });

      await consumer.connect();
      await consumer.subscribe({ topic, fromBeginning: false });

      this.handlers.set(topic, handler);
      this.consumers.set(topic, consumer);

      await consumer.run({
        eachMessage: async (payload: EachMessagePayload) => {
          try {
            const { topic, message } = payload;
            const handler = this.handlers.get(topic);
            
            if (!handler) {
              throw new Error(`No handler registered for topic ${topic}`);
            }

            if (!message.value) {
              logger.warn(`Received empty message on topic ${topic}`);
              return;
            }

            const parsedMessage = JSON.parse(message.value.toString());
            await handler(parsedMessage);
          } catch (error) {
            logger.error('Error processing Kafka message:', error);
          }
        },
      });

      logger.info(`Subscribed to Kafka topic: ${topic}`);
    } catch (error) {
      logger.error(`Failed to subscribe to topic ${topic}:`, error);
      throw error;
    }
  }

  public async unsubscribe(topic: string): Promise<void> {
    const consumer = this.consumers.get(topic);
    if (!consumer) {
      return;
    }

    try {
      await consumer.disconnect();
      this.consumers.delete(topic);
      this.handlers.delete(topic);
      logger.info(`Unsubscribed from Kafka topic: ${topic}`);
    } catch (error) {
      logger.error(`Failed to unsubscribe from topic ${topic}:`, error);
      throw error;
    }
  }

  public isReady(): boolean {
    return this.isConnected;
  }

  // Helper method to create standard topics
  async createStandardTopics() {
    const topics = [
      'ai-tasks',
      'system-metrics',
      'error-logs',
      'user-activity',
      'notifications',
    ];

    for (const topic of topics) {
      await this.subscribe(topic, `${topic}-group`, async (message) => {
        // Handle different types of messages
        switch (topic) {
          case 'ai-tasks':
            await this.handleAITask(message);
            break;
          case 'system-metrics':
            await this.handleSystemMetrics(message);
            break;
          case 'error-logs':
            await this.handleErrorLog(message);
            break;
          case 'user-activity':
            await this.handleUserActivity(message);
            break;
          case 'notifications':
            await this.handleNotification(message);
            break;
        }
      });
    }
  }

  private async handleAITask(message: KafkaMessage) {
    if (!this.wsService) {
      logger.warn('WebSocket service not initialized, skipping notification');
      return;
    }
    if (message.userId) {
      const timestamp = Date.now().toString();
      this.wsService.sendToUser(message.userId, 'ai:message', {
        id: crypto.randomUUID(),
        content: `AI Task ${message.type}: ${message.data?.taskName || 'Unknown task'}`,
        role: 'system',
        timestamp,
        metadata: {
          type: 'notification',
          status: message.type === 'task_failed' ? 'error' : 'success',
          category: 'ai',
          source: message.metadata?.source,
          timestamp,
          read: false
        }
      });
    }
  }

  private async handleSystemMetrics(message: KafkaMessage) {
    try {
      logger.debug('Received system metrics message from Kafka');
      
      if (!this.wsService) {
        logger.warn('WebSocket service not initialized, skipping metrics broadcast');
        return;
      }
      
      // Broadcast to all connected clients
      (this.wsService as any).broadcast('metrics:update', {
        health: message.data?.health,
        metrics: message.data?.metrics,
        timestamp: new Date().toISOString()
      });
      
      // Also broadcast individual updates for dashboard widgets
      if (message.data?.health) {
        (this.wsService as any).broadcast('health_update', message.data.health);
      }
      
      if (message.data?.metrics) {
        // Extract and broadcast specific metrics for different dashboard widgets
        const { metrics } = message.data;
        
        // Request metrics
        if (metrics.requests) {
          (this.wsService as any).broadcast('request_metrics_update', metrics.requests);
        }
        
        // Location data
        if (metrics.locations) {
          (this.wsService as any).broadcast('locations_update', metrics.locations);
        }
        
        // Logs
        if (metrics.logs) {
          (this.wsService as any).broadcast('logs_update', metrics.logs);
        }
        
        // Error logs
        if (metrics.errors) {
          (this.wsService as any).broadcast('error_logs_update', metrics.errors);
        }
        
        // Auth logs
        if (metrics.authLogs) {
          (this.wsService as any).broadcast('auth_logs_update', metrics.authLogs);
        }
      }
      
    } catch (error) {
      logger.error('Error handling system metrics message:', error);
    }
  }

  private async handleErrorLog(message: KafkaMessage) {
    if (!this.wsService) {
      logger.warn('WebSocket service not initialized, skipping notification');
      return;
    }
    if (message.userId) {
      const timestamp = Date.now().toString();
      this.wsService.sendToUser(message.userId, 'ai:message', {
        id: crypto.randomUUID(),
        content: `Error: ${message.data?.message || 'Unknown error'}`,
        role: 'system',
        timestamp,
        metadata: {
          type: 'notification',
          status: 'error',
          category: 'system',
          source: message.metadata?.source,
          timestamp,
          read: false
        }
      });
    }
  }

  private async handleUserActivity(message: KafkaMessage) {
    // Handle user activity tracking
    if (message.userId) {
      const timestamp = Date.now().toString();
      const aiMessage: AIMessage = {
        id: crypto.randomUUID(),
        content: `Activity tracked: ${message.type}`,
        role: 'system',
        timestamp,
        metadata: {
          type: 'notification',
          status: 'info',
          category: 'activity',
          source: {
            ...message.metadata?.source,
            details: message.data,
          },
          timestamp,
          read: false,
        },
      };
      this.wsService?.sendToUser(message.userId, 'ai:message', aiMessage);
    }
  }

  private async handleNotification(message: KafkaMessage) {
    if (!this.wsService) {
      logger.warn('WebSocket service not initialized, skipping notification');
      return;
    }
    if (message.userId) {
      const timestamp = Date.now().toString();
      this.wsService.sendToUser(message.userId, 'ai:message', {
        id: crypto.randomUUID(),
        content: message.data?.message || 'New notification',
        role: 'system',
        timestamp,
        metadata: {
          type: 'notification',
          status: message.data?.status || 'info',
          category: message.data?.category || 'system',
          source: message.metadata?.source,
          timestamp,
          read: false
        }
      });
    }
  }

  async createTopic(topic: string) {
    try {
      const admin = this.kafka.admin();
      await admin.connect();
      await admin.createTopics({
        topics: [{ topic }],
      });
      await admin.disconnect();
      logger.info(`Created Kafka topic: ${topic}`);
    } catch (error) {
      logger.error(`Failed to create Kafka topic ${topic}:`, error);
      throw error;
    }
  }

  async subscribeToTopics(topics: string[], groupId: string, callback: (payload: { topic: string; partition: number; message: any }) => Promise<void>) {
    try {
      const consumer = this.kafka.consumer({ groupId });
      await consumer.connect();

      await Promise.all(
        topics.map(topic => consumer.subscribe({ topic, fromBeginning: true }))
      );

      await consumer.run({
        eachMessage: async (payload: EachMessagePayload) => {
          const { topic, partition, message } = payload;
          const value = message.value?.toString();

          try {
            const parsedMessage = value ? JSON.parse(value) : null;
            await callback({
              topic,
              partition,
              message: parsedMessage,
            });
          } catch (error) {
            logger.error(`Error processing message from topic ${topic}:`, error);
          }
        },
      });

      this.consumers.set(groupId, consumer);
      logger.info(`Subscribed to topics: ${topics.join(', ')}`);
    } catch (error) {
      logger.error(`Failed to subscribe to topics ${topics.join(', ')}:`, error);
      throw error;
    }
  }

  private createNotificationMessage(content: string, category: string, details: any, status: 'info' | 'success' | 'warning' | 'error' = 'info'): AIMessage {
    const timestamp = Date.now().toString();
    return {
      id: crypto.randomUUID(),
      content,
      role: 'system',
      timestamp,
      metadata: {
        type: 'notification',
        status,
        category,
        source: {
          page: 'System',
          controller: 'KafkaService',
          action: 'messageReceived',
          details,
        },
        timestamp,
        read: false,
      },
    };
  }

  private createErrorMessage(error: Error, category: string): AIMessage {
    const timestamp = Date.now().toString();
    return {
      id: crypto.randomUUID(),
      content: error.message,
      role: 'system',
      timestamp,
      metadata: {
        type: 'notification',
        status: 'error',
        category,
        source: {
          page: 'System',
          controller: 'KafkaService',
          action: 'error',
          details: {
            name: error.name,
            stack: error.stack,
          },
        },
        timestamp,
        read: false,
      },
    };
  }

  private async sendWebSocketNotification(userId: string, topic: string, messageType: string) {
    const timestamp = Date.now().toString();
    const aiMessage: AIMessage = {
      id: crypto.randomUUID(),
      content: `New message received from ${topic}`,
      role: 'system',
      timestamp,
      metadata: {
        type: 'notification',
        status: 'info',
        category: 'kafka',
        source: {
          page: 'System',
          controller: 'KafkaService',
          action: 'messageReceived',
          details: {
            topic,
            messageType,
          },
        },
        timestamp,
        read: false,
      },
    };
    await this.wsService?.sendToUser(userId, 'ai:message', aiMessage);
  }

  private async sendWebSocketError(userId: string, error: any) {
    const timestamp = Date.now().toString();
    const aiMessage: AIMessage = {
      id: crypto.randomUUID(),
      content: error.message || 'An error occurred while processing the message',
      role: 'system',
      timestamp,
      metadata: {
        type: 'notification',
        status: 'error',
        category: 'kafka',
        source: {
          page: 'System',
          controller: 'KafkaService',
          action: 'error',
          details: error,
        },
        timestamp,
        read: false,
      },
    };
    await this.wsService?.sendToUser(userId, 'ai:message', aiMessage);
  }

  // Add a method to publish system metrics
  public async publishSystemMetrics(data: any): Promise<void> {
    try {
      await this.publish('system-metrics', {
        health: data.health,
        metrics: data.metrics,
        timestamp: new Date().toISOString()
      });
      logger.debug('Published system metrics to Kafka');
    } catch (error) {
      logger.error('Failed to publish system metrics to Kafka:', error);
    }
  }

  // Add a method to publish dashboard updates
  public async publishDashboardUpdate(type: string, data: any): Promise<void> {
    try {
      await this.publish(`dashboard-${type}`, {
        type,
        data,
        timestamp: new Date().toISOString()
      });
      logger.debug(`Published dashboard ${type} update to Kafka`);
    } catch (error) {
      logger.error(`Failed to publish dashboard ${type} update to Kafka:`, error);
    }
  }
}

// Export a singleton instance
export const kafkaService = KafkaService.getInstance();  