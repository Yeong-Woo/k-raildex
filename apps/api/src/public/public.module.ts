/** 공개 읽기 API (docs/04-api.md 5절, WP 6.4~6.6) */
import { Module } from '@nestjs/common';
import { PublicCache } from './public-cache';
import { PublicController } from './public.controller';

@Module({ controllers: [PublicController], providers: [PublicCache] })
export class PublicModule {}
