import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, GenerativeModel } from '@google/generative-ai';
import { logger } from '../utils/logger';
import { OpenAI } from 'openai';
import { Anthropic } from '@anthropic-ai/sdk';
import { AppDataSource } from '../database';
import { encrypt, decrypt } from '../utils/encryption';
import {
  AIMessage,
  AIProviderConfig,
  AISettings,
  AISystemStatus,
  LLMProvider,
  SystemMetrics,
  ResourceStatus,
  RequestMetric
} from '@admin-ai/shared/src/types/ai';
import { randomUUID } from 'crypto';
import { WebSocketService, getWebSocketService } from './websocket.service';
import { AISettingsService } from './aiSettings.service';
import { AppError } from '../utils/error';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { ArrayContains } from 'typeorm';
import { WebSocketEvents } from '@admin-ai/shared/src/types/websocket';
import { OpenClawService, getOpenClawService } from './openclaw.service';

const aiSettingsRepository = AppDataSource.getRepository('AISettings');

interface PathStats {
  path: string;
  count: number;
  avgResponseTime: number;
  errors: number;
  total: number;
}

interface EndpointStats {
  endpoint: string;
  count: number;
  avgResponseTime: number;
  errors: number;
  duration: number;
}

export class AIService extends EventEmitter {
  public static instance: AIService | null = null;
  private isInitialized: boolean = false;
  private isBaseInitialized: boolean = false;
  private providersInitialized: boolean = false;
  private isReady: boolean = false;
  private aiSettingsService: AISettingsService | null = null;
  private webSocketService: WebSocketService | null = null;
  private activeProviders: Map<string, any> = new Map();
  private currentUserId: string | null = null;
  private openai?: OpenAI;
  private gemini?: GoogleGenerativeAI;
  private anthropic?: Anthropic;
  private safetySettings = [
    {
      category: HarmCategory.HARM_CATEGORY_HARASSMENT,
      threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
      threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
      threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
      threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    },
  ];

  private lastStatusBroadcast: number = 0;
  private readonly STATUS_BROADCAST_DEBOUNCE = 5000; // 5 seconds
  private lastReadyStatus: boolean = false;
  private providers: AIProviderConfig[] = [];
  private status: string = 'idle';

  constructor() {
    super();
  }

  public setAISettingsService(service: AISettingsService) {
    this.aiSettingsService = service;
  }

  public setWebSocketService(wsService: WebSocketService) {
    this.webSocketService = wsService;
  }

  private settings: AISettings = {
    providers: [],
    enableRandomMessages: true,
    messageInterval: 5000,
    systemCommands: []
  };

  private openClawService: OpenClawService | null = null;

  private llmClients: {
    openai: OpenAI | undefined;
    gemini: GoogleGenerativeAI | undefined;
    anthropic: Anthropic | undefined;
    openclaw: OpenClawService | undefined;
  } = {
    openai: undefined,
    gemini: undefined,
    anthropic: undefined,
    openclaw: undefined
  };

  /**
   * Initialize AI providers for a specific user
   * This method is called after user login to ensure the AI service is ready
   * @param userId The ID of the user to initialize providers for
   */
  public async initializeProvidersForUser(userId: string): Promise<void> {
    try {
      logger.info(`Initializing AI providers for user ${userId}`);
      
      if (!this.aiSettingsService) {
        logger.warn('Cannot initialize providers: AI Settings service not available');
        return;
      }
      
      // Get all provider settings for the user
      const providers = await this.aiSettingsService.getAllProviderSettings(userId);
      
      // Find active and verified providers
      const activeProviders = providers.filter(p => p.isActive && p.isVerified);
      
      if (activeProviders.length === 0) {
        logger.info(`No active verified providers found for user ${userId}`);
        return;
      }
      
      // Initialize each active provider
      for (const provider of activeProviders) {
        const providerType = provider.provider as LLMProvider;
        
        // Skip if this provider is already initialized
        if (this.llmClients[providerType]) {
          logger.info(`${providerType} client already initialized, skipping`);
          continue;
        }
        
        // Get the decrypted API key
        const apiKey = await this.aiSettingsService.getDecryptedApiKey(userId, providerType);
        
        if (!apiKey) {
          logger.warn(`No API key found for ${providerType}, skipping initialization`);
          continue;
        }
        
        // Initialize the client
        await this.initializeClient(providerType, apiKey);
        
        logger.info(`Successfully initialized ${providerType} client for user ${userId}`);
      }
      
      // Update status after initialization
      this.providersInitialized = true;
      await this.broadcastStatus();
      
      logger.info(`AI providers initialization completed for user ${userId}`);
    } catch (error) {
      logger.error(`Failed to initialize AI providers for user ${userId}:`, error);
      // Don't throw the error to prevent login failure
    }
  }

