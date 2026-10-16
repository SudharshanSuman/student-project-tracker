FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/api/prisma apps/api/prisma
RUN npm ci --workspace @iic/api --include-workspace-root=false
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @iic/api

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
# Chromium + fonts for the PDF report engine (puppeteer-core does not bundle a browser).
RUN apk add --no-cache chromium nss freetype harfbuzz ttf-freefont font-noto
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/package.json ./apps/api/
WORKDIR /app/apps/api
# STORAGE_DIR in docker-compose.yml points at /data/storage (a named volume); create and
# own it here so Docker copies this ownership onto the volume on first start, not root:root.
RUN mkdir -p /data/storage && chown node:node /data/storage
USER node
EXPOSE 4000
# Apply pending migrations, then start.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
