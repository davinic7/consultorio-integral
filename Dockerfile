# Imagen única de Centro Integral: la API (NestJS) sirve también la web (Angular).
# Sirve igual para Render, Railway, Fly.io o un servidor propio.
#
#   docker build -t centro-integral .
#   docker run -p 3000:3000 -e DATABASE_URL=... -e JWT_SECRET=... centro-integral

# ───────── Etapa 1: compilar ─────────
FROM node:26-slim AS build
WORKDIR /app

# Dependencias primero (se cachean mientras no cambien los package-lock).
COPY frontend/package.json frontend/package-lock.json frontend/
RUN cd frontend && npm ci

COPY backend/package.json backend/package-lock.json backend/prisma.config.ts backend/
COPY backend/prisma backend/prisma
RUN cd backend && npm ci

# Código y compilación.
COPY frontend frontend
RUN cd frontend && npm run build

COPY backend backend
RUN cd backend && npx prisma generate && npm run build

# ───────── Etapa 2: ejecutar ─────────
FROM node:26-slim
# Prisma Migrate necesita OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000 \
    FRONTEND_DIR=/app/web
WORKDIR /app/backend

# Se conservan las dependencias de desarrollo: prisma (migraciones) y tsx (seed y scripts).
COPY --from=build /app/backend/package.json /app/backend/prisma.config.ts ./
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/backend/prisma ./prisma
COPY --from=build /app/backend/scripts ./scripts
COPY --from=build /app/backend/src ./src
COPY --from=build /app/frontend/dist/frontend/browser /app/web

USER node
EXPOSE 3000
CMD ["sh", "scripts/arrancar.sh"]
