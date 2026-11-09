import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module.js';
import { AvisosModule } from './avisos/avisos.js';
import { CentrosModule } from './centros/centros.module.js';
import { validateEnv } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { PacientesModule } from './pacientes/pacientes.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ProfesionalesModule } from './profesionales/profesionales.js';
import { SalasModule } from './salas/salas.js';
import { TurnosModule } from './turnos/turnos.controller.js';
import { UsuariosModule } from './usuarios/usuarios.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Límite general por IP; el login tiene uno más estricto.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    PrismaModule,
    HealthModule,
    AuthModule,
    UsuariosModule,
    CentrosModule,
    SalasModule,
    ProfesionalesModule,
    PacientesModule,
    AvisosModule,
    TurnosModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
