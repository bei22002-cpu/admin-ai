import { Server as HTTPServer } from 'http';
import { Server as WebSocketServer } from 'socket.io';
import { WebSocketEvents } from '@admin-ai/shared/src/types/websocket';
import { logger } from '../utils/logger';
import { verifyToken } from '../utils/auth';
import { AIMessage, AIMessageMetadata, AIAnalysis } from '@admin-ai/shared/src/types/ai';
import { MonitoringService } from './monitoring.service';
import { SystemHealth, SystemMetrics } from '@admin-ai/shared/src/types/metrics';
import { ErrorLog } from '@admin-ai/shared/src/types/error';
import { AIService } from './ai.service';
import { AppError } from '../middleware/errorHandler';
import { LLMProvider } from '@admin-ai/shared/src/types/ai';
import { LogEntry } from '@admin-ai/shared/src/types/logs';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';

// Add MetricsController interface
interface MetricsController {
  getSystemHealth(): Promise<SystemHealth>;
  getSystemMetrics(): Promise<SystemMetrics>;
  handleMetricsUpdate(data: any): void;
}

interface TokenRefreshError extends AppError {
  code: 'TOKEN_REFRESH_REQUIRED';
}

type EventName = keyof WebSocketEvents;
type EventData<T extends EventName> = WebSocketEvents[T];

export class WebSocketService {
  private static instance: WebSocketService | null = null;
  private static isInitializing = false;
  private static initializationPromise: Promise<WebSocketService> | null = null;

  private io: WebSocketServer | null = null;
  private userSockets: Map<string, string[]> = new Map();
  private initialized = false;
  private monitoring: MonitoringService | null = null;
  private connectionCheckInterval: NodeJS.Timeout | null = null;
  private messageQueue: Map<string, Array<{event: string, data: any}>> = new Map();
  private recentlyProcessedMessages: Set<string> = new Set();
  private readonly MAX_RECENT_MESSAGES = 100;
  private aiService: AIService | null = null;
  private metricsController: MetricsController | null = null;

  private constructor() {}

  public static async getInstance(): Promise<WebSocketService> {
    if (!WebSocketService.instance) {
      if (!WebSocketService.isInitializing) {
        WebSocketService.isInitializing = true;
        WebSocketService.initializationPromise = (async () => {
          try {
            WebSocketService.instance = new WebSocketService();
            return WebSocketService.instance;
          } finally {
            WebSocketService.isInitializing = false;
          }
        })();
      }
      await WebSocketService.initializationPromise;
    }
    return WebSocketService.instance!;
  }

  public isInitialized(): boolean {
    return this.initialized;
  }

  public async initialize(httpServer: HTTPServer): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      this.io = new WebSocketServer(httpServer, {
        cors: {
          origin: '*',
          methods: ['GET', 'POST']
        },
        path: '/socket.io',  // Use Socket.IO default path
        serveClient: true,  // Serve Socket.IO client files
        transports: ['websocket', 'polling'],  // Enable both WebSocket and polling transports
        allowEIO3: true,  // Allow Engine.IO v3 client compatibility
        connectTimeout: 45000  // Increase connection timeout
      });

