// 教学轮 Nest 模块。
//
// **本模块尚未接入 server/src/app.module.ts。** 该文件是 A 的写集
// （A01 write_scope 含 server/src/shared/**、公共配置；B01/B02/B03 的写集均不含装配入口），
// 按 AGENTS.md §4「跨 owner 的共享接口先在交接/变更中提出，由对应 owner 合入」，
// 装配作为交接项提交，由 A 合入。
//
// 在 A 合入之前，本模块可被测试独立装配：
//   Test.createTestingModule({ imports: [TutorModule] })
// 这正是 AGENTS.md 对 B01 回滚计划的要求——「B01 新模块应可从装配入口移除」。
//
// SUBMIT_TURN_DEPS 由装配方提供：它把教学轮接到 WorkflowOrchestrator 与 StorePort，
// 那部分的接线依赖 A 的持久层门面（尚未交付），因此必须由装配点显式决定，
// 而不是在模块内部悄悄退回内存实现。

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TutorController } from './tutor.controller.js';
import { InMemoryTutorSessionPort, TUTOR_SESSION_PORT, TutorService } from './tutor.service.js';

export const SUBMIT_TURN_DEPS = 'SUBMIT_TURN_DEPS';

@Module({
  imports: [AuthModule],
  controllers: [TutorController],
  providers: [
    // 默认给出内存会话端口，使模块在测试装配下即可工作。
    // 真实持久化由装配方覆盖 TUTOR_SESSION_PORT 绑定（A 的 session 门面）。
    { provide: TUTOR_SESSION_PORT, useClass: InMemoryTutorSessionPort },
    TutorService,
  ],
  exports: [TutorService, TUTOR_SESSION_PORT],
})
export class TutorModule {}
