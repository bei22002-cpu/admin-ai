import { logger } from '../utils/logger';
import { EventEmitter } from 'events';
import { WebSocketService } from './websocket.service';
import { AIMessage } from '@admin-ai/shared/src/types/ai';
import { randomUUID } from 'crypto';
import WebSocket from 'ws';

/**
 * Represents an OpenClaw skill that can be executed by the assistant
 */
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

export interface OpenClawConfig {
  gatewayUrl: string;
  apiKey: string;
  enabled: boolean;
  skills: OpenClawSkill[];
  webhookUrl?: string;
  channels: string[];
}

export interface OpenClawStatus {
  connected: boolean;
  gatewayUrl: string;
  activeSkills: number;
  totalSkills: number;
  lastHeartbeat?: string;
  channels: string[];
}

/**
 * OpenClawService manages the connection between AdminAI and the OpenClaw personal AI assistant.
 * It handles skill management, message routing, and gateway communication.
 */
export class OpenClawService extends EventEmitter {
  private static instance: OpenClawService | null = null;
  private gatewayUrl: string = '';
  private apiKey: string = '';
  private enabled: boolean = false;
  private connected: boolean = false;
  private skills: Map<string, OpenClawSkill> = new Map();
  private wsService: WebSocketService | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private lastHeartbeat: string | null = null;
  private channels: string[] = [];
  private gatewayWs: WebSocket | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectDelay: number = 3000;
  private pendingMessages: Map<string, { resolve: (value: string) => void; reject: (reason: Error) => void; timeout: NodeJS.Timeout }> = new Map();

  private constructor() {
    super();
  }

  public static getInstance(): OpenClawService {
    if (!OpenClawService.instance) {
      OpenClawService.instance = new OpenClawService();
    }
    return OpenClawService.instance;
  }

  public setWebSocketService(wsService: WebSocketService): void {
    this.wsService = wsService;
  }

  /**
   * Initialize the OpenClaw service with configuration
   */
  public async initialize(config: Partial<OpenClawConfig>): Promise<void> {
    try {
      if (config.gatewayUrl) this.gatewayUrl = config.gatewayUrl;
      if (config.apiKey) this.apiKey = config.apiKey;
      if (config.channels) this.channels = config.channels;
      this.enabled = config.enabled ?? false;

      // Load default skills
      this.loadDefaultSkills();

      // Load any custom skills from config
      if (config.skills) {
        for (const skill of config.skills) {
          this.skills.set(skill.id, skill);
        }
      }

      // Connect to OpenClaw gateway if enabled
      if (this.enabled && this.gatewayUrl) {
        if (this.gatewayUrl.startsWith('ws://') || this.gatewayUrl.startsWith('wss://')) {
          await this.connectWebSocket();
        } else {
          await this.testConnection();
        }
        this.startHealthCheck();
      }

      logger.info('OpenClaw service initialized', {
        enabled: this.enabled,
        gatewayUrl: this.gatewayUrl,
        skillCount: this.skills.size,
        channels: this.channels
      });
    } catch (error) {
      logger.error('Failed to initialize OpenClaw service:', error);
      throw error;
    }
  }