  private async generateSystemMessage(
    content: string,
    status: 'success' | 'error' | 'info' | 'warning',
    category: string,
    source: {
      page?: string;
      controller?: string;
      action?: string;
      details?: Record<string, any>;
    },
    userId: string
  ): Promise<void> {
    try {
      // Get the active provider settings
      const provider = await this.getActiveProvider(userId);
      const model = provider?.selectedModel;

      // Generate AI response based on the event
      let aiResponse = content;
      if (provider && this.llmClients[provider.provider as LLMProvider]) {
        try {
          const prompt = `As an AI system administrator, generate a natural response for the following system event:
Event: ${content}
Status: ${status}
Category: ${category}
Source: ${JSON.stringify(source)}

Generate a response that:
1. Explains what happened in natural language
2. Provides context about the operation
3. Suggests any relevant actions if needed
4. Uses a helpful and informative tone`;

          // Use the appropriate LLM client to generate response
          switch (provider.provider) {
            case 'openai':
              const openaiResponse = await (this.llmClients[provider.provider as LLMProvider] as OpenAI).chat.completions.create({
                model: model || 'gpt-3.5-turbo',
                messages: [{ role: 'user', content: prompt }],
              });
              aiResponse = openaiResponse.choices[0]?.message?.content || content;
              break;
            // Add cases for other providers
          }
        } catch (error) {
          logger.error('Failed to generate AI response:', error);
          // Fall back to original content if AI generation fails
        }
      }

      // Send the AI-generated message if WebSocket service is available
      if (this.webSocketService) {
        const message: WebSocketEvents['ai:message'] = {
          id: crypto.randomUUID(),
          content: aiResponse,
          role: 'assistant',
          timestamp: new Date().toISOString(),
          metadata: {
            type: 'notification',
            status,
            category,
            source,
            timestamp: new Date().toISOString(),
            provider: provider?.provider,
            model: model || undefined,
            read: false
          }
        };
        await this.webSocketService.sendToUser(userId, 'ai:message', message);
      }
    } catch (error) {
      logger.error('Failed to generate system message:', error);
      throw error;
    }
  }

  public async handleSystemEvent(
    event: {
      type: string;
      content: string;
      status: 'success' | 'error' | 'info' | 'warning';
      category: string;
      source: {
        page?: string;
        controller?: string;
        action?: string;
        details?: Record<string, any>;
      };
    },
    userId: string
  ): Promise<void> {
    await this.generateSystemMessage(
      event.content,
      event.status,
      event.category,
      event.source,
      userId
    );
  }

  private async getActiveProvider(userId: string | undefined): Promise<AIProviderConfig | undefined> {
    if (!userId || !this.aiSettingsService) return undefined;
    const providers = await this.aiSettingsService.getAllProviderSettings(userId);
    return providers.find(p => p.isActive);
  }

