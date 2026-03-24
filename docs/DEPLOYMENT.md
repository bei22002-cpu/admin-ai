# AdminAI Deployment Guide

## Quick Start with Docker Compose

The fastest way to deploy AdminAI is with Docker Compose:

```bash
# Clone the repository
git clone https://github.com/bei22002-cpu/admin-ai.git
cd admin-ai

# Set environment variables (optional)
export DB_PASSWORD=your_secure_password
export JWT_SECRET=your_jwt_secret_key

# Start all services
docker-compose up -d
```

This starts:
- **Frontend** at `http://localhost:5173`
- **Backend API** at `http://localhost:3000`
- **PostgreSQL** database on port 5432
- **Redis** cache on port 6379

### Default Login
- Email: `admin@admin.ai`
- Password: `admin123`

> Change these credentials immediately in production.

---

## Manual Setup (Development)

### Prerequisites
- Node.js 18+
- Yarn (v1 classic)
- PostgreSQL 15+
- Redis 7+

### 1. Install Dependencies

```bash
cd admin-ai
yarn install
```

### 2. Configure Environment

Create a `.env` file in `packages/backend/`:

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_DATABASE=admin_ai

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Auth
JWT_SECRET=change_this_in_production

# Server
PORT=3000
NODE_ENV=development

# Frontend URL (for CORS)
FRONTEND_URL=http://localhost:5173
```

### 3. Set Up Database

```bash
# Create the database
createdb admin_ai

# Run migrations
cd packages/backend
yarn migration:run
```

### 4. Start Development Servers

```bash
# From the root directory, start both frontend and backend
yarn dev
```

Or start them separately:

```bash
# Terminal 1 - Backend
cd packages/backend
JWT_SECRET=your_secret yarn dev

# Terminal 2 - Frontend
cd packages/frontend
yarn dev
```

---

## Production Deployment

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DB_HOST` | Yes | PostgreSQL host |
| `DB_PORT` | Yes | PostgreSQL port (default: 5432) |
| `DB_USERNAME` | Yes | Database username |
| `DB_PASSWORD` | Yes | Database password |
| `DB_DATABASE` | Yes | Database name |
| `REDIS_HOST` | Yes | Redis host |
| `REDIS_PORT` | Yes | Redis port (default: 6379) |
| `JWT_SECRET` | Yes | Secret key for JWT tokens |
| `PORT` | No | Backend port (default: 3000) |
| `FRONTEND_URL` | Yes | Frontend URL for CORS |
| `NODE_ENV` | Yes | Set to `production` |
| `STRIPE_SECRET_KEY` | No | Stripe API key for billing |
| `STRIPE_WEBHOOK_SECRET` | No | Stripe webhook signing secret |
| `OPENCLAW_GATEWAY_URL` | No | OpenClaw gateway WebSocket URL |

### Build for Production

```bash
# Build all packages
yarn build

# Start the backend
cd packages/backend
NODE_ENV=production node dist/index.js
```

### Nginx Configuration (Frontend)

```nginx
server {
    listen 80;
    server_name yourdomain.com;
    root /path/to/admin-ai/packages/frontend/dist;
    index index.html;

    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /socket.io {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### SSL/TLS

For production, use Let's Encrypt with certbot:

```bash
sudo certbot --nginx -d yourdomain.com
```

---

## Scaling

### Horizontal Scaling
- Backend is stateless (session state in Redis) — run multiple instances behind a load balancer
- Use Redis for Socket.IO adapter to share WebSocket connections across instances
- PostgreSQL can be scaled with read replicas

### Database Backups
```bash
# Automated backup
pg_dump -h localhost -U postgres admin_ai > backup_$(date +%Y%m%d).sql

# Restore
psql -h localhost -U postgres admin_ai < backup_20240101.sql
```

---

## Troubleshooting

### Common Issues

**Database connection refused**
```bash
# Check PostgreSQL is running
sudo systemctl status postgresql
# Check connection
psql -h localhost -U postgres -d admin_ai
```

**Redis connection refused**
```bash
# Check Redis is running
sudo systemctl status redis
redis-cli ping
```

**Frontend can't reach backend**
- Check CORS settings in backend (`FRONTEND_URL` env var)
- Verify the API URL in frontend `.env` file
- Check that both services are running on expected ports

**Migration errors**
```bash
# Revert last migration
cd packages/backend
yarn migration:revert

# Re-run migrations
yarn migration:run
```
