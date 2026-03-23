# Skill Authoring Guide

## Overview

AdminAI skills are modular automation units that define how the OpenClaw AI assistant handles specific business tasks. Each skill has triggers (keywords/phrases that activate it), actions (what it does), and configuration options.

## Built-in Skills

AdminAI ships with 6 business-building skills:

| Skill | Category | Description |
|-------|----------|-------------|
| Website Builder | `website_builder` | Scaffold landing pages, portfolio sites, and web applications |
| Content Creation | `content_creation` | Draft blog posts, marketing copy, and SEO content |
| Social Media Manager | `social_media` | Create and schedule social media posts across platforms |
| Email Outreach | `email_outreach` | Draft cold emails, newsletters, and follow-up sequences |
| Business Analytics | `analytics` | Generate reports, track KPIs, and analyze business metrics |
| Invoice & Billing | `invoicing` | Create invoices, track payments, and send reminders |

## Skill Structure

Each skill is defined as a database entity with the following fields:

```typescript
interface Skill {
  id: string;              // UUID
  name: string;            // Display name
  description: string;     // What the skill does
  category: SkillCategory; // One of the 6 categories
  enabled: boolean;        // Whether the skill is active
  instructions: string;    // Detailed instructions for the AI
  triggers: string[];      // Keywords/phrases that activate the skill
  actions: SkillAction[];  // Available actions
  config: object;          // Skill-specific configuration
  isCustom: boolean;       // Whether this is a user-created skill
}
```

## Creating a Custom Skill

### Via the API

```bash
curl -X POST http://localhost:3000/api/openclaw/skills \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Customer Support",
    "description": "Handle customer support tickets and FAQs",
    "category": "content_creation",
    "instructions": "When a user asks about customer support, help them draft responses to common questions, create FAQ documents, and suggest support workflow improvements.",
    "triggers": ["support", "customer", "ticket", "FAQ", "help desk"],
    "actions": [
      {
        "name": "draft_response",
        "description": "Draft a response to a customer inquiry",
        "parameters": { "inquiry": "string", "tone": "string" }
      },
      {
        "name": "create_faq",
        "description": "Create a FAQ document",
        "parameters": { "topic": "string", "questions": "number" }
      }
    ],
    "config": {
      "defaultTone": "professional",
      "maxResponseLength": 500
    }
  }'
```

### Via the Dashboard

1. Navigate to the **OpenClaw** page in the sidebar
2. Switch to the **Skills** tab
3. Click **Create Custom Skill**
4. Fill in the skill details:
   - **Name**: A clear, descriptive name
   - **Description**: What the skill does (shown in the skills list)
   - **Category**: Select the closest matching category
   - **Triggers**: Keywords that activate this skill (comma-separated)
   - **Instructions**: Detailed instructions for the AI on how to use this skill
5. Click **Save**

## Skill Triggers

Triggers are keywords or phrases that the AI uses to match user messages to skills. When a user sends a message, the system:

1. Scans the message for trigger keywords
2. Matches against all enabled skills
3. Routes to the best-matching skill
4. Uses the skill's instructions to generate a response

### Trigger Best Practices

- Use **specific** keywords: "landing page" instead of just "page"
- Include **variations**: ["invoice", "bill", "receipt", "payment"]
- Add **action words**: ["create invoice", "send invoice", "generate bill"]
- Keep triggers **unique** across skills to avoid conflicts

## Skill Actions

Actions define the concrete operations a skill can perform. Each action has:

```typescript
interface SkillAction {
  name: string;           // Machine-readable action name
  description: string;    // Human-readable description
  parameters: object;     // Required parameters
  handler?: string;       // Optional: custom handler function
}
```

### Example: Website Builder Actions

```json
[
  {
    "name": "scaffold_landing_page",
    "description": "Create a new landing page with sections",
    "parameters": {
      "businessName": "string",
      "businessType": "string",
      "sections": ["hero", "features", "pricing", "contact"]
    }
  },
  {
    "name": "generate_component",
    "description": "Generate a specific UI component",
    "parameters": {
      "componentType": "string",
      "framework": "react | vue | html"
    }
  }
]
```

## Skill Configuration

The `config` field stores skill-specific settings:

```json
{
  "defaultTemplate": "modern",
  "outputFormat": "markdown",
  "maxTokens": 2000,
  "customPromptPrefix": "You are an expert business consultant...",
  "integrations": {
    "stripe": { "enabled": false },
    "sendgrid": { "enabled": false }
  }
}
```

## Skill Execution Flow

```
User Message
    |
    v
Trigger Matching (keyword scan)
    |
    v
Skill Selection (best match)
    |
    v
Context Building (conversation history + skill instructions)
    |
    v
AI Response Generation (local or OpenClaw gateway)
    |
    v
Action Execution (if applicable)
    |
    v
Response to User (with actionable content)
```

## Advanced: Connecting Skills to External Services

Skills can be enhanced by connecting them to external APIs:

### Stripe (for Invoice & Billing skill)
```json
{
  "config": {
    "integrations": {
      "stripe": {
        "enabled": true,
        "actions": ["create_invoice", "send_invoice", "check_payment"]
      }
    }
  }
}
```

### SendGrid (for Email Outreach skill)
```json
{
  "config": {
    "integrations": {
      "sendgrid": {
        "enabled": true,
        "actions": ["send_email", "create_template", "track_opens"]
      }
    }
  }
}
```

### Google Analytics (for Business Analytics skill)
```json
{
  "config": {
    "integrations": {
      "google_analytics": {
        "enabled": true,
        "actions": ["get_traffic", "get_conversions", "get_top_pages"]
      }
    }
  }
}
```

## Tips for Effective Skills

1. **Be specific with instructions** — The more detailed your skill instructions, the better the AI responds
2. **Test with real messages** — Use the chat interface to verify your triggers work
3. **Iterate on responses** — Adjust instructions based on the quality of AI output
4. **Keep skills focused** — One skill per business function, don't try to do everything
5. **Use conversation context** — The AI remembers previous messages, so skills can build on prior context