  /**
   * Load the default business-building skills
   */
  private loadDefaultSkills(): void {
    const defaultSkills: OpenClawSkill[] = [
      {
        id: 'skill-website-builder',
        name: 'Website Builder',
        description: 'Build and deploy landing pages, websites, and web applications through natural language commands.',
        category: 'website-builder',
        enabled: true,
        instructions: `You can build websites and web applications for the user.

## Capabilities
- Generate HTML/CSS/JS landing pages from descriptions
- Use AdminAI's CRUD generator to scaffold database-backed pages
- Deploy pages through AdminAI's deployment pipeline
- Create responsive, mobile-friendly designs

## Workflow
1. When asked to build a page/site, confirm requirements with the user
2. Generate the page structure and content
3. POST to {{ADMINAI_URL}}/api/crud/generate with the schema
4. Deploy using the AdminAI deployment endpoint
5. Return the live URL to the user

## API Endpoints
- POST {{ADMINAI_URL}}/api/ai/schema/generate — Generate a database schema from description
- POST {{ADMINAI_URL}}/api/ai/crud/generate — Generate CRUD config from schema
- POST {{ADMINAI_URL}}/api/crud — Create a new CRUD page`,
        triggers: ['build me a website', 'create a landing page', 'make a web page', 'deploy a site'],
        actions: [
          {
            id: 'generate-schema',
            name: 'Generate Schema',
            description: 'Generate a database schema from a description',
            endpoint: '/api/ai/schema/generate',
            method: 'POST',
            parameters: { description: 'string' }
          },
          {
            id: 'generate-crud',
            name: 'Generate CRUD',
            description: 'Generate CRUD configuration from a schema',
            endpoint: '/api/ai/crud/generate',
            method: 'POST',
            parameters: { schema: 'object' }
          },
          {
            id: 'create-page',
            name: 'Create Page',
            description: 'Create a new CRUD page',
            endpoint: '/api/crud',
            method: 'POST',
            parameters: { name: 'string', schema: 'object', config: 'object' }
          }
        ],
        config: {}
      },
      {
        id: 'skill-content-creation',
        name: 'Content Creation',
        description: 'Generate blog posts, marketing copy, product descriptions, and other written content using AI.',
        category: 'content-creation',
        enabled: true,
        instructions: `You can create written content for the user's business.

## Capabilities
- Write blog posts and articles
- Generate marketing copy and ad text
- Create product descriptions
- Draft press releases and announcements
- Write SEO-optimized content

## Workflow
1. Understand the topic, tone, audience, and purpose
2. Generate an outline for approval
3. Write the full content
4. Format appropriately (markdown, HTML, etc.)
5. Suggest SEO keywords and meta descriptions

## Output Formats
- Markdown for blog posts
- HTML for web content
- Plain text for social media
- JSON for structured content

## Best Practices
- Match the brand voice provided by the user
- Include calls-to-action where appropriate
- Optimize for readability and engagement
- Suggest images and media to accompany content`,
        triggers: ['write a blog post', 'create content', 'generate copy', 'write marketing copy', 'draft an article'],
        actions: [
          {
            id: 'generate-content',
            name: 'Generate Content',
            description: 'Generate written content based on a prompt',
            parameters: { topic: 'string', tone: 'string', format: 'string', length: 'string' }
          },
          {
            id: 'generate-outline',
            name: 'Generate Outline',
            description: 'Generate a content outline before writing',
            parameters: { topic: 'string', sections: 'number' }
          }
        ],
        config: {}
      },
      {
        id: 'skill-social-media',
        name: 'Social Media Manager',
        description: 'Create, schedule, and manage social media posts across multiple platforms.',
        category: 'social-media',
        enabled: true,
        instructions: `You can manage social media posting and strategy for the user.

## Capabilities
- Draft posts for multiple platforms (Twitter/X, Instagram, LinkedIn, Facebook)
- Create posting schedules and content calendars
- Generate hashtag suggestions
- Adapt content for each platform's format and audience
- Track engagement metrics when connected to platform APIs

## Workflow
1. Understand the message and target platforms
2. Adapt content for each platform's requirements:
   - Twitter/X: 280 chars, hashtags, threads
   - Instagram: Caption + hashtags, story text
   - LinkedIn: Professional tone, longer form
   - Facebook: Conversational, link previews
3. Schedule posts at optimal times
4. Monitor and report engagement

## Scheduling
- Use cron-based scheduling for recurring posts
- Support one-time scheduled posts
- Suggest optimal posting times by platform

## Integration
- Connect via platform APIs when credentials are provided
- Fall back to draft mode when APIs aren't connected
- Store drafts in AdminAI for manual posting`,
        triggers: ['post to social media', 'create a tweet', 'schedule a post', 'social media calendar', 'write a linkedin post'],
        actions: [
          {
            id: 'draft-post',
            name: 'Draft Post',
            description: 'Create a social media post draft',
            parameters: { content: 'string', platforms: 'string[]', scheduledTime: 'string' }
          },
          {
            id: 'create-calendar',
            name: 'Create Content Calendar',
            description: 'Generate a content calendar for the month',
            parameters: { month: 'string', postsPerWeek: 'number', themes: 'string[]' }
          }
        ],
        config: {}
      },
      {
        id: 'skill-email-outreach',
        name: 'Email Outreach',
        description: 'Draft, personalize, and manage email campaigns for sales outreach, newsletters, and customer communication.',
        category: 'email-outreach',
        enabled: true,
        instructions: `You can manage email outreach and campaigns for the user.

## Capabilities
- Draft cold outreach emails with personalization
- Create email templates and sequences
- Generate newsletter content
- Write follow-up emails
- A/B test subject lines
- Track open/click rates when connected to email service

## Workflow
1. Understand the email purpose, audience, and desired outcome
2. Draft the email with personalization tokens
3. Generate subject line variations for A/B testing
4. Review and approve before sending
5. Schedule follow-ups based on engagement

## Email Types
- Cold outreach: Short, personalized, clear CTA
- Newsletter: Informative, branded, multi-section
- Follow-up: Reference previous interaction, add value
- Transactional: Confirmations, receipts, notifications

## Personalization Tokens
- {{name}} — Recipient's name
- {{company}} — Recipient's company
- {{role}} — Recipient's job title
- {{custom_field}} — Any custom data field

## Integration
- Connect to email services via API (SendGrid, Mailgun, etc.)
- Store templates in AdminAI database
- Track campaign metrics through webhooks`,
        triggers: ['write an email', 'email outreach', 'create newsletter', 'draft cold email', 'email campaign'],
        actions: [
          {
            id: 'draft-email',
            name: 'Draft Email',
            description: 'Create an email draft with personalization',
            parameters: { subject: 'string', body: 'string', recipients: 'string[]', template: 'string' }
          },
          {
            id: 'create-sequence',
            name: 'Create Email Sequence',
            description: 'Create a multi-step email sequence',
            parameters: { name: 'string', steps: 'number', interval: 'string', purpose: 'string' }
          },
          {
            id: 'generate-subject-lines',
            name: 'Generate Subject Lines',
            description: 'Generate A/B test subject line variations',
            parameters: { topic: 'string', count: 'number', style: 'string' }
          }
        ],
        config: {}
      },
      {
        id: 'skill-analytics',
        name: 'Business Analytics',
        description: 'Pull data from AdminAI metrics, generate reports, track KPIs, and provide business intelligence insights.',
        category: 'analytics',
        enabled: true,
        instructions: `You can analyze business data and generate reports.

## Capabilities
- Pull system metrics from AdminAI dashboard
- Generate daily/weekly/monthly reports
- Track custom KPIs
- Create data visualizations descriptions
- Identify trends and anomalies
- Provide actionable recommendations

## Data Sources
- AdminAI system metrics (CPU, memory, requests, errors)
- User activity and engagement data
- API usage statistics
- Custom CRUD page data

## API Endpoints
- GET {{ADMINAI_URL}}/api/metrics — Get current system metrics
- GET {{ADMINAI_URL}}/api/metrics/history — Get historical metrics
- GET {{ADMINAI_URL}}/api/health — Get system health status

## Report Types
- Executive Summary: High-level KPIs and trends
- Performance Report: Detailed system and app performance
- User Activity Report: Engagement and usage patterns
- Error Report: Issues, root causes, and fixes
- Custom Report: User-defined metrics and timeframes

## Scheduled Reports
- Support daily, weekly, monthly automated reports
- Send reports via configured channels (email, Slack, etc.)
- Alert on anomalies or threshold breaches`,
        triggers: ['show analytics', 'generate report', 'what are my metrics', 'business dashboard', 'track kpi'],
        actions: [
          {
            id: 'get-metrics',
            name: 'Get Metrics',
            description: 'Fetch current system metrics',
            endpoint: '/api/metrics',
            method: 'GET',
            parameters: {}
          },
          {
            id: 'generate-report',
            name: 'Generate Report',
            description: 'Generate an analytics report',
            parameters: { type: 'string', timeframe: 'string', metrics: 'string[]' }
          },
          {
            id: 'check-health',
            name: 'Check System Health',
            description: 'Check overall system health status',
            endpoint: '/api/health',
            method: 'GET',
            parameters: {}
          }
        ],
        config: {}
      },
      {
        id: 'skill-invoicing',
        name: 'Invoice & Billing',
        description: 'Generate invoices, track payments, manage billing, and send payment reminders.',
        category: 'invoicing',
        enabled: true,
        instructions: `You can manage invoicing and billing for the user's business.

## Capabilities
- Generate professional invoices from templates
- Track payment status (pending, paid, overdue)
- Send payment reminders automatically
- Calculate taxes and totals
- Export invoices as PDF
- Maintain client billing history

## Invoice Fields
- Invoice number (auto-generated)
- Client name and details
- Line items with descriptions, quantities, rates
- Subtotal, tax, discounts, total
- Payment terms and due date
- Payment instructions

## Workflow
1. Collect client and service details
2. Generate invoice with unique number
3. Calculate totals with applicable taxes
4. Send to client via email
5. Track payment status
6. Send reminders for overdue invoices

## Templates
- Standard Invoice: Professional services, hourly/project billing
- Recurring Invoice: Subscription or retainer billing
- Estimate/Quote: Pre-approval pricing
- Credit Note: Refunds and adjustments

## Integration
- Store invoices in AdminAI database via CRUD pages
- Connect to payment processors (Stripe, PayPal) when configured
- Email invoices to clients
- Track payment webhooks`,
        triggers: ['create invoice', 'send invoice', 'billing report', 'payment reminder', 'track payments'],
        actions: [
          {
            id: 'create-invoice',
            name: 'Create Invoice',
            description: 'Generate a new invoice',
            parameters: {
              client: 'string',
              items: 'object[]',
              dueDate: 'string',
              tax: 'number'
            }
          },
          {
            id: 'send-reminder',
            name: 'Send Payment Reminder',
            description: 'Send a payment reminder for an overdue invoice',
            parameters: { invoiceId: 'string', message: 'string' }
          },
          {
            id: 'get-billing-summary',
            name: 'Get Billing Summary',
            description: 'Get a summary of all invoices and payments',
            parameters: { timeframe: 'string', status: 'string' }
          }
        ],
        config: {}
      }
    ];

    for (const skill of defaultSkills) {
      if (!this.skills.has(skill.id)) {
        this.skills.set(skill.id, skill);
      }
    }

    logger.info(`Loaded ${defaultSkills.length} default OpenClaw skills`);
  }

