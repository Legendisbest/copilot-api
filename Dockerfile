# Stage 1: Build the web UI dashboard
FROM oven/bun:1.2.19-alpine AS web-builder
WORKDIR /web
COPY ./web/package.json ./web/bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install
COPY ./web/ .
RUN bun run build

# Stage 2: Build the backend
FROM oven/bun:1.2.19-alpine AS builder
WORKDIR /app

COPY ./package.json ./bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
COPY --from=web-builder /web/../dist/web ./dist/web
RUN bun run build

# Stage 3: Production runner
FROM oven/bun:1.2.19-alpine AS runner
WORKDIR /app

COPY ./package.json ./bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts --no-cache

COPY --from=builder /app/dist ./dist
COPY --from=web-builder /web/../dist/web ./dist/web
COPY ./drizzle ./drizzle

EXPOSE 4141

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --spider -q http://localhost:4141/ || exit 1

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