      this.io.on('connection', (socket) => {
        logger.info(`Client connected: ${socket.id}`);

        socket.on('register', (userIdOrToken: string) => {
          // Extract userId from token if it's a JWT token
          const userId = this.extractUserIdFromToken(userIdOrToken);
          
          if (!userId) {
            logger.warn(`Invalid user ID or token provided: ${userIdOrToken}`);
            socket.emit('error', { message: 'Invalid user ID or token provided' });
            return;
          }
          
          if (!this.userSockets.has(userId)) {
            this.userSockets.set(userId, []);
          }
          
          // Check if socket ID is already registered for this user
          if (!this.userSockets.get(userId)!.includes(socket.id)) {
            this.userSockets.get(userId)!.push(socket.id);
          }
          
          logger.info(`User ${userId} registered with socket ${socket.id}`);
          
          // Debug log to check user sockets map
          logger.debug(`Current user sockets map: ${JSON.stringify(Array.from(this.userSockets.entries()))}`);
          
          // Emit a confirmation back to the client
          socket.emit('register:confirmed', { userId, socketId: socket.id });
          
          // Send any queued messages for this user
          this.sendQueuedMessages(userId);
        });

        // Add a ping handler to keep connections alive
        socket.on('ping', (data: { timestamp: string }) => {
          // Log the ping for debugging
          logger.debug(`Received ping from socket ${socket.id}, timestamp: ${data.timestamp}`);
          
          // Respond with a pong to keep the connection alive
          const responseTimestamp = new Date().toISOString();
          socket.emit('pong', { 
            timestamp: responseTimestamp,
            received: data.timestamp 
          });
          
          logger.debug(`Sent pong to socket ${socket.id}, timestamp: ${responseTimestamp}`);
        });

        // Add a handler for test messages
        socket.on('test', (data: any) => {
          logger.info(`Received test message from socket ${socket.id}:`, data);
          
          // Echo the message back to the client
          socket.emit('test:response', {
            message: `Echo: ${data.message || 'No message provided'}`,
            timestamp: new Date().toISOString(),
            socketId: socket.id
          });
        });

        // Add a handler for 'message' events (used by the frontend)
        socket.on('message', async (data: any) => {
          try {
            // Ensure data has a content property that's a string
            if (!data || typeof data.content !== 'string') {
              logger.warn(`Received invalid message format from socket ${socket.id}`);
              return;
            }
            
            // Skip processing if this is an AI-generated message
            // Check both role and metadata to determine if it's an AI message
            if (
              data.role === 'assistant' || 
              (data.metadata && data.metadata.provider) ||
              data.content.includes("I received your message:") ||
              data.content.includes("I'm sorry, but I encountered an error")
            ) {
              logger.debug(`Skipping processing of AI response message to prevent feedback loop: ${data.id}`);
              return;
            }
            
            // Check for duplicate messages using message ID
            if (data.id && this.recentlyProcessedMessages.has(data.id)) {
              logger.debug(`Skipping duplicate message with ID: ${data.id}`);
              return;
            }
            
            // Add message ID to processed set if it exists
            if (data.id) {
              this.recentlyProcessedMessages.add(data.id);
              
              // Trim the set if it gets too large
              if (this.recentlyProcessedMessages.size > this.MAX_RECENT_MESSAGES) {
                const iterator = this.recentlyProcessedMessages.values();
                const first = iterator.next().value;
                if (first !== undefined) this.recentlyProcessedMessages.delete(first);
              }
            }
            
            logger.info(`Received message from socket ${socket.id}:`, data);
            
            // Find the user ID associated with this socket
            let userId: string | undefined;
            for (const [id, sockets] of this.userSockets.entries()) {
              if (sockets.includes(socket.id)) {
                userId = id;
                break;
              }
            }
            
            if (!userId) {
              logger.warn(`Cannot process message: No user ID found for socket ${socket.id}`);
              return;
            }
            
            // Extract the actual UUID from the userId if it's a JWT token
            const extractedUserId = this.extractUserIdFromToken(userId);

            if (!extractedUserId) {
              logger.warn(`Cannot process message: Invalid user ID for socket ${socket.id}`);
              return;
            }
            
            logger.info(`Processing message for user ${extractedUserId}: ${data.content || ''}`, { timestamp: new Date().toISOString() });
            
            // Create a user message to echo back what was sent
            const userMessage: AIMessage = {
              id: data.id || randomUUID(),
              content: data.content || '',
              role: 'user',
              timestamp: new Date().toISOString(),
              metadata: {
                type: 'chat',
                read: true,
                timestamp: new Date().toISOString()
              }
            };
            
            // Send the user message back to confirm it was received
            await this.sendToUser(userId, 'ai:message', userMessage);
            // Also emit as 'message' for compatibility
            await this.sendToUser(userId, 'message' as any, userMessage);
            logger.info(`Sent user message confirmation to user ${extractedUserId}`);
            
            // Process the message using the AI service
            if (this.aiService && extractedUserId) {
              try {
                // Process the message and get a response
                const responseMessage = await this.aiService.processUserMessage(extractedUserId, data);
                
                // Send the response back to the user
                await this.sendToUser(userId, 'ai:message', responseMessage);
                // Also emit as 'message' for compatibility
                await this.sendToUser(userId, 'message' as any, responseMessage);
                logger.info(`Sent AI response to user ${extractedUserId}`);
              } catch (error) {
                logger.error(`Error processing message with AI service:`, error);
                
                // Send an error message if AI processing fails
                const errorMessage: AIMessage = {
                  id: randomUUID(),
                  content: `I'm sorry, but I encountered an error while processing your message.`,
                  role: 'assistant',
                  timestamp: new Date().toISOString(),
                  metadata: {
                    type: 'chat',
                    read: false,
                    timestamp: new Date().toISOString()
                  }
                };
                
                await this.sendToUser(userId, 'ai:message', errorMessage);
                await this.sendToUser(userId, 'message' as any, errorMessage);
              }
            } else {
              if (extractedUserId) {
                logger.warn(`AI service not available for processing message from user ${extractedUserId}`);
                
                // Send a fallback message if AI service is not available
                const fallbackMessage: AIMessage = {
                  id: randomUUID(),
                  content: `I received your message: "${data.content}". The AI service is currently unavailable.`,
                  role: 'assistant',
                  timestamp: new Date().toISOString(),
                  metadata: {
                    type: 'chat',
                    read: false,
                    timestamp: new Date().toISOString()
                  }
                };
                
                await this.sendToUser(userId, 'ai:message', fallbackMessage);
                await this.sendToUser(userId, 'message' as any, fallbackMessage);
              }
            }
            
          } catch (error) {
            logger.error('Error processing message:', error);
          }
        });

        socket.on('ai:chat', async (data: { message: string }) => {
          try {
            // Skip empty messages
            if (!data.message || typeof data.message !== 'string') {
              logger.warn(`Received invalid AI chat format from socket ${socket.id}`);
              return;
            }
            
            logger.info(`Received AI chat message: ${data.message}`);
            
            // Find the user ID associated with this socket
            let userId: string | undefined;
            for (const [id, sockets] of this.userSockets.entries()) {
              if (sockets.includes(socket.id)) {
                userId = id;
                break;
              }
            }
            
            if (!userId) {
              logger.warn(`Cannot process AI chat: No user ID found for socket ${socket.id}`);
              return;
            }
            
            // Extract the actual UUID from the userId if it's a JWT token
            const extractedUserId = this.extractUserIdFromToken(userId);

            if (!extractedUserId) {
              logger.warn(`Cannot process AI chat: Invalid user ID for socket ${socket.id}`);
              return;
            }
            
            logger.info(`Processing AI chat for user ${extractedUserId}: ${data.message}`);
            
            // Create a user message to echo back what was sent
            const userMessage: AIMessage = {
              id: randomUUID(),
              content: data.message,
              role: 'user',
              timestamp: new Date().toISOString(),
              metadata: {
                type: 'chat',
                read: true,
                timestamp: new Date().toISOString()
              }
            };
            
            // Send the user message back to confirm it was received
            await this.sendToUser(userId, 'ai:message', userMessage);
            logger.info(`Sent user message confirmation to user ${extractedUserId}`);
            
            // Process the message using the AI service
            if (this.aiService && extractedUserId) {
              try {
                // Process the message and get a response
                const responseMessage = await this.aiService.processUserMessage(extractedUserId, data.message);
                
                // Send the response back to the user
                await this.sendToUser(userId, 'ai:message', responseMessage);
                logger.info(`Sent AI response to user ${extractedUserId}`);
              } catch (error) {
                logger.error(`Error processing AI chat with AI service:`, error);
                
                // Send an error message if AI processing fails
                const errorMessage: AIMessage = {
                  id: randomUUID(),
                  content: `I'm sorry, but I encountered an error while processing your message.`,
                  role: 'assistant',
                  timestamp: new Date().toISOString(),
                  metadata: {
                    type: 'chat',
                    read: false,
                    timestamp: new Date().toISOString()
                  }
                };
                
                await this.sendToUser(userId, 'ai:message', errorMessage);
              }
            } else {
              if (extractedUserId) {
                logger.warn(`AI service not available for processing AI chat from user ${extractedUserId}`);
                
                // Send a fallback message if AI service is not available
                const fallbackMessage: AIMessage = {
                  id: randomUUID(),
                  content: `I received your message: "${data.message}". The AI service is currently unavailable.`,
                  role: 'assistant',
                  timestamp: new Date().toISOString(),
                  metadata: {
                    type: 'chat',
                    read: false,
                    timestamp: new Date().toISOString()
                  }
                };
                
                await this.sendToUser(userId, 'ai:message', fallbackMessage);
              }
            }
            
          } catch (error) {
            logger.error('Error processing AI chat message:', error);
          }
        });

        socket.on('disconnect', (reason) => {
          logger.info(`Client disconnected: ${socket.id}, reason: ${reason}`);
          for (const [userId, sockets] of this.userSockets.entries()) {
            const index = sockets.indexOf(socket.id);
            if (index !== -1) {
              sockets.splice(index, 1);
              if (sockets.length === 0) {
                this.userSockets.delete(userId);
              }
              logger.info(`User ${userId} disconnected from socket ${socket.id}`);
              break;
            }
          }
        });

        // Send a connection confirmation to the client
        socket.emit('connection:established', { status: 'connected', socketId: socket.id });
      });

