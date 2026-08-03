# syntax=docker/dockerfile:1

FROM node:22-bookworm AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

# Retry npm install — EasyPanel builds sometimes hit transient ENETUNREACH to registry.npmjs.org
RUN npm config set fetch-retries 5 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 120000 \
  && for i in 1 2 3 4 5; do \
       npm ci && break || \
       (echo "npm ci failed (attempt $i), retrying…" && sleep $((i * 15))); \
     done \
  && test -d node_modules

COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web

RUN npm run build -w @family-gate/shared \
  && npm run build -w @family-gate/api \
  && npm run build -w @family-gate/web

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3036
ENV HOST=0.0.0.0
ENV DATA_DIR=/app/data
ENV WEB_DIST_DIR=/app/public

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/web/dist/web/browser ./public

WORKDIR /app/apps/api
EXPOSE 3036
CMD ["node", "dist/index.js"]