  private async sendNotification(userId: string, content: string, status: 'success' | 'error' | 'info' | 'warning', provider?: LLMProvider, model?: string) {
    const timestamp = new Date().toISOString();
    const message: WebSocketEvents['ai:message'] = {
      id: randomUUID(),
      content,
      role: 'system',
      timestamp,
      metadata: {
        type: 'notification',
        status,
        category: 'connection',
        source: {
          page: 'AI Service',
          controller: 'AIService',
          action: 'sendNotification'
        },
        timestamp,
        read: false,
        provider,
        model
      }
    };

    if (this.webSocketService) {
      await this.webSocketService.broadcast('ai:message', message);
    }
  }

  private async initializeClient(provider: LLMProvider, apiKey: string): Promise<void> {
    try {
      logger.info(`Initializing ${provider} client...`);
      
      switch (provider) {
        case 'openai':
          this.openai = new OpenAI({ apiKey });
          this.llmClients.openai = this.openai;
          break;
        case 'gemini':
          this.gemini = new GoogleGenerativeAI(apiKey);
          this.llmClients.gemini = this.gemini;
          break;
        case 'anthropic':
          this.anthropic = new Anthropic({ apiKey });
          this.llmClients.anthropic = this.anthropic;
          break;
        case 'openclaw':
          this.openClawService = getOpenClawService();
          await this.openClawService.initialize({ gatewayUrl: apiKey, enabled: true });
          if (this.webSocketService) {
            this.openClawService.setWebSocketService(this.webSocketService);
          }
          this.llmClients.openclaw = this.openClawService;
          break;
        default:
          throw new Error(`Unsupported provider: ${provider}`);
      }
      
      logger.info(`${provider} client initialized successfully`);
    } catch (error) {
      logger.error(`Failed to initialize ${provider} client:`, error);
      throw error;
    }
  }

  public async initializeBase(): Promise<void> {
    if (this.isBaseInitialized) return;

    try {
      // Initialize base service
      this.isBaseInitialized = true;
      this.isReady = true;
      
      // Broadcast initial status
      await this.broadcastStatus();
      
      logger.info('AI service base initialization completed');
    } catch (error) {
      logger.error('Failed to initialize AI service base:', error);
      throw error;
    }
  }

  private async broadcastStatus(): Promise<void> {
    if (!this.webSocketService) return;

    const now = Date.now();
    if (now - this.lastStatusBroadcast < this.STATUS_BROADCAST_DEBOUNCE && this.lastReadyStatus === this.isReady) return;

    // Get active providers
    const activeProviders = Object.entries(this.llmClients)
      .filter(([_, client]) => client !== undefined)
      .map(([provider, _]) => provider);

    const status: WebSocketEvents['ai:status'] = {
      ready: this.isReady,
      initialized: this.isBaseInitialized,
      connected: this.isBaseInitialized && activeProviders.length > 0,
      hasProviders: activeProviders.length > 0,
      activeProviders,
      timestamp: new Date().toISOString()
    };

    logger.info(`Broadcasting AI status: ${JSON.stringify(status)}`);
    await this.webSocketService.broadcast('ai:status', status);
    this.lastStatusBroadcast = now;
    this.lastReadyStatus = this.isReady;
  }

  public async sendMessage(userId: string, message: AIMessage): Promise<void> {
    if (!this.webSocketService) return;
    await this.webSocketService.sendToUser(userId, 'ai:message', message);
  }

