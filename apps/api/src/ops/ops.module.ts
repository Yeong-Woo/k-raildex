/** 운영 기능: 작업(job) 목록·요청, 전체 검증, 원본 재다운로드, 에이전트 예산 설정 (WP 4.3·4.9·4.11) */
import { Module } from '@nestjs/common';
import { OpsController } from './ops.controller';

@Module({ controllers: [OpsController] })
export class OpsModule {}
