import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, apiFetch } from '../../../lib/api';
import { MathMarkdown } from '../../../shared/MathMarkdown';

type Verdict = 'correct' | 'incorrect' | 'unknown' | 'unanswered';
type OriginalStatus =
  | 'in_progress'
  | 'incomplete'
  | 'unknown'
  | 'completed_with_help'
  | 'completed_without_recorded_help';

interface AttemptReport {
  assistance_requested: boolean;
  attempt_id: string;
  execution: Verdict;
  help_exposed: boolean;
  independent_execution: boolean;
  independent_planning: boolean;
  independent_task_pass: boolean;
  invalidated: boolean;
  limitations: string[];
  planning: Verdict;
  relation: 'near_duplicate' | 'near_transfer';
  task_id: string;
}

interface Report {
  attempts: AttemptReport[];
  delayed_evidence: 'not_evaluated';
  limitations: string[];
  observations: string[];
  original_status: OriginalStatus;
  session_id: string;
}

const verdictLabels: Record<Verdict, string> = {
  correct: '有依据',
  incorrect: '需要修正',
  unknown: '证据不足',
  unanswered: '未作答',
};

const originalLabels: Record<OriginalStatus, string> = {
  completed_with_help: '本题作答有依据 · 使用过帮助',
  completed_without_recorded_help: '本题作答有依据 · 未记录帮助',
  incomplete: '当前结论需要修正',
  in_progress: '还在进行中',
  unknown: '证据不足',
};

export function ReportPage({ username }: { username: string }) {
  const { sessionId = '' } = useParams();
  const [error, setError] = useState('');
  const [report, setReport] = useState<Report | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<Report>(`/api/reports/sessions/${sessionId}`, { signal: controller.signal })
      .then(setReport)
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
        setError(
          requestError instanceof ApiError && requestError.status === 404
            ? '这份学习记录不存在或已过保存期。'
            : '暂时无法读取学习报告，请稍后重试。',
        );
      });
    return () => controller.abort();
  }, [sessionId]);

  if (!report) {
    return (
      <main className="report-page">
        <div className={error ? 'report-load report-load-error' : 'report-load'} role="status">
          {error || '正在整理这次学习证据…'}
        </div>
      </main>
    );
  }

  const attempt = report.attempts.at(-1);
  const originalObservation = report.observations[0];
  const assessmentObservations = report.observations.slice(1);
  const nextChecks = [
    ...(attempt?.limitations ?? []),
    ...report.limitations,
    report.delayed_evidence === 'not_evaluated' ? '隔一段时间后能否保持，尚未评估。' : '',
  ].filter(Boolean);

  return (
    <main className="report-page">
      <header className="report-topbar">
        <Link to={`/learn/${report.session_id}/check`}>← 返回独立检验</Link>
        <span>{username} · 学习证据</span>
      </header>

      <section className="report-heading" aria-labelledby="report-title">
        <span>LEARNING EVIDENCE / NOT A SCORE</span>
        <h1 id="report-title">这次学习留下了什么证据</h1>
        <p>只记录这一次实际发生的作答、帮助和独立检验，不换算掌握百分比，也不推断长期能力。</p>
        {report.attempts.length > 1 ? (
          <small>已保留 {report.attempts.length} 次独立检验记录；下面重点展示最近一次，较早记录没有被覆盖。</small>
        ) : null}
      </section>

      <div className="report-evidence-grid">
        <article className="report-evidence-block report-original" data-status={report.original_status}>
          <header><span>01</span><h2>原题完成与帮助</h2></header>
          <strong>{originalLabels[report.original_status]}</strong>
          {originalObservation ? <MathMarkdown content={originalObservation} /> : null}
          <small>这里评价原题当前作答，不代表已经迁移到新题。</small>
        </article>

        <article className="report-evidence-block" data-status={attempt?.planning ?? 'unanswered'}>
          <header><span>02</span><h2>本次独立规划</h2></header>
          <strong>{attempt ? verdictLabels[attempt.planning] : '尚未检验'}</strong>
          <p>{attempt?.independent_planning ? '独立证据成立' : '未形成独立通过证据'}</p>
          <small>只看提交答案前锁定的首次计划，不用最终答案倒推。</small>
        </article>

        <article className="report-evidence-block" data-status={attempt?.execution ?? 'unanswered'}>
          <header><span>03</span><h2>本次独立执行</h2></header>
          <strong>{attempt ? verdictLabels[attempt.execution] : '尚未检验'}</strong>
          <p>{attempt?.independent_execution ? '独立证据成立' : '未形成独立通过证据'}</p>
          <small>{attempt?.independent_task_pass
            ? '首次计划与最终执行在同一未帮助任务中均有依据。'
            : '整题不记为独立通过；计划和执行继续分开保留。'}</small>
        </article>

        <article className="report-evidence-block report-next">
          <header><span>04</span><h2>还需要验证什么</h2></header>
          <ul>
            {nextChecks.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </article>
      </div>

      {assessmentObservations.length ? (
        <section className="report-observations" aria-labelledby="report-observations-title">
          <span>DIRECT EVIDENCE</span>
          <h2 id="report-observations-title">本次判定依据</h2>
          <ul>
            {assessmentObservations.map((item) => (
              <li key={item}><MathMarkdown content={item} /></li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="report-actions">
        <Link to={`/study?session=${report.session_id}`}>回到原题记录</Link>
        <Link className="primary" to={`/learn/${report.session_id}/check`}>查看独立检验</Link>
      </footer>
    </main>
  );
}
