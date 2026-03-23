import { api } from './api';
import { logger } from '../utils/logger';

export interface OpenClawSkill {
  id: string;
  name: string;
  description: string;
  category: 'website-builder' | 'content-creation' | 'social-media' | 'email-outreach' | 'analytics' | 'invoicing';
  enabled: boolean;
  instructions: string;
  triggers: string[];
  actions: OpenClawAction[];
  config: Record<string, string>;
}

export interface OpenClawAction {
  id: string;
  name: string;
  description: string;
  endpoint?: string;
  method?: string;
  parameters: Record<string, string>;
}

export interface OpenClawStatus {
  connected: boolean;
  gatewayUrl: string;
  activeSkills: number;
  totalSkills: number;
  lastHeartbeat?: string;
  channels: string[];
}

export interface OpenClawConfig {
  gatewayUrl: string;
  apiKey: string;
  enabled: boolean;
  skills: OpenClawSkill[];
  webhookUrl?: string;
  channels: string[];
}

class OpenClawFrontendService {
  /**
   * Get OpenClaw service status
   */
  async getStatus(): Promise<OpenClawStatus> {
    try {
      const response = await api.get('/openclaw/status');
      return response.data;
    } catch (error) {
      logger.error('Failed to get OpenClaw status:', error);
      throw error;
    }
  }

  /**
   * Get OpenClaw configuration
   */
  async getConfig(): Promise<OpenClawConfig> {
    try {
      const response = await api.get('/openclaw/config');
      return response.data;
    } catch (error) {
      logger.error('Failed to get OpenClaw config:', error);
      throw error;
    }
  }

  /**
   * Update OpenClaw configuration
   */
  async updateConfig(config: Partial<OpenClawConfig>): Promise<OpenClawConfig> {
    try {
      const response = await api.put('/openclaw/config', config);
      return response.data.config;
    } catch (error) {
      logger.error('Failed to update OpenClaw config:', error);
      throw error;
    }
  }

  /**
   * Get all skills
   */
  async getSkills(): Promise<OpenClawSkill[]> {
    try {
      const response = await api.get('/openclaw/skills');
      return response.data.skills;
    } catch (error) {
      logger.error('Failed to get OpenClaw skills:', error);
      throw error;
    }
  }

  /**
   * Get a specific skill
   */
  async getSkill(skillId: string): Promise<OpenClawSkill> {
    try {
      const response = await api.get(`/openclaw/skills/${skillId}`);
      return response.data;
    } catch (error) {
      logger.error('Failed to get OpenClaw skill:', error);
      throw error;
    }
  }

  /**
   * Toggle a skill on/off
   */
  async toggleSkill(skillId: string, enabled: boolean): Promise<void> {
    try {
      await api.patch(`/openclaw/skills/${skillId}/toggle`, { enabled });
    } catch (error) {
      logger.error('Failed to toggle OpenClaw skill:', error);
      throw error;
    }
  }

  /**
   * Execute a skill action
   */
  async executeAction(skillId: string, actionId: string, parameters: Record<string, unknown>): Promise<Record<string, unknown>> {
    try {
      const response = await api.post(`/openclaw/skills/${skillId}/actions/${actionId}`, parameters);
      return response.data;
    } catch (error) {
      logger.error('Failed to execute OpenClaw action:', error);
      throw error;
    }
  }

  /**
   * Send a message to OpenClaw
   */
  async sendMessage(content: string): Promise<string> {
    try {
      const response = await api.post('/openclaw/message', { content });
      return response.data.response;
    } catch (error) {
      logger.error('Failed to send message to OpenClaw:', error);
      throw error;
    }
  }
}

export const openClawService = new OpenClawFrontendService();
