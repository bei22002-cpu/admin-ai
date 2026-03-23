# Testing AdminAI + OpenClaw Integration

## Overview
AdminAI is a React (Vite) + Node.js/Express (TypeScript) app with Socket.IO WebSocket. OpenClaw is integrated as an LLM provider with 6 business-building skills, a chat interface, and conversation persistence.

## Devin Secrets Needed
- `DB_PASSWORD` — PostgreSQL password for the local dev database
- `JWT_SECRET` — JWT signing secret for authentication

## Dev Server Setup

### Prerequisites
- PostgreSQL running on localhost:5432
- Redis running on localhost:6379
- Node.js with yarn

### Install Dependencies
```bash
cd /home/ubuntu/repos/admin-ai && yarn install
```

### Database Migrations
The OpenClaw integration adds two migrations that must be run:
1. `AddOpenClawTables` — creates `openclaw_skill`, `openclaw_conversation` tables with enums and indexes
2. `AddOrganization` — creates `organization` table and adds `organizationId` column to `user` table

**Known gotcha**: If migrations haven't been run, login will fail with `column User.organizationId does not exist`. If `yarn migration:run` doesn't work, apply SQL directly via `psql` using the SQL from the migration files in `packages/backend/src/database/migrations/`.

### Start Backend
```bash
DB_PASSWORD=$DB_PASSWORD JWT_SECRET=$JWT_SECRET \
  npx ts-node-dev --respawn --transpile-only src/index.ts
```
Runs on port 3000.

### Start Frontend
```bash
cd packages/frontend && npx vite --host 0.0.0.0
```
Runs on port 5173 (or next available).

## Test Credentials
- Admin login: use the "Fill Admin Login" button on the login page which auto-fills the default dev credentials

## Key Test Flows

### 1. Landing Page (unauthenticated)
- Navigate to `/landing` — should show hero section, 6 skill cards, deploy section, footer
- The landing page is a public route, no auth required

### 2. OpenClaw Dashboard
- Login → sidebar shows "OpenClaw" → click to navigate to `/openclaw`
- Dashboard shows: header, "Not Connected" chip, onboarding wizard, status overview, Chat/Skills tabs
- Status overview should show "Active Skills: 6 / 6" (if it shows 0/0, the `loadDefaultSkills()` isn't being called)

### 3. Chat with Skill Matching
- Type "Build me a landing page for my consulting business" → sends to backend
- Backend matches "landing page" trigger → returns Website Builder response
- Response contains "## Website Builder - Project Plan" with "consulting" business type detected
- Messages persist to `openclaw_conversation` table in PostgreSQL

### 4. Skills Tab
- Click "SKILLS" tab → shows 6 skill cards with toggle switches
- Each card has: name, description, category chip, trigger keywords, expandable actions
- Skills: Website Builder, Content Creation, Social Media Manager, Email Outreach, Business Analytics, Invoice & Billing

### 5. Billing Plans API
- `GET /api/plans` — public endpoint, returns 4 tiers: Free, Starter, Pro, Enterprise
- No auth required

## Known Issues & Gotchas

1. **OpenClaw service initialization**: The singleton pattern means `loadDefaultSkills()` must be called in the constructor, not just in `initialize()`. If skills show 0/0, check that the constructor calls `loadDefaultSkills()`.

2. **Dual router/sidebar pattern**: AdminAI has both `routes.tsx` (dead code) and `App.tsx` (actual router), and both `Sidebar.tsx` (dead code) and `Layout.tsx` (actual sidebar). Changes must go in `App.tsx` and `Layout.tsx`.

3. **Pre-existing TypeScript errors**: `npx tsc --noEmit` shows ~50 errors in files unrelated to OpenClaw (metrics, kafka, websocket, monitoring). `yarn build` will fail due to these pre-existing issues.

4. **Docker Compose**: The `docker-compose.yml` and Dockerfiles were created but never built/tested. May have issues.

5. **Billing is skeleton only**: Stripe npm package is NOT installed. BillingService has plan tiers and webhook structure but no actual Stripe API calls.

6. **Frontend port**: If port 5173 is occupied, Vite will use the next available port (5174, etc.). Check the Vite startup output for the actual port.
