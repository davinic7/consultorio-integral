import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Module,
  NotFoundException,
  OnModuleDestroy,
  Param,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { CentroActual, Roles, UsuarioActual } from '../auth/decoradores.js';
import { idParam } from '../common/comunes.js';
import type { Env } from '../config/env.js';
import { Modulo, Rol } from '../generated/prisma/client.js';
import {
  NotasModule,
  NotasService,
  profesionalAsignado,
  validarTurno,
} from '../notas/notas.js';
import { RequiereModulo } from '../planes/planes.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ClavesDictado } from './claves.js';
import { crearMotor } from './motor.js';
import {
  abrirPaquete,
  datosAdicionales,
  ErrorPaquete,
  EXTRA_PAQUETE,
  leerPaquete,
} from './paquete.js';
import { ErrorCola, TrabajosDictado } from './trabajos.js';
import {
  ErrorAudio,
  FRECUENCIA,
  leerWav,
  MAX_BYTES,
  MAX_SEGUNDOS,
} from './wav.js';

/** Lo más grande que se acepta: 10:05 de WAV más lo que suma el cifrado. */
export const MAX_SUBIDA = MAX_BYTES + EXTRA_PAQUETE;
/** Subidas por minuto desde una misma IP (además del límite por persona de la cola). */
const SUBIDAS_POR_MIN = Number(process.env.DICTADO_SUBIDAS_POR_MIN ?? 10);

const subirSchema = z.object({ turnoId: z.uuid().optional() });

/**
 * Termina de leer el cuerpo sin guardar nada, así el cliente recibe la respuesta
 * en vez de ver la conexión cortada. Si mandan más que el tope, se corta.
 */
function descartarCuerpo(req: Request, tope: number): Promise<void> {
  return new Promise((resolve) => {
    let descartado = 0;
    req.on('data', (c: Buffer) => {
      descartado += c.length;
      if (descartado > tope) {
        req.destroy();
        resolve();
      }
    });
    req.on('end', resolve);
    req.on('close', resolve);
    req.on('error', () => resolve());
    req.resume();
  });
}

const muyGrande = () =>
  new PayloadTooLargeException('La grabación supera los 10 minutos');

/**
 * Lee el cuerpo crudo en memoria, con tope. Nada va a disco: no se usa multer ni
 * archivos temporales.
 */
async function leerCuerpo(req: Request, limite: number): Promise<Buffer> {
  if (Number(req.headers['content-length']) > limite) {
    await descartarCuerpo(req, 2 * limite);
    throw muyGrande();
  }
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    let total = 0;
    const alDato = (c: Buffer) => {
      total += c.length;
      if (total > limite) {
        req.off('data', alDato);
        partes.length = 0;
        void descartarCuerpo(req, limite).then(() => reject(muyGrande()));
        return;
      }
      partes.push(c);
    };
    req.on('data', alDato);
    req.on('end', () => resolve(Buffer.concat(partes)));
    req.on('error', reject);
  });
}

/**
 * Dictado del expediente (docs/diseno/expediente-dictado.md, decisiones.md §19 y
 * §20). El teléfono manda la grabación cifrada con la clave pública de la persona;
 * acá se abre en memoria, se transcribe y el texto se suma al borrador del paciente.
 * Solo dicta quien escribe notas (profesional, o admin que atiende) y atiende al
 * paciente, con los módulos notas y dictado. Recepción nunca recibe audio ni texto.
 */
@ApiTags('dictado')
@ApiBearerAuth()
@Roles(Rol.profesional, Rol.admin)
@RequiereModulo(Modulo.notas, Modulo.dictado)
@Controller()
export class DictadoController {
  constructor(
    private readonly trabajos: TrabajosDictado,
    private readonly claves: ClavesDictado,
    private readonly prisma: PrismaService,
  ) {}

  @Get('dictados/estado')
  estado() {
    return {
      disponible: this.trabajos.disponible,
      maxSegundos: MAX_SEGUNDOS,
    };
  }

  /** Mi clave pública vigente, para cifrar las grabaciones en el teléfono. */
  @Get('dictados/clave')
  async clave(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
  ) {
    await this.conFicha(centroId, quien);
    return this.claves.vigente(centroId, quien.usuarioId);
  }

  /** Par nuevo (por ejemplo, si se perdió el teléfono). Lo pendiente se sigue abriendo. */
  @Post('dictados/clave/renovar')
  async renovar(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
  ) {
    await this.conFicha(centroId, quien);
    return this.claves.renovar(centroId, quien.usuarioId);
  }

