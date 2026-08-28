# ── Build stage ───────────────────────────────────────────
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

# Drop root. The node image ships an unprivileged `node` user; running as root
# means any RCE in a dependency starts with full control of the container.
# Ownership is handed over first so the app can still read what it needs.
RUN chown -R node:node /app
USER node

# Cloud Run injects PORT (8080). server.ts reads process.env.PORT and binds 0.0.0.0.
EXPOSE 8080
CMD ["node", "dist/server.js"]
