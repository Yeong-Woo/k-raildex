import { Module } from '@nestjs/common';
import { ChangesetController } from './changeset.controller';

@Module({ controllers: [ChangesetController] })
export class ChangesetModule {}
