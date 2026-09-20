import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, apiFetch } from '../../../lib/api';
import { MathMarkdown } from '../../../shared/MathMarkdown';
import {
  getAssessmentNextAction,
  type AssessmentVerdict,
  type OriginalLearningStatus,
} from './assessment-next-action';

type Verdict = AssessmentVerdict;
type OriginalStatus = OriginalLearningStatus;

interface AttemptReport {
  assistance_requested: boolean;
  attempt_id: string;
  execution: Verdict;
  final_answer_markdown?: string | null;
  help_exposed: boolean;
  independent_execution: boolean;
  independent_planning: boolean;
  independent_task_pass: boolean;
  invalidated: boolean;
  limitations: string[];
  locked_plan_markdown?: string | null;
  phase?: string;
  plan_unanswered?: boolean;
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

interface ReportLoadError {
  message: string;
  retryable: boolean;
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

function attemptOutcomeLabel(attempt: AttemptReport) {
  if (attempt.phase && attempt.phase !== 'summary') return '检验进行中';
  if (attempt.invalidated) return '独立资格已失效';
  if (attempt.independent_task_pass) return '新题独立完成';
  if (attempt.relation === 'near_duplicate') return '近重复练习';
  if (attempt.help_exposed) return '使用过帮助';
  if (attempt.assistance_requested) return '请求过帮助';
  if (attempt.planning !== 'correct') return '方法需要修正';
  if (attempt.execution !== 'correct') return '执行需要修正';
  return '证据边界待确认';
}

export function ReportPage({ username }: { username: string }) {
  const { sessionId = '' } = useParams();
  const focusReportAfterLoadRef = useRef(false);
  const recoveryTitleRef = useRef<HTMLHeadingElement>(null);
  const reportTitleRef = useRef<HTMLHeadingElement>(null);
  const retryButtonRef = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState<ReportLoadError | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [report, setReport] = useState<Report | null>(null);
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setReport(null);
    setSelectedAttemptId(null);
    apiFetch<Report>(`/api/reports/sessions/${sessionId}`, { signal: controller.signal })
      .then((result) => {
        if (!active) return;
        setError(null);
        setReport(result);
      })
      .catch((requestError: unknown) => {
        if (!active) return;
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
        const notFound = requestError instanceof ApiError && requestError.status === 404;
        setError({
          message: notFound
            ? '这份学习记录不存在或已过保存期。'
            : '暂时无法读取学习报告，请稍后重试。',
          retryable: !notFound,
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadKey, sessionId]);

  useEffect(() => {
    if (!error) return;
    requestAnimationFrame(() => {
      if (error.retryable) retryButtonRef.current?.focus();
      else recoveryTitleRef.current?.focus();
    });
  }, [error]);

  useEffect(() => {
    if (!report || !focusReportAfterLoadRef.current) return;
    focusReportAfterLoadRef.current = false;
    requestAnimationFrame(() => reportTitleRef.current?.focus());
  }, [report]);

  function retryReport() {
    focusReportAfterLoadRef.current = true;
    setLoading(true);
    setReloadKey((key) => key + 1);
  }

  if (!report) {
    if (error) {
      return (
        <main className="report-page">
          <header className="report-topbar">
            <Link to={`/learn/${sessionId}/check`}>← 返回独立检验</Link>
            <span>{username} · 学习证据</span>
          </header>
          <section className="report-recovery" role="alert" aria-labelledby="report-recovery-title">
            <span>LEARNING EVIDENCE / RECOVERY</span>
            <h1 ref={recoveryTitleRef} id="report-recovery-title" tabIndex={-1}>
              {error.retryable ? '学习报告还没加载出来' : '这份学习记录暂时找不到'}
            </h1>
            <p>{error.message}</p>
            <div>
              {error.retryable ? (
                <button
                  ref={retryButtonRef}
                  type="button"
                  disabled={loading}
                  onClick={retryReport}
                >
                  {loading ? '正在重新读取学习报告' : '重新读取学习报告'}
                </button>
              ) : null}
              <Link to={`/study?session=${sessionId}`}>回到原题记录</Link>
              <Link to={`/learn/${sessionId}/check`}>查看独立检验</Link>
            </div>
            {loading ? <span className="sr-only" role="status">正在重新读取学习报告…</span> : null}
          </section>
        </main>
      );
    }
    return (
      <main className="report-page">
        <div className="report-load" role="status">
          {loading && reloadKey > 0 ? '正在重新读取学习报告…' : '正在整理这次学习证据…'}
        </div>
      </main>
    );
  }

  const latestAttempt = report.attempts.at(-1);
  const attempt = report.attempts.find((item) => item.attempt_id === selectedAttemptId)
    ?? latestAttempt;
  const selectedAttemptIndex = attempt
    ? report.attempts.findIndex((item) => item.attempt_id === attempt.attempt_id)
    : -1;
  const hasAttemptHistory = report.attempts.length > 1;
  const viewingLatestAttempt = attempt?.attempt_id === latestAttempt?.attempt_id;
  const originalObservation = report.observations[0];
  const assessmentObservations = report.observations.slice(1);
  const nextChecks = [
    ...(attempt?.limitations ?? []),
    ...report.limitations,
    report.delayed_evidence === 'not_evaluated' ? '隔一段时间后能否保持，尚未评估。' : '',
  ].filter(Boolean);
  const nextAction = getAssessmentNextAction(
    report.session_id,
    report.original_status,
    latestAttempt
      ? {
          assistanceRequested: latestAttempt.assistance_requested,
          execution: latestAttempt.execution,
          helpExposed: latestAttempt.help_exposed,
          independentTaskPass: latestAttempt.independent_task_pass,
          invalidated: latestAttempt.invalidated,
          phase: latestAttempt.phase,
          planning: latestAttempt.planning,
          relation: latestAttempt.relation,
        }
      : null,
  );
  const primaryAction = nextAction.kind === 'reassess'
    ? { href: '/history', label: '回到学习历史' }
    : { href: nextAction.href, label: nextAction.label };

  return (
    <main className="report-page">
      <header className="report-topbar">
        <Link to={`/learn/${report.session_id}/check`}>← 返回独立检验</Link>
        <span>{username} · 学习证据</span>
      </header>

      <section className="report-heading" aria-labelledby="report-title">
        <span>LEARNING EVIDENCE / NOT A SCORE</span>
        <h1 ref={reportTitleRef} id="report-title" tabIndex={-1}>这次学习留下了什么证据</h1>
        <p>只记录这一次实际发生的作答、帮助和独立检验，不换算掌握百分比，也不推断长期能力。</p>
        {hasAttemptHistory ? (
          <small>已保留 {report.attempts.length} 次独立检验记录；可逐次对照首次计划、最终答案和当次判定。</small>
        ) : null}
      </section>

      <nav
        className="report-next-shortcut"
        data-action={nextAction.kind}
        aria-label="报告下一步快捷入口"
      >
        <div>
          <span>NEXT / 下一步</span>
          <strong>{nextAction.title}</strong>
        </div>
        <Link
          to={primaryAction.href}
          aria-label="快捷继续下一步"
        >
          现在继续 <span aria-hidden="true">→</span>
        </Link>
      </nav>

      {hasAttemptHistory ? (
        <section className="report-attempt-history" aria-labelledby="report-attempt-history-title">
          <header>
            <span>ATTEMPT TRACE / 对照变化</span>
            <div>
              <h2 id="report-attempt-history-title">独立检验记录</h2>
              <p>默认查看最近一次；切换只用于对照，不会改变最新学习结论。</p>
            </div>
          </header>
          <div className="report-attempt-switch" role="group" aria-label="切换独立检验记录">
            {report.attempts.map((item, index) => {
              const selected = item.attempt_id === attempt?.attempt_id;
              const helpLabel = item.help_exposed
                ? '看过帮助'
                : item.assistance_requested ? '请求过帮助' : '未记录帮助';
              return (
                <button
                  type="button"
                  key={item.attempt_id}
                  aria-label={`查看第 ${index + 1} 次独立检验：${attemptOutcomeLabel(item)}`}
                  aria-pressed={selected}
                  data-selected={selected}
                  onClick={() => setSelectedAttemptId(item.attempt_id)}
                >
                  <span>{index === report.attempts.length - 1 ? '最近一次' : `第 ${index + 1} 次`}</span>
                  <strong>{attemptOutcomeLabel(item)}</strong>
                  <small>{item.relation === 'near_transfer' ? '近迁移任务' : '近重复练习'} · {helpLabel}</small>
                </button>
              );
            })}
          </div>
          <p className="report-attempt-current" role="status" aria-live="polite">
            正在查看第 {selectedAttemptIndex + 1} 次独立检验
            {viewingLatestAttempt ? '（最近一次）' : ''}
          </p>
        </section>
      ) : null}

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

      {attempt ? (
        <section
          className="report-frozen-work"
          aria-labelledby="report-frozen-work-title"
        >
          <header>
            <span>STUDENT WORK / FROZEN</span>
            <div>
              <h2 id="report-frozen-work-title">本次冻结的独立作答</h2>
              <p>按提交时的原样保留，先看你当时怎么想，再对照下面的判定依据。</p>
            </div>
          </header>
          <div className="report-frozen-work-grid">
            <article data-empty={!attempt.locked_plan_markdown}>
              <div><span>01</span><h3>首次计划</h3></div>
              {attempt.plan_unanswered ? (
                <p className="report-frozen-empty">本次明确选择了不写首次计划。</p>
              ) : attempt.locked_plan_markdown ? (
                <MathMarkdown content={attempt.locked_plan_markdown} />
              ) : (
                <p className="report-frozen-empty">本次没有留下锁定的首次计划。</p>
              )}
            </article>
            <article data-empty={!attempt.final_answer_markdown}>
              <div><span>02</span><h3>最终答案</h3></div>
              {attempt.final_answer_markdown ? (
                <MathMarkdown content={attempt.final_answer_markdown} />
              ) : (
                <p className="report-frozen-empty">本次还没有提交最终答案。</p>
              )}
            </article>
          </div>
        </section>
      ) : null}

      {assessmentObservations.length ? (
        <section className="report-observations" aria-labelledby="report-observations-title">
          <span>DIRECT EVIDENCE</span>
          <h2 id="report-observations-title">
            {hasAttemptHistory ? '全部检验记录中的判定依据' : '本次判定依据'}
          </h2>
          {hasAttemptHistory ? (
            <p className="report-observations-scope">这里汇总所有已保存检验的依据，不随上方记录切换。</p>
          ) : null}
          <ul>
            {assessmentObservations.map((item) => (
              <li key={item}><MathMarkdown content={item} /></li>
            ))}
          </ul>
        </section>
      ) : null}

      <section
        className="report-next-action"
        data-action={nextAction.kind}
        aria-labelledby="report-next-action-title"
      >
        <span>{nextAction.eyebrow}</span>
        <div>
          <h2 id="report-next-action-title">{nextAction.title}</h2>
          <p>{nextAction.description}</p>
          {hasAttemptHistory ? (
            <p className="report-next-action-basis">下一步始终依据最近一次检验，切换记录只用于对照。</p>
          ) : null}
          <div className="report-actions">
            <Link className="primary" to={primaryAction.href}>{primaryAction.label}</Link>
            {nextAction.kind === 'reassess' ? (
              <Link to={nextAction.href}>{nextAction.label}</Link>
            ) : (
              <Link to="/history">查看学习历史</Link>
            )}
            {!nextAction.href.startsWith('/study') ? (
              <Link to={`/study?session=${report.session_id}`}>查看原题记录</Link>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
