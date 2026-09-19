import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MathFormatButton } from '../../../features/input/MathFormatButton';
import { ApiError, apiFetch } from '../../../lib/api';
import { MathMarkdown } from '../../../shared/MathMarkdown';

type Verdict = 'correct' | 'incorrect' | 'unknown' | 'unanswered';

interface AssessmentResult {
  evidence: string[];
  execution: Verdict;
  independentExecution: boolean;
  independentPlanning: boolean;
  independentTaskPass: boolean;
  limitations: string[];
  planning: Verdict;
  summary: string;
}

interface AssessmentAttempt {
  answerDraftMarkdown: string;
  assistanceRequested: boolean;
  finalAnswerMarkdown: string | null;
  firstSeenEligible: boolean;
  helpExposed: boolean;
  helpSessionId: string | null;
  id: string;
  lockedPlanMarkdown: string | null;
  phase: 'check_answer' | 'check_plan' | 'grading' | 'help_requested' | 'summary';
  planDraftMarkdown: string;
  planUnanswered: boolean;
  promptMarkdown: string;
  relation: 'near_duplicate' | 'near_transfer';
  result: AssessmentResult | null;
  sessionId: string;
  taskId: string;
  version: number;
}

interface AssessmentResponse {
  attempt: AssessmentAttempt;
}

const verdictLabels: Record<Verdict, string> = {
  correct: '有依据',
  incorrect: '需要修正',
  unknown: '证据不足',
  unanswered: '未作答',
};

const formulaShortcuts = [
  { label: '分式', syntax: '$\\frac{}{}$' },
  { label: '根式', syntax: '$\\sqrt{}$' },
  { label: '平方', syntax: '$x^2$' },
  { label: '绝对值', syntax: '$\\left|{}\\right|$' },
];

