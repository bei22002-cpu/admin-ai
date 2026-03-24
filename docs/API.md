# AdminAI API Documentation

## Base URL

```
http://localhost:3000/api
```

## Authentication

All protected endpoints require a JWT token in the `Authorization` header:

```
Authorization: Bearer <token>
```

### Auth Endpoints

#### POST `/api/auth/register`
Create a new user account.

**Body:**
```json
{
  "email": "user@example.com",
  "name": "John Doe",
  "password": "securepassword"
}
```

**Response:** `201 Created`
```json
{
  "user": { "id": "uuid", "email": "user@example.com", "name": "John Doe", "role": "USER" },
  "token": "jwt-token"
}
```

#### POST `/api/auth/login`
Authenticate and receive a JWT token.

**Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword"
}
```

**Response:** `200 OK`
```json
{
  "user": { "id": "uuid", "email": "user@example.com", "name": "John Doe", "role": "USER" },
  "token": "jwt-token"
}
```

#### GET `/api/auth/me`
Get the current authenticated user. **Protected.**

#### POST `/api/auth/change-password`
Change the current user's password. **Protected.**

**Body:**
```json
{
  "currentPassword": "oldpassword",
  "newPassword": "newpassword"
}
```

#### POST `/api/auth/forgot-password`
Request a password reset email.

#### POST `/api/auth/reset-password`
Reset password with a token.

#### POST `/api/auth/logout`
Log out the current user. **Protected.**

---

## OpenClaw AI Assistant

#### GET `/api/openclaw/status`
Get OpenClaw connection status. **Protected.**

**Response:**
```json
{
  "enabled": false,
  "connected": false,
  "gateway": { "url": "", "status": "disconnected" },
  "skills": [],
  "channels": []
}
```

#### POST `/api/openclaw/message`
Send a message to OpenClaw. **Protected.**

**Body:**
```json
{
  "message": "Build me a landing page for my consulting business",
  "skillId": "optional-skill-id"
}
```

**Response:**
```json
{
  "response": "AI-generated response with actionable content",
  "skill": "website-builder",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### GET `/api/openclaw/conversations?limit=50&offset=0`
Get conversation history. **Protected.**

**Response:**
```json
{
  "messages": [
    {
      "id": "uuid",
      "role": "user",
      "content": "Build me a landing page",
      "skillName": "Website Builder",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "total": 100
}
```

#### DELETE `/api/openclaw/conversations`
Clear all conversation history. **Protected.**

#### POST `/api/openclaw/configure`
Configure OpenClaw gateway connection. **Protected.**

**Body:**
```json
{
  "gatewayUrl": "ws://localhost:8080",
  "apiKey": "your-openclaw-api-key"
}
```

#### POST `/api/openclaw/skills/:skillId/toggle`
Enable or disable a skill. **Protected.**

---

## Billing & Plans

#### GET `/api/plans`
Get available subscription plans. **Public.**

**Response:**
```json
{
  "plans": {
    "free": { "name": "Free", "price": 0, "limits": { "maxUsers": 1, "maxSkills": 3, "maxMessages": 100 } },
    "starter": { "name": "Starter", "price": 2900, "limits": { "maxUsers": 5, "maxSkills": 6, "maxMessages": 1000 } },
    "pro": { "name": "Pro", "price": 7900, "limits": { "maxUsers": 25, "maxSkills": 20, "maxMessages": 10000 } },
    "enterprise": { "name": "Enterprise", "price": 0, "limits": { "maxUsers": -1, "maxSkills": -1, "maxMessages": -1 } }
  }
}
```

#### GET `/api/billing`
Get current organization billing info. **Protected.**

#### POST `/api/billing/change-plan`
Change subscription plan. **Protected.**

**Body:**
```json
{
  "plan": "starter"
}
```

#### POST `/api/webhook`
Stripe webhook endpoint. **Public (verified by Stripe signature).**

---

## AI Chat

#### POST `/api/ai/chat`
Send a message to the AI. **Protected.**

**Body:**
```json
{
  "message": "What is the current system status?",
  "provider": "openai"
}
```

#### GET `/api/ai/settings`
Get AI provider settings. **Protected.**

#### PUT `/api/ai/settings`
Update AI provider settings. **Protected.**

---

## Metrics & Monitoring

#### GET `/api/metrics`
Get system metrics. **Protected.**

#### GET `/api/metrics/history`
Get historical metrics. **Protected.**

---

## CRUD Pages

#### GET `/api/crud/pages`
List all CRUD pages. **Protected.**

#### POST `/api/crud/pages`
Create a new CRUD page. **Protected.**

#### GET `/api/crud/pages/:id`
Get a specific CRUD page. **Protected.**

#### PUT `/api/crud/pages/:id`
Update a CRUD page. **Protected.**

#### DELETE `/api/crud/pages/:id`
Delete a CRUD page. **Protected.**

---

## WebSocket Events

Connect to the WebSocket server at `ws://localhost:3000` with Socket.IO.

### Client Events (send)
- `authenticate` — Send JWT token for auth
- `openclaw:message` — Send message to OpenClaw
- `metrics:subscribe` — Subscribe to real-time metrics

### Server Events (receive)
- `authenticated` — Auth confirmation
- `openclaw:response` — OpenClaw AI response
- `openclaw:status` — Connection status updates
- `metrics:update` — Real-time metrics data
- `error` — Error notifications

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message description",
  "statusCode": 400
}
```

Common status codes:
- `400` — Bad Request (invalid input)
- `401` — Unauthorized (missing/invalid token)
- `403` — Forbidden (insufficient permissions)
- `404` — Not Found
- `429` — Too Many Requests (rate limited)
- `500` — Internal Server Error