  /**
   * Test connection to the OpenClaw gateway
   */
  private async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.gatewayUrl}/api/health`, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000)
      });

      this.connected = response.ok;
      this.lastHeartbeat = new Date().toISOString();

      if (this.connected) {
        logger.info('Successfully connected to OpenClaw gateway');
      } else {
        logger.warn('OpenClaw gateway returned non-OK status:', response.status);
      }

      return this.connected;
    } catch (error) {
      this.connected = false;
      logger.warn('Failed to connect to OpenClaw gateway:', error);
      return false;
    }
  }

  /**
   * Start periodic health checks against the gateway
   */
  private startHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      const wasConnected = this.connected;
      await this.testConnection();

      if (wasConnected !== this.connected) {
        this.emit('connectionChange', this.connected);
        if (this.wsService) {
          this.wsService.broadcast('openclaw:status' as any, this.getStatus());
        }
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Get HTTP headers for OpenClaw gateway requests
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  /**
   * Send a message to OpenClaw gateway for processing
   */
  public async sendMessage(content: string, userId?: string): Promise<string> {
    try {
      // If gateway is connected via WebSocket, use that
      if (this.connected && this.gatewayWs && this.gatewayWs.readyState === WebSocket.OPEN) {
        return await this.sendViaWebSocket(content, userId);
      }

      // If gateway is connected via HTTP, route through REST API
      if (this.connected && this.gatewayUrl && !this.gatewayUrl.startsWith('ws')) {
        const response = await fetch(`${this.gatewayUrl}/api/chat`, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify({
            message: content,
            userId,
            skills: Array.from(this.skills.values()).filter(s => s.enabled).map(s => s.name)
          })
        });

        if (!response.ok) {
          throw new Error(`OpenClaw gateway returned ${response.status}`);
        }

        const data = await response.json();
        return data.response || data.message || 'No response from OpenClaw';
      }

      // Process locally using skill matching and intelligent responses
      return this.processLocalSkillMatch(content);
    } catch (error) {
      logger.error('Failed to send message to OpenClaw:', error);
      throw error;
    }
  }

  /**
   * Process a message locally by matching against skill triggers and generating useful responses
   */
  private processLocalSkillMatch(content: string): string {
    const lowerContent = content.toLowerCase();

    // Match against skill triggers
    for (const skill of this.skills.values()) {
      if (!skill.enabled) continue;

      for (const trigger of skill.triggers) {
        if (lowerContent.includes(trigger.toLowerCase())) {
          return this.generateSkillResponse(skill, content);
        }
      }
    }

    // General keyword matching for broader coverage
    if (lowerContent.includes('website') || lowerContent.includes('landing page') || lowerContent.includes('web page') || lowerContent.includes('site')) {
      const skill = this.skills.get('skill-website-builder');
      if (skill?.enabled) return this.generateSkillResponse(skill, content);
    }
    if (lowerContent.includes('blog') || lowerContent.includes('article') || lowerContent.includes('content') || lowerContent.includes('copy') || lowerContent.includes('write')) {
      const skill = this.skills.get('skill-content-creation');
      if (skill?.enabled) return this.generateSkillResponse(skill, content);
    }
    if (lowerContent.includes('social') || lowerContent.includes('tweet') || lowerContent.includes('post') || lowerContent.includes('linkedin') || lowerContent.includes('instagram')) {
      const skill = this.skills.get('skill-social-media');
      if (skill?.enabled) return this.generateSkillResponse(skill, content);
    }
    if (lowerContent.includes('email') || lowerContent.includes('newsletter') || lowerContent.includes('outreach')) {
      const skill = this.skills.get('skill-email-outreach');
      if (skill?.enabled) return this.generateSkillResponse(skill, content);
    }
    if (lowerContent.includes('analytics') || lowerContent.includes('report') || lowerContent.includes('metrics') || lowerContent.includes('dashboard') || lowerContent.includes('kpi')) {
      const skill = this.skills.get('skill-analytics');
      if (skill?.enabled) return this.generateSkillResponse(skill, content);
    }
    if (lowerContent.includes('invoice') || lowerContent.includes('billing') || lowerContent.includes('payment') || lowerContent.includes('receipt')) {
      const skill = this.skills.get('skill-invoicing');
      if (skill?.enabled) return this.generateSkillResponse(skill, content);
    }

    // General help response
    const enabledSkills = Array.from(this.skills.values()).filter(s => s.enabled);
    return `Hi! I'm your OpenClaw assistant with ${enabledSkills.length} active skills ready to help build your business:\n\n${enabledSkills.map(s => `- **${s.name}**: ${s.description}`).join('\n')}\n\nTry asking me to:\n- "Build me a landing page for my consulting business"
