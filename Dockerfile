# AllowanceAgent — Production Dockerfile
# Uses Bun runtime — @aixyz requires Bun's CJS/ESM interop

# ---- Build stage ----
FROM oven/bun:1 AS builder

WORKDIR /app

# Install dependencies first (layer caching — deps change less often than code)
COPY package.json bun.lock* package-lock.json* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# Copy source
COPY tsconfig.json ./
COPY aixyz.config.ts ./
COPY src/ ./src/
COPY app/ ./app/
COPY public/ ./public/
COPY policies/ ./policies/

# Typecheck (fail fast if types are broken)
RUN bunx tsc --noEmit

# ---- Production stage ----
FROM oven/bun:1 AS production


WORKDIR /app

# Copy dependencies from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy source (bun runs TypeScript directly)
COPY --from=builder /app/package.json ./
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/aixyz.config.ts ./
COPY --from=builder /app/src/ ./src/
COPY --from=builder /app/app/ ./app/
COPY --from=builder /app/public/ ./public/
COPY --from=builder /app/policies/ ./policies/

# Create directories for root user
RUN mkdir -p /app/data /root/.ows


# Railway injects PORT env var
EXPOSE ${PORT:-3001}

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3001}/health || exit 1

# Start HTTP server
CMD ["bun", "app/server.ts"]