export function AssessmentCheckPage({ username }: { username: string }) {
  const { sessionId = '' } = useParams();
  const requestRef = useRef(0);
  const [attempt, setAttempt] = useState<AssessmentAttempt | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [helpConfirmation, setHelpConfirmation] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState('');
  const [saved, setSaved] = useState(true);

  useEffect(() => {
    const requestNumber = ++requestRef.current;
    const controller = new AbortController();
    setLoading(true);
    apiFetch<AssessmentResponse>(`/api/assessment/sessions/${sessionId}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (requestRef.current !== requestNumber) return;
        applyAttempt(result.attempt);
      })
      .catch((requestError: unknown) => {
        if (requestRef.current !== requestNumber) return;
        if (requestError instanceof ApiError && requestError.status === 404) {
          setAttempt(null);
          return;
        }
        setError('暂时无法读取检验记录，请稍后重试。');
      })
      .finally(() => {
        if (requestRef.current === requestNumber) setLoading(false);
      });
    return () => controller.abort();
  }, [sessionId]);

  useEffect(() => {
    if (attempt?.phase === 'grading' && !pendingAction) void finishCheck();
  }, [attempt?.phase]);

  function applyAttempt(next: AssessmentAttempt) {
    setAttempt(next);
    setDraft(next.phase === 'check_plan' ? next.planDraftMarkdown : next.answerDraftMarkdown);
    setSaved(true);
    setError('');
  }

  async function startCheck() {
    setPendingAction('start');
    setError('');
    try {
      const result = await apiFetch<AssessmentResponse>(
        `/api/assessment/sessions/${sessionId}/start`,
        { body: '{}', method: 'POST' },
      );
      applyAttempt(result.attempt);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError && requestError.status === 422
          ? '这次生成的新题没有通过独立复核，未向你展示。可以重新生成。'
          : '暂时无法生成可靠的新题，请稍后重试。',
      );
    } finally {
      setPendingAction('');
    }
  }

  async function saveDraft() {
    if (!attempt || (attempt.phase !== 'check_plan' && attempt.phase !== 'check_answer')) return;
    setPendingAction('save');
    setError('');
    try {
      const result = await apiFetch<AssessmentResponse>(
        `/api/assessment/attempts/${attempt.id}/draft`,
        {
          body: JSON.stringify({
            expectedVersion: attempt.version,
            kind: attempt.phase === 'check_plan' ? 'plan' : 'answer',
            markdown: draft,
          }),
          method: 'PATCH',
        },
      );
      applyAttempt(result.attempt);
    } catch {
      setError('草稿尚未保存，请重试；当前输入仍保留在页面中。');
    } finally {
      setPendingAction('');
    }
  }

  async function submitPlan(noPlan = false) {
    if (!attempt) return;
    setPendingAction('plan');
    setError('');
    try {
      const result = await apiFetch<AssessmentResponse>(
        `/api/assessment/attempts/${attempt.id}/plan`,
        {
          body: JSON.stringify({
            expectedVersion: attempt.version,
            noPlan,
            planMarkdown: noPlan ? '' : draft,
          }),
          method: 'POST',
        },
      );
      applyAttempt(result.attempt);
    } catch {
      setError('计划没有锁定，请检查内容或刷新后重试。');
    } finally {
      setPendingAction('');
    }
  }

  async function finishCheck() {
    if (!attempt) return;
    setPendingAction('finish');
    setError('');
    try {
      const result = await apiFetch<AssessmentResponse>(
        `/api/assessment/attempts/${attempt.id}/finish`,
        {
          body: JSON.stringify({ answerMarkdown: draft, expectedVersion: attempt.version }),
          method: 'POST',
        },
      );
      applyAttempt(result.attempt);
    } catch {
      setError('最终答案尚未提交，请稍后重试。你的输入仍保留在页面中。');
    } finally {
      setPendingAction('');
    }
  }

  async function requestHelp() {
    if (!attempt) return;
    setPendingAction('help');
    setError('');
    try {
      const result = await apiFetch<AssessmentResponse>(
        `/api/assessment/attempts/${attempt.id}/help`,
        {
          body: JSON.stringify({ currentMarkdown: draft, expectedVersion: attempt.version }),
          method: 'POST',
        },
      );
      applyAttempt(result.attempt);
      setHelpConfirmation(false);
    } catch {
      setError('求助状态尚未保存，本次独立资格没有被页面擅自改变。请重试。');
    } finally {
      setPendingAction('');
    }
  }

  async function startReassessment() {
    setPendingAction('reassess');
    setError('');
    try {
      const result = await apiFetch<AssessmentResponse>(
        `/api/assessment/sessions/${sessionId}/reassess`,
        { body: '{}', method: 'POST' },
      );
      applyAttempt(result.attempt);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError && requestError.status === 422
          ? '暂时没有可可靠检验的不同新题。上一份结果已保留，稍后可以再试。'
          : '暂时无法准备下一道检验题。上一份结果已保留。',
      );
    } finally {
      setPendingAction('');
    }
  }

  function updateDraft(value: string) {
    setDraft(value);
    setSaved(false);
  }

  function insertFormula(syntax: string) {
    updateDraft(`${draft}${draft && !draft.endsWith('\n') ? ' ' : ''}${syntax}`);
  }

  if (loading) {
    return (
      <main className="assessment-page">
        <div className="assessment-loading" role="status">正在恢复独立检验记录…</div>
      </main>
    );
  }

  if (!attempt) {
    return (
      <main className="assessment-page">
        <header className="assessment-topbar">
          <Link to="/study" aria-label="返回当前学习">← 当前学习</Link>
          <span>{username} · 独立检验</span>
        </header>
        <section className="assessment-intro" aria-labelledby="assessment-intro-title">
          <span>CHECK / NEW TASK</span>
          <h1 id="assessment-intro-title">换一道题，看看能否独立完成</h1>
          <p>系统会生成一道同核心知识、不同表征的新题，并先做一次独立复核。没有通过复核的题不会展示。</p>
          <ol>
            <li><strong>1</strong><span>先写计划</span><small>只记录准备怎么做</small></li>
            <li><strong>2</strong><span>再完成答案</span><small>中途不提示对错</small></li>
            <li><strong>3</strong><span>最后统一核对</span><small>计划和执行分别判断</small></li>
          </ol>
          {error ? <p className="assessment-error" role="alert">{error}</p> : null}
          <button type="button" disabled={pendingAction === 'start'} onClick={() => void startCheck()}>
            {pendingAction === 'start' ? '正在生成并复核新题…' : '开始独立检验'}
          </button>
          <small>本系统只能判断当前账号内是否见过；无法判断你是否在其他渠道看过。</small>
        </section>
      </main>
    );
  }

  const isEditing = attempt.phase === 'check_plan' || attempt.phase === 'check_answer';
  const stageIndex = attempt.phase === 'check_plan' ? 0 : attempt.phase === 'summary' ? 2 : 1;

  return (
    <main className="assessment-page">
      <header className="assessment-topbar">
        <Link to="/study" aria-label="返回当前学习">← 当前学习</Link>
        <div><strong>独立检验</strong><span>新任务 · 首次作答</span></div>
        <span>{username}</span>
      </header>

      <section className="assessment-stage" aria-label="独立检验阶段">
        {['先写计划', '独立完成', '统一核对'].map((label, index) => (
          <div key={label} data-state={index < stageIndex ? 'done' : index === stageIndex ? 'current' : 'next'}>
            <span>{index < stageIndex ? '✓' : index + 1}</span>{label}
          </div>
        ))}
      </section>

      <div className="assessment-workbench">
        <section className="assessment-paper" aria-labelledby="assessment-task-title">
          <span>NEW TASK / 未记录先前曝光</span>
          <h1 id="assessment-task-title">独立检验题</h1>
          <MathMarkdown content={attempt.promptMarkdown} />
          <footer>
            <span>{attempt.relation === 'near_transfer' ? '近迁移任务' : '近重复练习'}</span>
            <span>题目已通过模型独立复核 · 未人工审题</span>
          </footer>
        </section>

        <section className="assessment-response" aria-label="独立作答区">
          {attempt.phase === 'check_plan' ? (
            <>
              <div className="assessment-prompt">
                <span>STEP 1 / PLAN</span>
                <h2>先写你准备怎么做</h2>
                <p>写方法、关键判断或第一步即可；这里不要求算出答案。</p>
              </div>
              <AssessmentEditor draft={draft} disabled={Boolean(pendingAction)} onChange={updateDraft} onFormat={updateDraft} onInsertFormula={insertFormula} placeholder="例如：我准备先……，再根据……判断……" />
              <div className="assessment-actions">
                <button type="button" className="secondary" disabled={Boolean(pendingAction) || saved} onClick={() => void saveDraft()}>
                  {pendingAction === 'save' ? '保存中…' : saved ? '草稿已保存' : '保存草稿'}
                </button>
                <button type="button" className="quiet" disabled={Boolean(pendingAction)} onClick={() => void submitPlan(true)}>暂时没有计划</button>
                <button type="button" disabled={Boolean(pendingAction) || !draft.trim()} onClick={() => void submitPlan(false)}>
                  {pendingAction === 'plan' ? '正在锁定…' : '锁定计划，开始作答'}
                </button>
              </div>
            </>
          ) : attempt.phase === 'check_answer' ? (
            <>
              <div className="assessment-locked-plan" role="note" aria-label="已锁定的首次计划">
                <span>FIRST PLAN / 已锁定</span>
                <strong>{attempt.planUnanswered ? '暂时没有计划' : '你的首次计划'}</strong>
                {attempt.planUnanswered ? null : <MathMarkdown content={attempt.lockedPlanMarkdown ?? ''} />}
              </div>
              <div className="assessment-prompt">
                <span>STEP 2 / ANSWER</span>
                <h2>现在独立完成答案</h2>
                <p>提交前不会显示对错，也不会根据你的过程给暗示。</p>
              </div>
              <AssessmentEditor draft={draft} disabled={Boolean(pendingAction)} onChange={updateDraft} onFormat={updateDraft} onInsertFormula={insertFormula} placeholder="写下计算、证明过程和最终结论…" />
              <div className="assessment-actions">
                <button type="button" className="secondary" disabled={Boolean(pendingAction) || saved} onClick={() => void saveDraft()}>
                  {pendingAction === 'save' ? '保存中…' : saved ? '草稿已保存' : '保存草稿'}
                </button>
                <button type="button" disabled={Boolean(pendingAction)} onClick={() => void finishCheck()}>
                  {pendingAction === 'finish' ? '正在冻结并核对…' : '提交最终答案'}
                </button>
              </div>
            </>
          ) : attempt.phase === 'grading' ? (
            <div className="assessment-grading" role="status">
              <span aria-hidden="true" />
              <h2>最终答案已冻结</h2>
              <p>正在分别核对首次计划和最终执行，不会再修改你的提交。</p>
              <button type="button" disabled={pendingAction === 'finish'} onClick={() => void finishCheck()}>
                {pendingAction === 'finish' ? '正在继续核对…' : '重新连接并继续核对'}
              </button>
            </div>
          ) : attempt.phase === 'help_requested' ? (
            <div className="assessment-helped" role="status">
              <span>INDEPENDENCE ENDED</span>
              <h2>当前草稿已保留</h2>
              <p>你已请求帮助，因此这次不再计为独立检验。实际帮助尚未发出；进入后可自己选择帮助深度。</p>
              <Link to={attempt.helpSessionId ? `/study?session=${attempt.helpSessionId}` : '/study'}>
                {attempt.helpSessionId ? '进入同题教学' : '返回学习页继续处理卡点'}
              </Link>
            </div>
          ) : (
            <AssessmentSummary
              attempt={attempt}
              pending={pendingAction === 'reassess'}
              rootSessionId={sessionId}
              onReassess={() => void startReassessment()}
            />
          )}

          {isEditing ? (
            <aside className="assessment-help-boundary">
              <div><strong>真的卡住了？</strong><span>可以求助，但会结束本次独立资格。</span></div>
              <button type="button" disabled={Boolean(pendingAction)} onClick={() => setHelpConfirmation(true)}>我需要帮助</button>
            </aside>
          ) : null}
          {helpConfirmation ? (
            <section className="assessment-help-confirm" role="alertdialog" aria-labelledby="assessment-help-title">
              <h2 id="assessment-help-title">结束本次独立检验并求助？</h2>
              <p>当前输入会先保存；之后即使答案正确，也只记为“带帮助完成”。</p>
              <div>
                <button type="button" className="secondary" onClick={() => setHelpConfirmation(false)}>继续独立完成</button>
                <button type="button" disabled={pendingAction === 'help'} onClick={() => void requestHelp()}>
                  {pendingAction === 'help' ? '正在保存状态…' : '确认求助'}
                </button>
              </div>
            </section>
          ) : null}
          {error ? <p className="assessment-error" role="alert">{error}</p> : null}
        </section>
      </div>
    </main>
  );
}

function AssessmentEditor({
  disabled,
  draft,
  onChange,
  onFormat,
  onInsertFormula,
  placeholder,
}: {
  disabled: boolean;
  draft: string;
  onChange: (value: string) => void;
  onFormat: (value: string) => void;
  onInsertFormula: (syntax: string) => void;
  placeholder: string;
}) {
  return (
    <div className="assessment-editor">
      <textarea
        aria-label="独立检验作答"
        disabled={disabled}
        placeholder={placeholder}
        value={draft}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="assessment-editor-tools" role="toolbar" aria-label="公式快捷输入">
        {formulaShortcuts.map((shortcut) => (
          <button type="button" key={shortcut.label} disabled={disabled} onClick={() => onInsertFormula(shortcut.syntax)}>{shortcut.label}</button>
        ))}
        <MathFormatButton disabled={disabled} text={draft} onFormatted={onFormat} />
      </div>
      {draft.includes('$') ? (
        <div className="assessment-preview" aria-label="公式预览">
          <span>预览</span><MathMarkdown content={draft} />
        </div>
      ) : null}
    </div>
  );
}

function AssessmentSummary({
  attempt,
  onReassess,
  pending,
  rootSessionId,
}: {
  attempt: AssessmentAttempt;
  onReassess: () => void;
  pending: boolean;
  rootSessionId: string;
}) {
  const result = attempt.result;
  if (!result) return <p className="assessment-error">评分记录不完整，暂不下结论。</p>;
  return (
    <section className="assessment-summary" aria-labelledby="assessment-summary-title">
      <span>CHECKED / FIRST ATTEMPT</span>
      <h2 id="assessment-summary-title">
        {result.independentTaskPass ? '这次新题独立完成' : '这次证据还没有同时覆盖计划与执行'}
      </h2>
      <p>{result.summary}</p>
      <dl>
        <div data-verdict={result.planning}><dt>首次计划</dt><dd>{verdictLabels[result.planning]}</dd><small>{result.independentPlanning ? '独立证据成立' : '未形成独立通过证据'}</small></div>
        <div data-verdict={result.execution}><dt>最终执行</dt><dd>{verdictLabels[result.execution]}</dd><small>{result.independentExecution ? '独立证据成立' : '未形成独立通过证据'}</small></div>
      </dl>
      {result.evidence.length ? <ul>{result.evidence.map((item) => <li key={item}>{item}</li>)}</ul> : null}
      <aside><strong>结论边界</strong>{result.limitations.map((item) => <p key={item}>{item}</p>)}</aside>
      <div className="assessment-summary-actions">
        <button type="button" disabled={pending} onClick={onReassess}>
          {pending ? '正在寻找并复核不同新题…' : '再测一道不同的新题'}
        </button>
        <Link to={`/learn/${rootSessionId}/report`}>查看完整学习报告</Link>
        <Link className="secondary" to="/study">返回学习页</Link>
      </div>
    </section>
  );
}
