FROM node:18-alpine AS builder

WORKDIR /app

# Copy root package files
COPY package.json yarn.lock ./
COPY packages/shared/package.json packages/shared/
COPY packages/backend/package.json packages/backend/

# Install dependencies
RUN yarn install --frozen-lockfile || yarn install

# Copy source code
COPY packages/shared packages/shared
COPY packages/backend packages/backend
COPY tsconfig.json ./

# Build shared package first, then backend
RUN cd packages/shared && yarn build
RUN cd packages/backend && yarn build

FROM node:18-alpine

WORKDIR /app

COPY --from=builder /app/packages/backend/dist ./dist
COPY --from=builder /app/packages/backend/package.json ./
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/backend/node_modules ./packages/backend/node_modules

EXPOSE 3000

CMD ["node", "dist/index.js"]
