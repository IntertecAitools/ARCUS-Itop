# The BFF as a production image. Build from the repository root, because the
# compiled CMDB schema (cmdb-schema/*.json) lives outside backend/:
#
#   docker build -f backend/Dockerfile -t arcus-bff .
#
# Configuration comes from the environment (see backend/.env.example and
# docs/deployment.md); no .env file is baked in.

ARG NODE_IMAGE=node:24.14.1-alpine3.23

# --- build: compile TypeScript ----------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY backend/tsconfig.json backend/tsconfig.build.json ./
COPY backend/src ./src
RUN npm run build

# --- deps: production dependencies only --------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# --- runtime -----------------------------------------------------------------
FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    CMDB_SCHEMA_PATH=/app/cmdb-schema/cmdb-schema.json \
    CMDB_NAVIGATION_PATH=/app/cmdb-schema/cmdb-navigation.json \
    CMDB_DASHBOARDS_PATH=/app/cmdb-schema/cmdb-dashboards.json
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY backend/package.json ./
COPY cmdb-schema/cmdb-schema.json cmdb-schema/cmdb-navigation.json cmdb-schema/cmdb-dashboards.json ./cmdb-schema/

# The node image ships an unprivileged `node` user (uid 1000). Nothing in /app
# is writable by it: the BFF keeps no files.
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1
CMD ["node", "dist/index.js"]
