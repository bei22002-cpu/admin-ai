# Testing AdminAI Locally

## Environment Setup

### Prerequisites
- Node.js (managed via project's package manager)
- PostgreSQL running locally (default port 5432)
- Redis running locally (default port 6379)

### Install Dependencies
```bash
cd /home/ubuntu/repos/admin-ai
yarn install
```

If `yarn install` fails due to native modules (e.g., `sqlite3`, `bcrypt`), try:
```bash
npm install --build-from-source
```

### Database Setup
```bash
sudo service postgresql start
sudo -u postgres psql -c "ALTER USER postgres PASSWORD '<DB_PASSWORD>';"
sudo -u postgres psql -c "CREATE DATABASE admin_ai;"
```

The backend uses TypeORM. If you encounter schema mismatch errors (e.g., "column does not exist"), you may need to temporarily set `synchronize: true` in `packages/backend/src/database/index.ts` to auto-create the schema, then revert it.

### Redis Setup
```bash
sudo service redis-server start
```

### Start Backend
```bash
cd packages/backend
DB_PASSWORD=<DB_PASSWORD> JWT_SECRET=<JWT_SECRET> npx ts-node-dev --respawn --transpile-only src/index.ts
```
Backend runs on port 3000.

### Start Frontend
```bash
cd packages/frontend
npx vite --host 0.0.0.0 --port 5173
```
Frontend runs on port 5173 with API proxy to backend on port 3000.

### Default Login
Use the default admin credentials configured in the database seed.

## Devin Secrets Needed
- `DB_PASSWORD` - PostgreSQL password for local dev
- `JWT_SECRET` - JWT signing secret for backend auth
- Default admin login credentials (check seed script or ask repo owner)

## Key Architecture Gotchas

### CRITICAL: Dual Router / Dual Sidebar Pattern
This project has **two separate route definitions** and **two separate sidebar components**. Only ONE of each is actually used:

| File | Purpose | Actually Used? |
|------|---------|---------------|
| `packages/frontend/src/App.tsx` | **Real router** - defines `<Routes>` tree | YES |
| `packages/frontend/src/routes/routes.tsx` | Route array + `AppRoutes` component | NO (dead code) |
| `packages/frontend/src/components/Layout.tsx` | **Real sidebar** - renders drawer with menu items | YES |
| `packages/frontend/src/components/Sidebar.tsx` | Standalone sidebar component | NO (never imported) |

**When adding new pages/routes:**
1. Add the route in `App.tsx` (inside the `<Route element={<RequireAuth><Layout /></RequireAuth>}>` block)
2. Add the sidebar menu item in `Layout.tsx` (in the `menuItems` array)
3. Optionally update `routes.tsx` and `Sidebar.tsx` for consistency, but they are NOT required

### Backend Route Registration
Backend routes are mounted **individually** in `packages/backend/src/app.ts` - NOT via a central `createRoutes()` function. When adding new route groups:
1. Create the route file (e.g., `routes/myfeature.routes.ts`)
2. Import and mount it in `app.ts`: `app.use('/api/myfeature', createMyFeatureRoutes());`
3. The `routes/index.ts` `createRoutes()` function exists but is NOT called by `app.ts`

### AI Settings Path
The AI Settings page route is at `/ai-settings` (not `/ai/settings`). The sidebar link and App.tsx route must match.

## Testing Workflow

1. Start PostgreSQL and Redis
2. Start backend (port 3000)
3. Start frontend (port 5173)
4. Login at `http://localhost:5173/login`
5. Navigate via sidebar to test pages
6. Check browser console for React errors (filter out pre-existing WebGL/THREE.js shader errors from the Globe component - those are expected)

## Pre-existing Console Errors (Expected)
- WebGL shader compilation errors from `Globe.tsx` / THREE.js (fragment shader errors about `vCameraWorldPosition`, `vVertexWorldPosition`)
- `WebGL context lost` warnings
- These are NOT related to new features and can be safely ignored during testing