  /**
   * Process a user message and generate a response using the active AI provider
   * @param userId The ID of the user sending the message
   * @param message The message content or AIMessage object
   * @returns The AI-generated response message
   */
  public async processUserMessage(userId: string, message: string | AIMessage): Promise<AIMessage> {
    try {
      logger.info(`Processing user message for user ${userId}`);
      
      // Get the active provider for this user
      const provider = await this.getActiveProvider(userId);
      
      if (!provider || !provider.isActive || !provider.isVerified) {
        logger.warn(`No active verified provider found for user ${userId}`);
        return {
          id: randomUUID(),
          content: "I'm sorry, but there is no active AI provider configured. Please check your AI settings.",
          role: 'assistant',
          timestamp: new Date().toISOString(),
          metadata: {
            type: 'chat',
            read: false,
            timestamp: new Date().toISOString()
          }
        };
      }
      
      // Extract message content
      const content = typeof message === 'string' ? message : message.content;
      
      // Get the appropriate LLM client
      let llmClient = this.llmClients[provider.provider as LLMProvider];
      
      // If the client is not initialized, try to initialize it
      if (!llmClient && this.aiSettingsService) {
        try {
          logger.info(`LLM client not initialized for provider ${provider.provider}, attempting to initialize now`);
          
          // Get the decrypted API key
          const apiKey = await this.aiSettingsService.getDecryptedApiKey(userId, provider.provider as LLMProvider);
          
          if (apiKey) {
            // Initialize the client
            await this.initializeClient(provider.provider as LLMProvider, apiKey);
            
            // Get the client again after initialization
            llmClient = this.llmClients[provider.provider as LLMProvider];
            
            logger.info(`Successfully initialized ${provider.provider} client for user ${userId}`);
          } else {
            logger.warn(`No API key found for ${provider.provider}, cannot initialize client`);
          }
        } catch (error) {
          logger.error(`Failed to initialize ${provider.provider} client:`, error);
        }
      }
      
      // Check if client is now initialized
      if (!llmClient) {
        logger.warn(`LLM client not initialized for provider ${provider.provider}`);
        return {
          id: randomUUID(),
          content: `I'm sorry, but the ${provider.provider} service is not properly initialized. Please check your API key and settings.`,
          role: 'assistant',
          timestamp: new Date().toISOString(),
          metadata: {
            type: 'chat',
            read: false,
            provider: provider.provider,
            model: provider.selectedModel,
            timestamp: new Date().toISOString()
          }
        };
      }
      
      // Generate response based on the provider
      let responseContent = '';
      
      switch (provider.provider) {
        case 'openai':
          const openaiResponse = await (llmClient as OpenAI).chat.completions.create({
            model: provider.selectedModel || 'gpt-3.5-turbo',
            messages: [{ role: 'user', content }],
          });
          responseContent = openaiResponse.choices[0]?.message?.content || 'No response generated';
          break;
          
        case 'gemini':
          const geminiModel = (llmClient as GoogleGenerativeAI).getGenerativeModel({
            model: provider.selectedModel || 'gemini-2.0-flash',
            safetySettings: this.safetySettings
          });
          const geminiResponse = await geminiModel.generateContent(content);
          responseContent = geminiResponse.response.text() || 'No response generated';
          break;
          
        case 'anthropic':
          const anthropicResponse = await (llmClient as Anthropic).messages.create({
            model: provider.selectedModel || 'claude-3-haiku-20240307',
            max_tokens: 1024,
            messages: [{ role: 'user', content }]
          });
          responseContent = anthropicResponse.content[0]?.text || 'No response generated';
          break;

        case 'openclaw':
          const openClawSvc = llmClient as OpenClawService;
          responseContent = await openClawSvc.sendMessage(content, userId);
          break;
          
        default:
          responseContent = `Provider ${provider.provider} is not supported yet.`;
      }
      
      // Create and return the response message
      return {
        id: randomUUID(),
        content: responseContent,
        role: 'assistant',
        timestamp: new Date().toISOString(),
        metadata: {
          type: 'chat',
          read: false,
          provider: provider.provider,
          model: provider.selectedModel,
          timestamp: new Date().toISOString()
        }
      };
      
    } catch (error) {
      logger.error('Error processing user message:', error);
      
      // Return an error message
      return {
        id: randomUUID(),
        content: `I'm sorry, but I encountered an error while processing your message: ${error instanceof Error ? error.message : 'Unknown error'}`,
        role: 'assistant',
        timestamp: new Date().toISOString(),
        metadata: {
          type: 'chat',
          read: false,
          timestamp: new Date().toISOString()
        }
      };
    }
  }

