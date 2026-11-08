import { Module } from '@nestjs/common';
import { CentrosController } from './centros.controller.js';
import { CentrosService } from './centros.service.js';

@Module({
  controllers: [CentrosController],
  providers: [CentrosService],
})
export class CentrosModule {}
