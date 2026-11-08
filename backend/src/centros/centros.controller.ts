import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SoloSuperadmin } from '../auth/decoradores.js';
import { ApiBodyZod } from '../common/zod.js';
import {
  CentrosService,
  crearCentroSchema,
  type CrearCentroDto,
} from './centros.service.js';

@ApiTags('centros')
@ApiBearerAuth()
@SoloSuperadmin()
@Controller('centros')
export class CentrosController {
  constructor(private readonly centros: CentrosService) {}

  @Get()
  listar() {
    return this.centros.listar();
  }

  @Post()
  @ApiBodyZod(crearCentroSchema)
  crear(@Body({ schema: crearCentroSchema }) dto: CrearCentroDto) {
    return this.centros.crear(dto);
  }
}