  public async broadcastMessage(message: AIMessage): Promise<void> {
    if (!this.webSocketService) return;
    await this.webSocketService.broadcast('ai:message', message);
  }

  public async updateStatus(status: WebSocketEvents['ai:status']): Promise<void> {
    if (!this.webSocketService) return;
    await this.webSocketService.broadcast('ai:status', status);
  }

  public getStatus(): WebSocketEvents['ai:status'] {
    return {
      ready: this.isReady
    };
  }

  private async notifyUser(userId: string): Promise<void> {
    if (!this.webSocketService) return;

    const status: WebSocketEvents['ai:status'] = {
      ready: this.isReady
    };

    await this.webSocketService.sendToUser(userId, 'ai:status', status);
  }

  // Add missing analysis methods
  public async analyzeMetrics(metrics: SystemMetrics): Promise<any> {
    try {
      // Get the active provider
      const activeProvider = await this.getActiveProvider(this.currentUserId);
      if (!activeProvider || !this.isReady) {
        // If no active provider, generate synthetic analysis
        return this.generateSyntheticMetricsAnalysis(metrics);
      }

      // Prepare the prompt for the AI
      const prompt = `
        Analyze the following system metrics and provide insights:
        
        CPU Usage: ${metrics.cpuUsage}%
        Memory Usage: ${metrics.memoryUsage}%
        Active Users: ${metrics.activeUsers}
        Total Requests: ${metrics.totalRequests}
        Average Response Time: ${metrics.averageResponseTime}ms
        Error Count: ${metrics.errorCount}
        Warning Count: ${metrics.warningCount}
        
        Provide a concise analysis with the following structure:
        1. Summary of system health
        2. Potential issues or bottlenecks
        3. Recommendations for optimization
        4. Performance score (0-100)
      `;

      // Use the appropriate provider to analyze the metrics
      let analysis;
      if (activeProvider.provider === 'openai' && this.openai) {
        const response = await this.openai.chat.completions.create({
          model: activeProvider.selectedModel || 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 500,
        });
        analysis = response.choices[0]?.message?.content || '';
      } else if (activeProvider.provider === 'gemini' && this.gemini) {
        const model = this.gemini.getGenerativeModel({ model: activeProvider.selectedModel || 'gemini-pro' });
        const result = await model.generateContent(prompt);
        analysis = result.response.text();
      } else if (activeProvider.provider === 'anthropic' && this.anthropic) {
        const response = await this.anthropic.messages.create({
          model: activeProvider.selectedModel || 'claude-3-sonnet-20240229',
          max_tokens: 500,
          messages: [{ role: 'user', content: prompt }],
        });
        analysis = response.content[0]?.text || '';
      } else {
        // Fallback to synthetic analysis
        return this.generateSyntheticMetricsAnalysis(metrics);
      }

      // Parse the analysis into a structured format
      return {
        summary: this.extractSection(analysis, 'Summary'),
        issues: this.extractSection(analysis, 'Potential issues'),
        recommendations: this.extractSection(analysis, 'Recommendations'),
        score: this.extractScore(analysis) || Math.round(Math.random() * 40 + 60), // Fallback score
        timestamp: new Date().toISOString(),
        provider: activeProvider.provider,
        model: activeProvider.selectedModel,
      };
    } catch (error) {
      logger.error('Error analyzing metrics with AI:', error);
      return this.generateSyntheticMetricsAnalysis(metrics);
    }
  }

  private extractSection(text: string, sectionName: string): string {
    const regex = new RegExp(`${sectionName}[^\\n]*\\n(.+?)(?=\\n\\d|$)`, 's');
    const match = text.match(regex);
    return match ? match[1].trim() : '';
  }

  private extractScore(text: string): number | null {
    const regex = /Performance score[^0-9]*(\d+)/i;
    const match = text.match(regex);
    return match ? parseInt(match[1], 10) : null;
  }