      // Set up a health check interval
      this.connectionCheckInterval = setInterval(() => {
        if (this.io) {
          const connectedClients = this.io.engine.clientsCount;
          logger.debug(`WebSocket health check: ${connectedClients} clients connected`);
        }
      }, 30000); // Check every 30 seconds

      this.initialized = true;
      logger.info('WebSocket service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize WebSocket service:', error);
      throw error;
    }
  }

  public async sendToUser<T extends EventName>(
    userId: string,
    event: T,
    data: EventData<T>
  ): Promise<void> {
    const eventName = String(event);
    const isAIMessage = eventName === 'ai:message' || eventName === 'message';
    
    // Always log AI messages for debugging
    if (isAIMessage) {
      const d = data as any;
      console.log(`Sending ${eventName} to user ${userId}:`, {
        id: d.id,
        content: typeof d.content === 'string' ? d.content.substring(0, 50) + '...' : d.content,
        role: d.role,
        metadata: d.metadata
      });
    }
    
    if (!this.io || !this.initialized) {
      // Only log once per session, not for every message
      if (!isAIMessage) {
        logger.warn(`Cannot send ${eventName} to user ${userId}: WebSocket service not initialized`);
      }
      return;
    }

    // Skip entirely if no sockets and it's an AI message
    if (!this.userSockets.has(userId) || this.userSockets.get(userId)!.length === 0) {
      // Only log non-AI messages to reduce log spam
      if (!isAIMessage) {
        logger.warn(`No active sockets found for user ${userId}`);
        this.queueMessageForUser(userId, eventName, data);
      } else {
        console.log(`No active sockets found for user ${userId} to send ${eventName}`);
      }
      return;
    }

    const socketIds = this.userSockets.get(userId)!;
    let sentSuccessfully = false;

    for (const socketId of socketIds) {
      try {
        console.log(`Emitting ${eventName} to socket ${socketId}`);
        this.io.to(socketId).emit(event, data);
        sentSuccessfully = true;
      } catch (error) {
        console.error(`Failed to send ${eventName} to socket ${socketId}:`, error);
      }
    }

    if (sentSuccessfully) {
      // Only log non-AI messages or log at debug level for AI messages
      if (isAIMessage) {
        console.log(`Successfully sent ${eventName} to user ${userId}`);
      } else {
        logger.info(`Successfully sent ${eventName} to user ${userId}`);
      }
    } else {
      // Only log errors for non-AI messages
      if (!isAIMessage) {
        logger.error(`Failed to send ${eventName} to any socket for user ${userId}`);
        this.queueMessageForUser(userId, eventName, data);
      } else {
        console.error(`Failed to send ${eventName} to any socket for user ${userId}`);
      }
    }
  }

  private queueMessageForUser(userId: string, event: string, data: any): void {
    if (!this.messageQueue.has(userId)) {
      this.messageQueue.set(userId, []);
    }
    
    this.messageQueue.get(userId)!.push({ event, data });
    logger.info(`Message queued for user ${userId}: ${event}`);
    
    // Limit queue size to prevent memory issues
    const userQueue = this.messageQueue.get(userId)!;
    if (userQueue.length > 50) {
      userQueue.shift(); // Remove oldest message if queue gets too large
      logger.warn(`Message queue for user ${userId} exceeded 50 messages, oldest message removed`);
    }
  }

  private sendQueuedMessages(userId: string): void {
    if (!this.messageQueue.has(userId) || !this.userSockets.has(userId)) {
      return;
    }
    
    const userQueue = this.messageQueue.get(userId)!;
    const userSocketIds = this.userSockets.get(userId)!;
    
    if (userQueue.length === 0 || userSocketIds.length === 0) {
      return;
    }
    
    logger.info(`Sending ${userQueue.length} queued messages to user ${userId}`);
    
    // Process all queued messages
    const messagesToSend = [...userQueue]; // Create a copy to avoid modification issues
    this.messageQueue.set(userId, []); // Clear the queue
    
    for (const { event, data } of messagesToSend) {
      let sentSuccessfully = false;
      
      for (const socketId of userSocketIds) {
        try {
          this.io!.to(socketId).emit(event, data);
          sentSuccessfully = true;
          logger.debug(`Successfully sent queued ${event} to socket ${socketId}`);
        } catch (error) {
          logger.error(`Failed to send queued ${event} to socket ${socketId}:`, error);
        }
      }
      
      if (!sentSuccessfully) {
        // Re-queue the message if it couldn't be sent, but only if it's not an AI message
        if (event !== 'ai:message' && event !== 'message') {
          this.queueMessageForUser(userId, event, data);
        }
      }
    }
  }

  public async broadcast<T extends EventName>(
    event: T,
    data: EventData<T>
  ): Promise<void> {
    if (!this.initialized || !this.io) {
      logger.warn('WebSocket service not initialized');
      return;
    }

    this.io.emit(event, data);
  }

  private setupMonitoringEvents(): void {
    if (!this.monitoring) return;

    // Listen for monitoring events
    this.monitoring.on('metrics:update', (data: { health: SystemHealth; metrics: SystemMetrics; timestamp: string }) => {
      this.broadcast('metrics:update', data);
    });

    this.monitoring.on('error:new', (error: ErrorLog) => {
      this.broadcast('error:new', error);
    });

    this.monitoring.on('error:analysis', (data: { error: ErrorLog; analysis: AIAnalysis }) => {
      this.broadcast('error:analysis', data);
    });

    this.monitoring.on('error:log', (data: { type: string; data: LogEntry }) => {
      this.broadcast('error:log', data);
    });

    this.monitoring.on('metrics:status', (data: { health: SystemHealth; metrics: SystemMetrics; timestamp: string }) => {
      this.broadcast('metrics:status', data);
    });

    this.monitoring.on('activity:ai', (data: { type: string; data: { userId: string; action: string; timestamp: string; details: Record<string, any>; } }) => {
      this.broadcast('activity:ai', data);
    });

    this.monitoring.on('activity:log', (data: { type: string; data: LogEntry }) => {
      this.broadcast('activity:log', data);
    });

    this.monitoring.on('system:status', (data: { health: SystemHealth; metrics: SystemMetrics; timestamp: string }) => {
      this.broadcast('system:status', data);
    });
  }

  public async shutdown(): Promise<void> {
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
      this.connectionCheckInterval = null;
    }

    if (this.io) {
      await new Promise<void>((resolve) => {
        this.io?.close(() => {
          this.io = null;
          this.initialized = false;
          this.userSockets.clear();
          WebSocketService.instance = null;
          resolve();
        });
      });
    }
    logger.info('WebSocket service shut down successfully');
  }

  public getConnectionStatus(): boolean {
    return this.initialized && this.io !== null;
  }

  public setMonitoringService(monitoring: MonitoringService): void {
    this.monitoring = monitoring;
    this.setupMonitoringEvents();
  }

  public setAIService(service: AIService): void {
    this.aiService = service;
  }

  public setMetricsController(controller: MetricsController): void {
    this.metricsController = controller;
    logger.info('Metrics controller set in WebSocket service');
  }

  // Add this helper function to extract userId from JWT token
  private extractUserIdFromToken(token: string): string | null {
    try {
      // Check if the token is a JWT token (starts with ey and contains two dots)
      if (token && token.startsWith('ey') && token.split('.').length === 3) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-super-secret-jwt-key') as any;
        return decoded?.userId || null;
      }
      return token; // If not a JWT token, return as is
    } catch (error) {
      logger.error('Failed to decode JWT token:', error);
      return null; // Return null if decoding fails
    }
  }
}

export const getWebSocketService = WebSocketService.getInstance;
export const initializeWebSocketService = async (server: HTTPServer): Promise<void> => {
  const wsService = await WebSocketService.getInstance();
  await wsService.initialize(server);
};
