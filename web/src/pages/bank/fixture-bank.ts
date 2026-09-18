export interface FixtureProblem {
  id: string;
  number: string;
  source: string;
  statementMd: string;
  topic: string;
}

export const FIXTURE_BANK_VERSION = 'fixture-2026-09-17';

export const fixtureProblems: FixtureProblem[] = [
  {
    id: 'derivative-monotonicity',
    number: 'F-01',
    source: '启思自拟开发夹具',
    statementMd: '已知函数 $f(x)=x^3-3x$，求 $f(x)$ 的单调区间与极值。',
    topic: '导数与函数',
  },
  {
    id: 'sequence-recurrence',
    number: 'F-02',
    source: '启思自拟开发夹具',
    statementMd:
      '数列 $\\{a_n\\}$ 满足 $a_1=1$，$a_{n+1}=2a_n+1$。求 $a_n$ 的通项公式。',
    topic: '数列与递推',
  },
  {
    id: 'line-circle-position',
    number: 'F-03',
    source: '启思自拟开发夹具',
    statementMd:
      '已知圆 $C:x^2+y^2-4x+2y-4=0$，判断直线 $l:x-y+1=0$ 与圆 $C$ 的位置关系。',
    topic: '解析几何',
  },
];

export function getFixtureProblem(problemId: string | undefined) {
  return fixtureProblems.find((problem) => problem.id === problemId);
}

export function fixtureSessionId(problemId: string) {
  return `fixture-${problemId}`;
}

export function problemIdFromFixtureSession(sessionId: string | undefined) {
  return sessionId?.startsWith('fixture-') ? sessionId.slice('fixture-'.length) : undefined;
}
