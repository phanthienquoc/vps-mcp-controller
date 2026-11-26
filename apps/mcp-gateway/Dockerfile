FROM node:26-bookworm-slim AS build
WORKDIR /app
COPY package.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/mcp-gateway/package.json apps/mcp-gateway/package.json
COPY apps/root-agent/package.json apps/root-agent/package.json
RUN npm install --no-audit --no-fund
COPY packages/contracts packages/contracts
COPY apps/mcp-gateway apps/mcp-gateway
RUN npm run build -w @vps-mcp/contracts && npm run build -w @vps-mcp/gateway
FROM node:26-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY package.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/mcp-gateway/package.json apps/mcp-gateway/package.json
COPY apps/root-agent/package.json apps/root-agent/package.json
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/apps/mcp-gateway/dist apps/mcp-gateway/dist
USER 10001:34001
EXPOSE 3000
CMD ["node","apps/mcp-gateway/dist/index.js"]
