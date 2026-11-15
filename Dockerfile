# Imagem de produção do Kart Online: um processo só entrega o jogo (cliente
# compilado), a API de contas e o WebSocket das corridas, na porta $PORT.
#   docker build -t kart-online .
#   docker run -p 8080:8080 --env-file .env.producao kart-online
# Variáveis obrigatórias: DATABASE_URL e AUTH_SECRET (ver docs/deploy.md).

FROM node:22-bookworm-slim AS base
# O Prisma precisa do OpenSSL para falar com o PostgreSQL.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo

# --- dependências (camada em cache enquanto o lockfile não mudar) -------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/client/package.json apps/client/
COPY apps/client/scripts apps/client/scripts
COPY apps/server/package.json apps/server/
COPY apps/server/prisma apps/server/prisma
RUN pnpm install --frozen-lockfile --filter "@kart/server..." --filter "@kart/client..."

# --- compilação --------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/client apps/client
COPY apps/server apps/server
RUN pnpm --filter @kart/shared build \
  && pnpm --filter @kart/client build \
  && pnpm --filter @kart/server build
# Só o servidor e as dependências de produção dele, sem o resto do monorepo.
RUN pnpm --filter @kart/server deploy --prod /out \
  && cd /out && node node_modules/prisma/build/index.js generate

# --- execução ----------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    CLIENT_DIR=/app/client \
    TRUST_PROXY=1
WORKDIR /app/server
COPY --from=build --chown=node:node /out ./
COPY --from=build --chown=node:node /repo/apps/client/dist /app/client
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/index.js"]
