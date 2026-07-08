import { Module } from '@nestjs/common';
import { NotificationModule } from '../notifications/notification.module';
import { AgentService } from './agent.service';
import { AgentController } from './agent.controller';
import { AgentToolsService } from './tools/agent-tools.service';

@Module({
  imports: [NotificationModule],
  providers: [AgentService, AgentToolsService],
  controllers: [AgentController],
  exports: [AgentService, AgentToolsService],
})
export class AgentModule {}
