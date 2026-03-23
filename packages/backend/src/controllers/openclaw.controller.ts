import { Response } from 'express';
import { RequestWithUser } from '../types/express';
import { OpenClawService, getOpenClawService, OpenClawSkill } from '../services/openclaw.service';
import { AppDataSource } from '../database';
import { OpenClawConversation } from '../database/entities/OpenClawConversation';
import { logger } from '../utils/logger';

export class OpenClawController {
  private openClawService: OpenClawService;

  constructor() {
    this.openClawService = getOpenClawService();
  }

  /**
   * Get OpenClaw service status
   */
  async getStatus(req: RequestWithUser, res: Response) {
    try {
      const status = this.openClawService.getStatus();
      res.json(status);
    } catch (error) {
      logger.error('Error getting OpenClaw status:', error);
      res.status(500).json({ error: 'Failed to get OpenClaw status' });
    }
  }

  /**
   * Get OpenClaw configuration
   */
  async getConfig(req: RequestWithUser, res: Response) {
    try {
      const config = this.openClawService.getConfig();
      res.json(config);
    } catch (error) {
      logger.error('Error getting OpenClaw config:', error);
      res.status(500).json({ error: 'Failed to get OpenClaw configuration' });
    }
  }

  /**
   * Update OpenClaw configuration
   */
  async updateConfig(req: RequestWithUser, res: Response) {
    try {
      const config = req.body;
      await this.openClawService.updateConfig(config);
      res.json({ success: true, config: this.openClawService.getConfig() });
    } catch (error) {
      logger.error('Error updating OpenClaw config:', error);
      res.status(500).json({ error: 'Failed to update OpenClaw configuration' });
    }
  }

  /**
   * Get all skills
   */
  async getSkills(req: RequestWithUser, res: Response) {
    try {
      const skills = this.openClawService.getSkills();
      res.json({ skills });
    } catch (error) {
      logger.error('Error getting OpenClaw skills:', error);
      res.status(500).json({ error: 'Failed to get skills' });
    }
  }

  /**
   * Get a specific skill by ID
   */
  async getSkill(req: RequestWithUser, res: Response) {
    try {
      const { skillId } = req.params;
      const skill = this.openClawService.getSkill(skillId);

      if (!skill) {
        return res.status(404).json({ error: 'Skill not found' });
      }

      res.json(skill);
    } catch (error) {
      logger.error('Error getting OpenClaw skill:', error);
      res.status(500).json({ error: 'Failed to get skill' });
    }
  }

  /**
   * Enable or disable a skill
   */
  async toggleSkill(req: RequestWithUser, res: Response) {
    try {
      const { skillId } = req.params;
      const { enabled } = req.body;

      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be a boolean' });
      }

      const success = this.openClawService.setSkillEnabled(skillId, enabled);

      if (!success) {
        return res.status(404).json({ error: 'Skill not found' });
      }

      res.json({ success: true, skillId, enabled });
    } catch (error) {
      logger.error('Error toggling OpenClaw skill:', error);
      res.status(500).json({ error: 'Failed to toggle skill' });
    }
  }

  /**
   * Add a custom skill
   */
  async addSkill(req: RequestWithUser, res: Response) {
    try {
      const skill = req.body as OpenClawSkill;

      if (!skill.id || !skill.name || !skill.category) {
        return res.status(400).json({ error: 'Skill must have id, name, and category' });
      }

      this.openClawService.addSkill(skill);
      res.status(201).json({ success: true, skill });
    } catch (error) {
      logger.error('Error adding OpenClaw skill:', error);
      res.status(500).json({ error: 'Failed to add skill' });
    }
  }

  /**
   * Remove a skill
   */
  async removeSkill(req: RequestWithUser, res: Response) {
    try {
      const { skillId } = req.params;
      const success = this.openClawService.removeSkill(skillId);

      if (!success) {
        return res.status(404).json({ error: 'Skill not found' });
      }

      res.json({ success: true });
    } catch (error) {
      logger.error('Error removing OpenClaw skill:', error);
      res.status(500).json({ error: 'Failed to remove skill' });
    }
  }

  /**
   * Update skill configuration
   */
  async updateSkillConfig(req: RequestWithUser, res: Response) {
    try {
      const { skillId } = req.params;
      const config = req.body;

      const success = this.openClawService.updateSkillConfig(skillId, config);

      if (!success) {
        return res.status(404).json({ error: 'Skill not found' });
      }

      res.json({ success: true, skill: this.openClawService.getSkill(skillId) });
    } catch (error) {
      logger.error('Error updating OpenClaw skill config:', error);
      res.status(500).json({ error: 'Failed to update skill configuration' });
    }
  }

  /**
   * Execute a skill action
   */
  async executeAction(req: RequestWithUser, res: Response) {
    try {
      const { skillId, actionId } = req.params;
      const parameters = req.body;
      const userId = req.user?.id;

      const result = await this.openClawService.executeSkillAction(
        skillId,
        actionId,
        parameters,
        userId
      );

      res.json(result);
    } catch (error) {
      logger.error('Error executing OpenClaw skill action:', error);
      const message = error instanceof Error ? error.message : 'Failed to execute skill action';
      res.status(500).json({ error: message });
    }
  }

  /**
   * Send a message to OpenClaw and save to conversation history
   */
  async sendMessage(req: RequestWithUser, res: Response) {
    try {
      const { content } = req.body;
      const userId = req.user?.id;

      if (!content) {
        return res.status(400).json({ error: 'Message content is required' });
      }

      // Save user message to conversation history
      if (userId) {
        try {
          const repo = AppDataSource.getRepository(OpenClawConversation);
          const userMsg = repo.create({ userId, role: 'user' as const, content });
          await repo.save(userMsg);
        } catch (dbError) {
          logger.warn('Failed to save user message to history:', dbError);
        }
      }

      const response = await this.openClawService.sendMessage(content, userId);

      // Save assistant response to conversation history
      if (userId) {
        try {
          const repo = AppDataSource.getRepository(OpenClawConversation);
          const assistantMsg = repo.create({ userId, role: 'assistant' as const, content: response });
          await repo.save(assistantMsg);
        } catch (dbError) {
          logger.warn('Failed to save assistant message to history:', dbError);
        }
      }

      res.json({ response });
    } catch (error) {
      logger.error('Error sending message to OpenClaw:', error);
      const message = error instanceof Error ? error.message : 'Failed to send message';
      res.status(500).json({ error: message });
    }
  }

  /**
   * Get conversation history for the current user
   */
  async getConversationHistory(req: RequestWithUser, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;

      const repo = AppDataSource.getRepository(OpenClawConversation);
      const [messages, total] = await repo.findAndCount({
        where: { userId },
        order: { createdAt: 'ASC' },
        take: limit,
        skip: offset,
      });

      res.json({ messages, total, limit, offset });
    } catch (error) {
      logger.error('Error getting conversation history:', error);
      res.status(500).json({ error: 'Failed to get conversation history' });
    }
  }

  /**
   * Clear conversation history for the current user
   */
  async clearConversationHistory(req: RequestWithUser, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const repo = AppDataSource.getRepository(OpenClawConversation);
      await repo.delete({ userId });

      res.json({ success: true, message: 'Conversation history cleared' });
    } catch (error) {
      logger.error('Error clearing conversation history:', error);
      res.status(500).json({ error: 'Failed to clear conversation history' });
    }
  }
}

export function createOpenClawController(): OpenClawController {
  return new OpenClawController();
}
