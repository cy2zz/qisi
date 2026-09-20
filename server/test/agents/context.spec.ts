// 评分上下文必须真的有检验题。
//
// SessionContext.checkTask 可为空：A 的会话模型允许会话没有检验题
// （packet.check_tasks 可以为空）。教学轮不读它，评分读它。
//
// 为什么评分必须显式拒绝而不是用占位：空 rubric 会让评分看起来正常完成，
// 而「未通过」会被当成评分结论——那是编造的结论，不是评分。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PacketSchema, type Packet } from '../../src/contracts/domain.schema.js';
import { MissingCheckTaskError, projectAssessmentInput, type SessionContext } from '../../src/agents/context.js';

const fixturesDirectory = path.resolve(import.meta.dirname, '..', '..', '..', 'qisi-sdd-v3', 'fixtures');
const read = <T>(name: string): T => JSON.parse(readFileSync(path.join(fixturesDirectory, name), 'utf8')) as T;

const packet = PacketSchema.parse(read<Packet>('packet.json'));
const problem = read<SessionContext['problem']>('problem.json');

const checkTaskFixture = packet.check_tasks[0];
if (checkTaskFixture === undefined) throw new Error('夹具 packet.json 缺少 check_tasks[0]，本文件的断言会退化');

function context(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    taskId: packet.problem_id,
    problem,
    referenceMaterialMd: packet.reference_md,
    studentRouteMd: null,
    submissions: [],
    previousHypotheses: [],
    previousProbes: [],
    decisions: packet.decisions,
    routes: packet.routes,
    privateReferenceMd: packet.reference_md,
    diagnosis: read<SessionContext['diagnosis']>('diagnosis.json'),
    userAction: 'attempt',
    exposures: [],
    remainingProbes: 2,
    remainingCalls: 6,
    routePatch: null,
    publicPromptMd: problem.statement_md,
    publicHistoryMd: [],
    strategy: read<SessionContext['strategy']>('strategy.json'),
    checkTask: checkTaskFixture,
    lockedPlanMd: 'P=2(x+9/x)',
    finalAnswerMd: '最小值 6',
    guardReferenceMd: packet.reference_md,
    ...overrides,
  };
}

describe('评分上下文必须真的有检验题', () => {
  it('有检验题时按它评分', () => {
    expect(projectAssessmentInput(context()).task).toBe(checkTaskFixture);
  });

  it('没有检验题时显式拒绝，而不是拿空 rubric 打分', () => {
    expect(() => projectAssessmentInput(context({ checkTask: null }))).toThrow(MissingCheckTaskError);
  });
});
