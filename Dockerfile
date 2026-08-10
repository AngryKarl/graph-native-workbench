FROM node:24-bookworm-slim AS build
WORKDIR /source
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm dist:build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /source/apps/distribution/package.json ./package.json
COPY --from=build /source/apps/distribution/dist ./dist
RUN npm install --omit=dev --no-audit --no-fund \
  && mkdir -p /data \
  && chown -R node:node /app /data
USER node
WORKDIR /data
EXPOSE 4311
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4311/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "/app/dist/graph-workbench.js"]
