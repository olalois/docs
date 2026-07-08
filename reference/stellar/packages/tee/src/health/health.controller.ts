import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { TeeService } from '../tee/tee.service';
import { ConfigService } from '@nestjs/config';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly teeService: TeeService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'TEE runtime status' })
  async getHealth() {
    let teeStatus = 'unavailable';
    try {
      const info = await this.teeService.getInfo();
      if (info?.appId) teeStatus = 'active';
    } catch {}
    return {
      status: 'ok',
      service: 'wraith-tee',
      network: this.config.get<string>('stellar.network'),
      tee: teeStatus,
      timestamp: new Date().toISOString(),
    };
  }
}
