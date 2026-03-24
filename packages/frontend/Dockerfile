FROM node:18-alpine AS builder

WORKDIR /app

# Copy root package files
COPY package.json yarn.lock ./
COPY packages/shared/package.json packages/shared/
COPY packages/frontend/package.json packages/frontend/

# Install dependencies
RUN yarn install --frozen-lockfile || yarn install

# Copy source code
COPY packages/shared packages/shared
COPY packages/frontend packages/frontend
COPY tsconfig.json tsconfig.node.json vite.config.ts ./

# Build shared package first, then frontend
RUN cd packages/shared && yarn build
RUN cd packages/frontend && yarn build

FROM nginx:alpine

COPY --from=builder /app/packages/frontend/dist /usr/share/nginx/html

# Nginx config for SPA routing
RUN echo 'server { \
    listen 80; \
    root /usr/share/nginx/html; \
    index index.html; \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