  @Post('pacientes/:id/dictados')
  @HttpCode(202)
  @Throttle({ default: { limit: SUBIDAS_POR_MIN, ttl: 60_000 } })
  @ApiConsumes('application/octet-stream')
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  async subir(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Param('id', { schema: idParam }) pacienteId: string,
    @Query({ schema: subirSchema }) q: z.infer<typeof subirSchema>,
    @Req() req: Request,
  ) {
    if (!this.trabajos.disponible) {
      throw new ServiceUnavailableException(
        'El dictado todavía no está disponible',
      );
    }
    if (
      !(req.headers['content-type'] ?? '').startsWith(
        'application/octet-stream',
      )
    ) {
      throw new UnsupportedMediaTypeException(
        'La grabación tiene que llegar cifrada',
      );
    }
    const db = this.prisma.paraCentro(centroId);
    const profesionalId = await profesionalAsignado(db, quien, pacienteId);
    await validarTurno(db, q.turnoId, pacienteId, profesionalId);

    const cuerpo = await leerCuerpo(req, MAX_SUBIDA);
    let muestras: Int16Array;
    try {
      const paquete = leerPaquete(cuerpo);
      const privada = await this.claves.privada(
        centroId,
        quien.usuarioId,
        paquete.versionClave,
      );
      if (!privada) throw new ErrorPaquete('No se pudo abrir la grabación');
      const wav = abrirPaquete(
        paquete,
        privada,
        datosAdicionales({ centroId, usuarioId: quien.usuarioId, pacienteId }),
      );
      try {
        muestras = leerWav(wav);
      } finally {
        wav.fill(0);
      }
    } catch (e) {
      if (e instanceof ErrorPaquete || e instanceof ErrorAudio) {
        throw new BadRequestException(e.message);
      }
      throw e;
    }
    if (muestras.length < FRECUENCIA / 2) {
      throw new BadRequestException('La grabación es demasiado corta');
    }
    try {
      return this.trabajos.crear(
        {
          centroId,
          usuarioId: quien.usuarioId,
          pacienteId,
          profesionalId,
          turnoId: q.turnoId ?? null,
        },
        muestras,
      );
    } catch (e) {
      if (e instanceof ErrorCola) {
        throw e.motivo === 'cola_llena'
          ? new ServiceUnavailableException(e.message)
          : new HttpException(e.message, HttpStatus.TOO_MANY_REQUESTS);
      }
      throw e;
    }
  }

  /** Cómo va mi dictado. Sin texto: el texto ya está en el borrador. */
  @Get('dictados/:id')
  consultar(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Param('id', { schema: idParam }) id: string,
  ) {
    const v = this.trabajos.consultar(id, {
      centroId,
      usuarioId: quien.usuarioId,
    });
    if (!v) throw new NotFoundException('Dictado no encontrado');
    return v;
  }

  @Delete('dictados/:id')
  @HttpCode(204)
  descartar(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Param('id', { schema: idParam }) id: string,
  ): void {
    if (
      !this.trabajos.descartar(id, { centroId, usuarioId: quien.usuarioId })
    ) {
      throw new NotFoundException('Dictado no encontrado');
    }
  }

  /** Solo tiene clave quien escribe notas: con ficha de profesional activa en el centro. */
  private async conFicha(
    centroId: string,
    quien: UsuarioAutenticado,
  ): Promise<void> {
    const yo = await this.prisma.paraCentro(centroId).profesional.findFirst({
      where: { usuarioId: quien.usuarioId, activo: true },
      select: { id: true },
    });
    if (!yo) {
      throw new ForbiddenException(
        'Tu cuenta no está vinculada a un profesional del centro',
      );
    }
  }
}

@Module({
  imports: [NotasModule],
  controllers: [DictadoController],
  providers: [
    ClavesDictado,
    {
      provide: TrabajosDictado,
      inject: [ConfigService, NotasService],
      useFactory: (config: ConfigService<Env, true>, notas: NotasService) =>
        new TrabajosDictado(
          crearMotor({
            NODE_ENV: config.get('NODE_ENV', { infer: true }),
            DICTADO_MOTOR: config.get('DICTADO_MOTOR', { infer: true }),
            WHISPER_URL: config.get('WHISPER_URL', { infer: true }),
          }),
          (t, texto) =>
            notas.sumarAlBorrador(
              t.centroId,
              t.profesionalId,
              t.pacienteId,
              texto,
              t.turnoId,
            ),
          { limpiezaAutomatica: true },
        ),
    },
  ],
})
export class DictadoModule implements OnModuleDestroy {
  constructor(private readonly trabajos: TrabajosDictado) {}

  onModuleDestroy(): void {
    this.trabajos.detener();
  }
}
