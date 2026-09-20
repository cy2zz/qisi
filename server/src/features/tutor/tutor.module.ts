// 教学轮 Nest 模块。
//
// 【装配状态】本模块已接入 server/src/app.module.ts。该文件属 A 的写集，本次按
// 项目方明确指示改动，作为交接项在提交信息中记明。
//
// SUBMIT_TURN_DEPS 的提供者见 ./submit-turn.deps.ts —— 那里是唯一的装配决定点
// （接哪个 StorePort、哪个会话端口），并逐条记录该装配的代价，尤其是A learning 事务与 B 工作流的适配限制。本模块只声明「教学轮由本模块提供」，不替
// 装配点做决定。
//
// 【确定性测试不要装配本模块】它需要真实持久层（DatabaseService）与 A 的模型端口
// （MODEL_PORT）。四角色链路的确定性测试直接用 createTurnRunner
// （见 test/tutor/submit-turn.deps.spec.ts）；应用级装配守卫见
// test/tutor/app-wiring.spec.ts（它走 AppModule，守住「依赖图错了就起不来」）。
//
// 会话端口的默认绑定是**真库**：内存端口只留给测试显式覆盖
// （overrideProvider(TUTOR_SESSION_PORT)）。应用里留一个静默返回内存会话的绑定，
// 会让下一个消费该令牌的人以为会话是持久的。

import { Module } from '@nestjs/common';
import { ModelModule } from '../../model/model.module.js';
import { LearningSessionModule } from '../learning/learning-session.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseTutorSessionPort } from './database-session.port.js';
import { submitTurnDepsProvider } from './submit-turn.deps.js';
import { TutorController } from './tutor.controller.js';
import { SUBMIT_TURN_DEPS, TUTOR_SESSION_PORT, TutorService } from './tutor.service.js';

@Module({
  imports: [AuthModule, ModelModule, LearningSessionModule],
  controllers: [TutorController],
  providers: [
    { provide: TUTOR_SESSION_PORT, useClass: DatabaseTutorSessionPort },
    submitTurnDepsProvider,
    TutorService,
  ],
  exports: [TutorService, TUTOR_SESSION_PORT],
})
export class TutorModule {}

// 令牌声明在 tutor.service.ts（叶子模块，避免与提供者互相 import 成环）；
// 此处重新导出，既有引用方不必改。
export { SUBMIT_TURN_DEPS };
