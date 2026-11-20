import { Controller, Get } from '@nestjs/common';
import { RequireScope } from '../auth/principal';
import { buildOpenApi } from './openapi';

@Controller('v1')
export class OpenApiController {
  private doc: Record<string, unknown> | null = null;

  @Get('openapi.json')
  @RequireScope('admin:read')
  openapi() {
    return (this.doc ??= buildOpenApi());
  }
}
