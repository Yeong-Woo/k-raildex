/** Nest 앱 생성(main·시험 공용) */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule, type AppModuleOptions } from './app.module';

export async function createApp(
  opts: AppModuleOptions,
  nest: { logger?: false | ('log' | 'error' | 'warn' | 'debug' | 'verbose' | 'fatal')[] } = {},
): Promise<NestFastifyApplication> {
  // 본문 파싱 실패 등 Fastify 오류도 Nest 가 전역 필터(AllExceptionsFilter)로 보내 같은 오류 형식이 된다
  const adapter = new FastifyAdapter({ bodyLimit: 20 * 1024 * 1024 });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(opts), adapter, {
    logger: nest.logger ?? ['log', 'error', 'warn'],
  });
  app.enableShutdownHooks();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
