# Backend — Centro Integral

API en NestJS + Prisma + PostgreSQL.

```bash
cp .env.example .env      # ajustar DATABASE_URL
npm install               # genera también el cliente de Prisma
npm run db:migrate        # aplica migraciones en la base local
npm run start:dev         # http://localhost:3000/api/v1
```

- Documentación OpenAPI: http://localhost:3000/api/docs (JSON en `/api/openapi.json`)
- Salud: `GET /api/v1/health`
- Tests: `npm test` (unitarios) y `npm run test:e2e`
- Lint: `npm run lint` (oxlint)
