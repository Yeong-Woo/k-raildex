import { Module } from '@nestjs/common';
import { AdminExtraController } from './admin-extra.controller';
import { EntityController } from './entity.controller';
import { EntityService } from './entity.service';

@Module({
  controllers: [AdminExtraController, EntityController],
  providers: [EntityService],
  exports: [EntityService],
})
export class EntityModule {}
