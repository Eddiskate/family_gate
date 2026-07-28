# syntax=docker/dockerfile:1

FROM node:22-bookworm AS build
WORKDIR /app

COPY package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN npm install

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

COPY package.json ./
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
