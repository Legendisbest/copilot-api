ARG BUN_VERSION=1.3.6

# Stage 1: Build the web UI dashboard
FROM node:22-alpine AS web-builder
WORKDIR /web
COPY ./web/package.json ./web/package-lock.json ./
RUN npm ci
COPY ./web/ ./
RUN npm run build

# Stage 2: Build the backend
FROM oven/bun:${BUN_VERSION}-alpine AS builder
WORKDIR /app

COPY ./package.json ./bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

COPY . .
RUN bun run build

# Stage 3: Production runner
FROM oven/bun:${BUN_VERSION}-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV COPILOT_API_HOME=/data

COPY ./package.json ./bun.lock ./
RUN apk add --no-cache wget
RUN bun install --frozen-lockfile --production --ignore-scripts --no-cache

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/pages ./pages
COPY --from=web-builder /dist/web ./dist/web

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD sh -c 'wget --spider -q "http://127.0.0.1:${PORT:-8080}/health" || exit 1'

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
RUN mkdir -p /data && chown -R bun:bun /app /data /entrypoint.sh

EXPOSE 8080
USER bun
ENTRYPOINT ["/entrypoint.sh"]
CMD ["start"]