  private generateSyntheticMetricsAnalysis(metrics: SystemMetrics): any {
    const cpuStatus = metrics.cpuUsage > 80 ? 'high' : metrics.cpuUsage > 50 ? 'moderate' : 'normal';
    const memoryStatus = metrics.memoryUsage > 80 ? 'high' : metrics.memoryUsage > 50 ? 'moderate' : 'normal';
    const responseTimeStatus = metrics.averageResponseTime > 500 ? 'slow' : metrics.averageResponseTime > 200 ? 'moderate' : 'fast';
    
    const issues = [];
    const recommendations = [];
    
    if (cpuStatus === 'high') {
      issues.push('CPU usage is high, which may lead to performance degradation');
      recommendations.push('Consider scaling up CPU resources or optimizing CPU-intensive operations');
    }
    
    if (memoryStatus === 'high') {
      issues.push('Memory usage is high, which may lead to out-of-memory errors');
      recommendations.push('Consider increasing memory allocation or optimizing memory usage');
    }
    
    if (responseTimeStatus === 'slow') {
      issues.push('Response times are slow, which may affect user experience');
      recommendations.push('Optimize database queries and API endpoints to reduce response times');
    }
    
    if (metrics.errorCount > 0) {
      issues.push(`System has ${metrics.errorCount} errors that need attention`);
      recommendations.push('Investigate and fix errors in the error logs');
    }
    
    // Calculate a synthetic health score
    const cpuScore = 100 - metrics.cpuUsage;
    const memoryScore = 100 - metrics.memoryUsage;
    const responseTimeScore = Math.max(0, 100 - (metrics.averageResponseTime / 10));
    const errorScore = Math.max(0, 100 - (metrics.errorCount * 5));
    
    const overallScore = Math.round((cpuScore + memoryScore + responseTimeScore + errorScore) / 4);
    
    return {
      summary: `System is operating at ${overallScore > 80 ? 'optimal' : overallScore > 60 ? 'acceptable' : 'suboptimal'} levels. CPU usage is ${cpuStatus}, memory usage is ${memoryStatus}, and response times are ${responseTimeStatus}.`,
      issues: issues.length > 0 ? issues : ['No significant issues detected'],
      recommendations: recommendations.length > 0 ? recommendations : ['Continue monitoring system performance'],
      score: overallScore,
      timestamp: new Date().toISOString(),
      provider: 'synthetic',
      model: 'rule-based',
    };
  }

  public async analyzeError(error: { error: any; context: any }): Promise<any> {
    try {
      // Get the active provider
      const activeProvider = await this.getActiveProvider(this.currentUserId);
      if (!activeProvider || !this.isReady) {
        // If no active provider, generate synthetic analysis
        return this.generateSyntheticErrorAnalysis(error);
      }

      // Prepare the prompt for the AI
      const prompt = `
        Analyze the following error and provide insights:
        
        Error: ${JSON.stringify(error.error)}
        Context: ${JSON.stringify(error.context)}
        
        Provide a concise analysis with the following structure:
        1. Root cause analysis
        2. Potential impact
        3. Recommended actions
        4. Severity level (low, medium, high, critical)
      `;

      // Use the appropriate provider to analyze the error
      let analysis;
      if (activeProvider.provider === 'openai' && this.openai) {
        const response = await this.openai.chat.completions.create({
          model: activeProvider.selectedModel || 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 500,
        });
        analysis = response.choices[0]?.message?.content || '';
      } else if (activeProvider.provider === 'gemini' && this.gemini) {
        const model = this.gemini.getGenerativeModel({ model: activeProvider.selectedModel || 'gemini-pro' });
        const result = await model.generateContent(prompt);
        analysis = result.response.text();
      } else if (activeProvider.provider === 'anthropic' && this.anthropic) {
        const response = await this.anthropic.messages.create({
          model: activeProvider.selectedModel || 'claude-3-sonnet-20240229',
          max_tokens: 500,
          messages: [{ role: 'user', content: prompt }],
        });
        analysis = response.content[0]?.text || '';
      } else {
        // Fallback to synthetic analysis
        return this.generateSyntheticErrorAnalysis(error);
      }

      return {
        rootCause: this.extractSection(analysis, 'Root cause'),
        impact: this.extractSection(analysis, 'Potential impact'),
        recommendations: this.extractSection(analysis, 'Recommended actions'),
        severity: this.extractSeverity(analysis) || 'medium',
        timestamp: new Date().toISOString(),
        provider: activeProvider.provider,
        model: activeProvider.selectedModel,
      };
    } catch (error) {
      logger.error('Error analyzing error with AI:', error);
      return this.generateSyntheticErrorAnalysis(error);
    }
  }

