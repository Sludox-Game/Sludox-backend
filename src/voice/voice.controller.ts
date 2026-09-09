import { Controller, Get } from '@nestjs/common';
import { VoiceService, VoiceHealthStatus } from './voice.service';

@Controller('voice')
export class VoiceController {
  constructor(private readonly voiceService: VoiceService) {}

  @Get('health')
  getHealth(): VoiceHealthStatus {
    return this.voiceService.getHealthStatus();
  }
}