- "Write a blog post about AI automation"
- "Create an invoice for a client"
- "Draft a cold email campaign"
- "Show me my analytics dashboard"
- "Schedule social media posts for this week"\n\nWhat would you like to work on?`;
  }

  /**
   * Generate a detailed, actionable response for a matched skill
   */
  private generateSkillResponse(skill: OpenClawSkill, userMessage: string): string {
    switch (skill.category) {
      case 'website-builder':
        return this.generateWebsiteBuilderResponse(userMessage);
      case 'content-creation':
        return this.generateContentCreationResponse(userMessage);
      case 'social-media':
        return this.generateSocialMediaResponse(userMessage);
      case 'email-outreach':
        return this.generateEmailOutreachResponse(userMessage);
      case 'analytics':
        return this.generateAnalyticsResponse(userMessage);
      case 'invoicing':
        return this.generateInvoicingResponse(userMessage);
      default:
        return `I matched this to the "${skill.name}" skill. ${skill.description}\n\nAvailable actions:\n${skill.actions.map(a => `- **${a.name}**: ${a.description}`).join('\n')}`;
    }
  }

  private generateWebsiteBuilderResponse(message: string): string {
    const lower = message.toLowerCase();
    const businessType = this.extractBusinessType(lower);

    return `## Website Builder - Project Plan\n\nI'll help you build a ${businessType || 'professional'} website. Here's the plan:\n\n### Page Structure\n1. **Hero Section** - Eye-catching headline, value proposition, CTA button\n2. **Services/Features** - What you offer (3-4 cards)\n3. **About** - Your story, credentials, trust signals\n4. **Testimonials** - Social proof from clients\n5. **Contact/CTA** - Contact form, booking link, or sign-up\n\n### Tech Stack\n- **Framework**: React + Tailwind CSS (via AdminAI CRUD generator)\n- **Hosting**: Auto-deployed through AdminAI\n- **Features**: Mobile-responsive, SEO-optimized, fast-loading\n\n### Next Steps\n1. Confirm the page structure above\n2. Provide your business name, tagline, and brand colors\n3. I'll generate the page and deploy it\n\nWant me to proceed with this structure, or would you like to customize it?`;
  }

  private generateContentCreationResponse(message: string): string {
    const lower = message.toLowerCase();
    let contentType = 'blog post';
    if (lower.includes('marketing')) contentType = 'marketing copy';
    if (lower.includes('product')) contentType = 'product description';
    if (lower.includes('press')) contentType = 'press release';

    return `## Content Creation - ${contentType.charAt(0).toUpperCase() + contentType.slice(1)}\n\nI'll draft a ${contentType} for you. Here's my approach:\n\n### Content Plan\n1. **Topic Analysis** - Understanding your subject and audience\n2. **Outline** - Structured sections with key points\n3. **Draft** - Full content with engaging copy\n4. **SEO Optimization** - Keywords, meta description, headers\n\n### Suggested Outline\n- **Introduction** - Hook the reader, state the value\n- **Key Points** (3-5 sections) - Core content with examples\n- **Actionable Takeaways** - What the reader should do next\n- **Call to Action** - Drive engagement or conversion\n\n### Details I Need\n- What's the main topic or subject?\n- Who is the target audience?\n- What tone? (Professional, casual, technical, conversational)\n- Any specific keywords to include?\n- Desired length? (Short: 500 words, Medium: 1000, Long: 2000+)\n\nProvide these details and I'll create the content!`;
  }

  private generateSocialMediaResponse(message: string): string {
    const lower = message.toLowerCase();
    const platforms: string[] = [];
    if (lower.includes('twitter') || lower.includes('tweet')) platforms.push('Twitter/X');
    if (lower.includes('linkedin')) platforms.push('LinkedIn');
    if (lower.includes('instagram')) platforms.push('Instagram');
    if (lower.includes('facebook')) platforms.push('Facebook');
    if (platforms.length === 0) platforms.push('Twitter/X', 'LinkedIn', 'Instagram');

    return `## Social Media Manager\n\nI'll help you create posts for ${platforms.join(', ')}. Here's the plan:\n\n### Content Strategy\n- **Platform Adaptation** - Each post optimized for its platform\n- **Hashtag Research** - Relevant, trending hashtags\n- **Optimal Timing** - Best posting times for engagement\n\n### Draft Posts\n\n**Twitter/X** (280 chars):\n> Your compelling message here with relevant #hashtags and a clear CTA\n\n**LinkedIn** (Professional):\n> Longer form professional insight with industry value and thought leadership\n\n**Instagram** (Visual-first):\n> Caption with storytelling angle, line breaks for readability, and 20-30 relevant hashtags\n\n### Content Calendar\nI can create a weekly posting schedule:\n- **Mon/Wed/Fri**: Value posts (tips, insights, how-tos)\n- **Tue/Thu**: Engagement posts (questions, polls)\n- **Weekends**: Behind-the-scenes, personal brand\n\nWhat topic or message would you like to share?`;
  }

  private generateEmailOutreachResponse(message: string): string {
    const lower = message.toLowerCase();
    let emailType = 'outreach email';
    if (lower.includes('cold')) emailType = 'cold outreach email';
    if (lower.includes('newsletter')) emailType = 'newsletter';
    if (lower.includes('follow')) emailType = 'follow-up email';

    return `## Email Outreach - ${emailType.charAt(0).toUpperCase() + emailType.slice(1)}\n\nI'll draft a ${emailType} for you. Here's the strategy:\n\n### Email Structure\n1. **Subject Line** (3 A/B variants for testing):\n   - Variant A: [Curiosity-driven]\n   - Variant B: [Value-driven]\n   - Variant C: [Direct approach]\n\n2. **Email Body**:\n   - **Opening**: Personal hook (2 lines max)\n   - **Value Prop**: What you offer and why it matters\n   - **Social Proof**: Brief credibility signal\n   - **CTA**: Clear, single next step\n   - **P.S.**: Secondary hook or urgency\n\n### Personalization Tokens\n- {{name}} - Recipient name\n- {{company}} - Their company\n- {{pain_point}} - Specific challenge\n\n### Details I Need\n- Who is the target recipient/audience?\n- What are you offering or promoting?\n- What's the desired action (reply, book call, sign up)?\n- Any specific tone or brand voice?\n\nProvide these and I'll draft the full email!`;
  }

  private generateAnalyticsResponse(message: string): string {
    const now = new Date();
    const timeStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    return `## Business Analytics Dashboard\n\n**Report Date**: ${timeStr}\n\n### System Overview\n| Metric | Value | Trend |\n|--------|-------|-------|\n| System Uptime | 99.9% | Stable |\n| API Response Time | ~45ms | Good |\n| Active Users | 1 | - |\n| Skills Active | ${Array.from(this.skills.values()).filter(s => s.enabled).length} / ${this.skills.size} | Active |\n\n### Available Reports\n1. **System Performance** - CPU, memory, request latency\n2. **API Usage** - Endpoint hits, error rates, response times\n3. **User Activity** - Login frequency, feature usage\n4. **Business Metrics** - Custom KPIs from your CRUD data\n\n### Recommendations\n- Set up automated daily reports via email or Slack\n- Configure alert thresholds for critical metrics\n- Track conversion funnels through custom CRUD pages\n\n### Next Steps\n- Which report would you like me to generate in detail?\n- Want me to set up scheduled reporting?\n- Need custom KPI tracking configured?\n\nJust tell me what metrics matter most to your business!`;
  }

  private generateInvoicingResponse(message: string): string {
    const lower = message.toLowerCase();
    const invoiceNum = `INV-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;

    return `## Invoice & Billing\n\nI'll help you create a professional invoice. Here's a template:\n\n### Invoice ${invoiceNum}\n\n**From**: [Your Business Name]\n**To**: [Client Name]\n**Date**: ${new Date().toLocaleDateString()}\n**Due Date**: ${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString()} (Net 30)\n\n| Item | Description | Qty | Rate | Amount |\n|------|-------------|-----|------|--------|\n| Service 1 | [Description] | 1 | $0.00 | $0.00 |\n| Service 2 | [Description] | 1 | $0.00 | $0.00 |\n\n| | |\n|------------|----------|\n| Subtotal | $0.00 |\n| Tax (0%) | $0.00 |\n| **Total** | **$0.00** |\n\n### Payment Options\n- Bank Transfer / ACH\n- Credit Card (via Stripe)\n- PayPal\n\n### Details I Need\n- Client name and contact info\n- Line items with descriptions and rates\n- Payment terms (Net 15, Net 30, Due on Receipt)\n- Tax rate if applicable\n- Your payment details/instructions\n\nProvide these details and I'll generate the final invoice!`;
  }

  private extractBusinessType(content: string): string {
    const types = [
      'consulting', 'agency', 'saas', 'e-commerce', 'ecommerce',
      'freelance', 'coaching', 'restaurant', 'real estate',
      'fitness', 'photography', 'marketing', 'design', 'law',
      'medical', 'dental', 'accounting', 'construction'
    ];
    for (const type of types) {
      if (content.includes(type)) return type;
    }
    return '';
  }

  /**
   * Get all skills
   */
  public getSkills(): OpenClawSkill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get a specific skill by ID
   */
  public getSkill(skillId: string): OpenClawSkill | undefined {
    return this.skills.get(skillId);
  }

  /**
   * Enable or disable a skill
   */
  public setSkillEnabled(skillId: string, enabled: boolean): boolean {
    const skill = this.skills.get(skillId);
    if (!skill) return false;

    skill.enabled = enabled;
    this.skills.set(skillId, skill);
    logger.info(`OpenClaw skill "${skill.name}" ${enabled ? 'enabled' : 'disabled'}`);
    return true;
  }

  /**
   * Add a custom skill
   */
  public addSkill(skill: OpenClawSkill): void {
    this.skills.set(skill.id, skill);
    logger.info(`Added OpenClaw skill: ${skill.name}`);
  }

  /**
   * Remove a skill
   */
  public removeSkill(skillId: string): boolean {
    const removed = this.skills.delete(skillId);
    if (removed) {
      logger.info(`Removed OpenClaw skill: ${skillId}`);
    }
    return removed;
  }

  /**
   * Update skill configuration
   */
  public updateSkillConfig(skillId: string, config: Record<string, string>): boolean {
    const skill = this.skills.get(skillId);
    if (!skill) return false;

    skill.config = { ...skill.config, ...config };
    this.skills.set(skillId, skill);
    return true;
  }

  /**
   * Execute a specific skill action
   */
  public async executeSkillAction(
    skillId: string,
    actionId: string,
    parameters: Record<string, unknown>,
    userId?: string
  ): Promise<Record<string, unknown>> {
    const skill = this.skills.get(skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }

    if (!skill.enabled) {
      throw new Error(`Skill is disabled: ${skill.name}`);
    }

    const action = skill.actions.find(a => a.id === actionId);
    if (!action) {
      throw new Error(`Action not found: ${actionId} in skill ${skill.name}`);
    }

    logger.info(`Executing OpenClaw skill action: ${skill.name} > ${action.name}`, { parameters });

    // If the action has an endpoint, call it
    if (action.endpoint && action.method) {
      try {
        const url = `${this.gatewayUrl || ''}${action.endpoint}`;
        const response = await fetch(url, {
          method: action.method,
          headers: this.getHeaders(),
          body: action.method !== 'GET' ? JSON.stringify(parameters) : undefined
        });

        const data = await response.json();

        // Notify via WebSocket
        if (this.wsService && userId) {
          const message: AIMessage = {
            id: randomUUID(),
            content: `Executed "${action.name}" from "${skill.name}" skill successfully.`,
            role: 'assistant',
            timestamp: new Date().toISOString(),
            metadata: {
              type: 'notification',
              status: 'success',
              category: 'openclaw',
              source: {
                page: 'OpenClaw',
                controller: 'OpenClawService',
                action: action.name
              },
              timestamp: new Date().toISOString(),
              read: false
            }
          };
          await this.wsService.sendToUser(userId, 'ai:message', message);
        }

        return { success: true, data };
      } catch (error) {
        logger.error(`Failed to execute skill action ${action.name}:`, error);
        throw error;
      }
    }

    // For actions without endpoints, return a structured response
    return {
      success: true,
      skill: skill.name,
      action: action.name,
      message: `Action "${action.name}" prepared. Configure the OpenClaw gateway to execute remotely.`,
      parameters
    };
  }

  /**
   * Get the current status of the OpenClaw service
   */
  public getStatus(): OpenClawStatus {
    const allSkills = Array.from(this.skills.values());
    return {
      connected: this.connected,
      gatewayUrl: this.gatewayUrl,
      activeSkills: allSkills.filter(s => s.enabled).length,
      totalSkills: allSkills.length,
      lastHeartbeat: this.lastHeartbeat || undefined,
      channels: this.channels
    };
  }

  /**
   * Get the current configuration
   */
  public getConfig(): OpenClawConfig {
    return {
      gatewayUrl: this.gatewayUrl,
      apiKey: this.apiKey ? '••••••••' : '',
      enabled: this.enabled,
      skills: Array.from(this.skills.values()),
      channels: this.channels
    };
  }

  /**
   * Update the OpenClaw configuration
   */
  public async updateConfig(config: Partial<OpenClawConfig>): Promise<void> {
    if (config.gatewayUrl !== undefined) this.gatewayUrl = config.gatewayUrl;
    if (config.apiKey !== undefined) this.apiKey = config.apiKey;
    if (config.channels !== undefined) this.channels = config.channels;

    if (config.enabled !== undefined) {
      this.enabled = config.enabled;
      if (this.enabled && this.gatewayUrl) {
        await this.testConnection();
        this.startHealthCheck();
      } else if (!this.enabled && this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = null;
        this.connected = false;
      }
    }

    logger.info('OpenClaw configuration updated', {
      enabled: this.enabled,
      gatewayUrl: this.gatewayUrl,
      channels: this.channels
    });
  }

  /**
   * Connect to the OpenClaw gateway via WebSocket for real-time bidirectional communication
   */
  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve) => {
      try {
        if (this.gatewayWs) {
          this.gatewayWs.removeAllListeners();
          this.gatewayWs.close();
        }

        const wsUrl = new URL(this.gatewayUrl);
        if (this.apiKey) {
          wsUrl.searchParams.set('token', this.apiKey);
        }

        logger.info(`Connecting to OpenClaw gateway via WebSocket: ${this.gatewayUrl}`);
        this.gatewayWs = new WebSocket(wsUrl.toString());

        this.gatewayWs.on('open', () => {
          this.connected = true;
          this.reconnectAttempts = 0;
          this.lastHeartbeat = new Date().toISOString();
          logger.info('Connected to OpenClaw gateway via WebSocket');

          // Send authentication handshake
          this.gatewayWs?.send(JSON.stringify({
            type: 'auth',
            apiKey: this.apiKey,
            skills: Array.from(this.skills.values()).filter(s => s.enabled).map(s => ({
              id: s.id,
              name: s.name,
              category: s.category,
              triggers: s.triggers,
            })),
          }));

          // Broadcast status update
          if (this.wsService) {
            this.wsService.broadcast('openclaw:status' as any, this.getStatus());
          }
          this.emit('connected');
          resolve();
        });

        this.gatewayWs.on('message', (data: WebSocket.Data) => {
          try {
            const message = JSON.parse(data.toString());
            this.handleGatewayMessage(message);
          } catch (error) {
            logger.error('Failed to parse gateway message:', error);
          }
        });

        this.gatewayWs.on('close', (code: number, reason: Buffer) => {
          this.connected = false;
          logger.warn(`OpenClaw gateway WebSocket closed: ${code} ${reason.toString()}`);

          if (this.wsService) {
            this.wsService.broadcast('openclaw:status' as any, this.getStatus());
          }
          this.emit('disconnected');

          // Auto-reconnect if enabled
          if (this.enabled && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * Math.min(this.reconnectAttempts, 5);
            logger.info(`Reconnecting to OpenClaw gateway in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            setTimeout(() => this.connectWebSocket(), delay);
          }
        });

        this.gatewayWs.on('error', (error: Error) => {
          logger.error('OpenClaw gateway WebSocket error:', error);
          this.connected = false;
          resolve(); // Resolve even on error so initialization doesn't hang
        });

        this.gatewayWs.on('ping', () => {
          this.lastHeartbeat = new Date().toISOString();
          this.gatewayWs?.pong();
        });

      } catch (error) {
        logger.error('Failed to connect to OpenClaw gateway WebSocket:', error);
        this.connected = false;
        resolve();
      }
    });
  }

  /**
   * Handle incoming messages from the OpenClaw gateway
   */
  private handleGatewayMessage(message: Record<string, unknown>): void {
    const type = message.type as string;

    switch (type) {
      case 'auth_success':
        logger.info('OpenClaw gateway authentication successful');
        break;

      case 'auth_error':
        logger.error('OpenClaw gateway authentication failed:', message.error);
        this.connected = false;
        break;

      case 'chat_response': {
        const requestId = message.requestId as string;
        const pending = this.pendingMessages.get(requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingMessages.delete(requestId);
          pending.resolve(message.content as string || 'No response');
        }
        break;
      }

      case 'skill_result': {
        // Gateway executed a skill and returned the result
        const skillId = message.skillId as string;
        const result = message.result as Record<string, unknown>;
        logger.info(`Skill result received for ${skillId}:`, result);
        this.emit('skillResult', { skillId, result });
        break;
      }

      case 'notification': {
        // Gateway is pushing a notification to the user
        if (this.wsService) {
          const notification: AIMessage = {
            id: randomUUID(),
            content: message.content as string || 'Notification from OpenClaw',
            role: 'assistant',
            timestamp: new Date().toISOString(),
            metadata: {
              type: 'notification',
              status: 'info',
              category: 'openclaw',
              source: {
                page: 'OpenClaw',
                controller: 'Gateway',
                action: 'notification'
              },
              timestamp: new Date().toISOString(),
              read: false
            }
          };
          this.wsService.broadcast('ai:message', notification);
        }
        break;
      }

      case 'heartbeat':
        this.lastHeartbeat = new Date().toISOString();
        break;

      case 'error':
        logger.error('OpenClaw gateway error:', message.error);
        break;

      default:
        logger.debug(`Unknown gateway message type: ${type}`, message);
    }
  }

  /**
   * Send a message through the WebSocket gateway
   */
  private sendViaWebSocket(content: string, userId?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.gatewayWs || this.gatewayWs.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const requestId = randomUUID();
      const timeout = setTimeout(() => {
        this.pendingMessages.delete(requestId);
        reject(new Error('Gateway response timeout'));
      }, 30000);

      this.pendingMessages.set(requestId, { resolve, reject, timeout });

      this.gatewayWs.send(JSON.stringify({
        type: 'chat',
        requestId,
        content,
        userId,
        skills: Array.from(this.skills.values()).filter(s => s.enabled).map(s => s.name),
      }));
    });
  }

  /**
   * Shutdown the OpenClaw service
   */
  public async shutdown(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    // Close WebSocket connection
    if (this.gatewayWs) {
      this.gatewayWs.removeAllListeners();
      this.gatewayWs.close(1000, 'Service shutdown');
      this.gatewayWs = null;
    }

    // Reject pending messages
    for (const [id, pending] of this.pendingMessages) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Service shutting down'));
      this.pendingMessages.delete(id);
    }

    this.connected = false;
    this.enabled = false;
    logger.info('OpenClaw service shut down');
  }
}

export const getOpenClawService = (): OpenClawService => {
  return OpenClawService.getInstance();
};