  private extractSeverity(text: string): string | null {
    const regex = /Severity level[^:]*:\s*(\w+)/i;
    const match = text.match(regex);
    return match ? match[1].toLowerCase() : null;
  }

  private generateSyntheticErrorAnalysis(error: { error: any; context: any }): any {
    const errorMessage = error.error?.message || 'Unknown error';
    const errorStack = error.error?.stack || '';
    const errorContext = error.context || {};
    
    // Determine severity based on error message and context
    let severity = 'medium';
    if (errorMessage.includes('FATAL') || errorMessage.includes('CRITICAL')) {
      severity = 'critical';
    } else if (errorMessage.includes('ERROR')) {
      severity = 'high';
    } else if (errorMessage.includes('WARNING')) {
      severity = 'medium';
    } else {
      severity = 'low';
    }
    
    // Generate synthetic root cause analysis
    let rootCause = 'The error appears to be related to ';
    if (errorStack.includes('database') || errorMessage.includes('SQL')) {
      rootCause += 'a database operation failure.';
    } else if (errorStack.includes('network') || errorMessage.includes('connection')) {
      rootCause += 'a network or connection issue.';
    } else if (errorStack.includes('memory') || errorMessage.includes('heap')) {
      rootCause += 'memory management or allocation.';
    } else {
      rootCause += 'application logic or configuration.';
    }
    
    // Generate synthetic impact analysis
    let impact = 'This error may ';
    if (severity === 'critical') {
      impact += 'cause system-wide outage or data corruption.';
    } else if (severity === 'high') {
      impact += 'affect multiple users or critical functionality.';
    } else if (severity === 'medium') {
      impact += 'degrade performance or affect specific features.';
    } else {
      impact += 'have minimal impact on system operation.';
    }
    
    // Generate synthetic recommendations
    let recommendations = [];
    if (errorStack.includes('database') || errorMessage.includes('SQL')) {
      recommendations.push('Check database connection and query syntax');
      recommendations.push('Verify database server status and performance');
    } else if (errorStack.includes('network') || errorMessage.includes('connection')) {
      recommendations.push('Verify network connectivity and firewall settings');
      recommendations.push('Check for service availability and rate limiting');
    } else if (errorStack.includes('memory') || errorMessage.includes('heap')) {
      recommendations.push('Optimize memory usage and increase allocation if needed');
      recommendations.push('Check for memory leaks in long-running processes');
    } else {
      recommendations.push('Review application logs for additional context');
      recommendations.push('Check recent code changes that might have introduced the issue');
    }
    
    return {
      rootCause,
      impact,
      recommendations,
      severity,
      timestamp: new Date().toISOString(),
      provider: 'synthetic',
      model: 'rule-based',
    };
  }

  public async analyzeData(data: any[]): Promise<any> {
    // Implementation will be added later
    return null;
  }

  public async generateSchema(description: string): Promise<any> {
    // Implementation will be added later
    return null;
  }

  public async generateCrudConfig(schema: any): Promise<any> {
    // Implementation will be added later
    return null;
  }

  public async generateDashboardSuggestions(dataset: any): Promise<any> {
    // Implementation will be added later
    return null;
  }
}

export const getAIService = (): AIService => {
  if (!AIService.instance) {
    AIService.instance = new AIService();
  }
  return AIService.instance;
};
