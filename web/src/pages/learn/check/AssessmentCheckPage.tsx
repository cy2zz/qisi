import {
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  HandwritingInput,
  type ConfirmedHandwriting,
  type HandwritingInputHandle,
} from '../../../features/input/HandwritingInput';
import { MathFormatButton } from '../../../features/input/MathFormatButton';
import { VoiceInputButton } from '../../../features/input/VoiceInputButton';
import { ApiError, apiFetch } from '../../../lib/api';
import { MathMarkdown } from '../../../shared/MathMarkdown';
import { MATH_FORMULA_SHORTCUTS } from '../../../shared/math-input';
import {
  type AssessmentDraftPhase,
  clearCachedAssessmentDraft,
  readCachedAssessmentDraft,
  writeCachedAssessmentDraft,
} from './assessment-draft-cache';

type Verdict = 'correct' | 'incorrect' | 'unknown' | 'unanswered';
type DraftSaveState = 'dirty' | 'error' | 'local' | 'recovered' | 'saved' | 'saving';

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
const ORIGINAL_ANSWER_NOT_READY_MESSAGE = '先回到原题完成核对并修正当前答案，再开始独立检验。';
const REASSESSMENT_NOT_READY_MESSAGE = '暂时没有可可靠检验的不同新题。上一份结果已保留，稍后可以再试。';

function isAssessmentDraftPhase(phase: AssessmentAttempt['phase']): phase is AssessmentDraftPhase {
  return phase === 'check_plan' || phase === 'check_answer';
}

function getAssessmentDraftStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function draftMarkdownForAttempt(attempt: AssessmentAttempt, phase = attempt.phase) {
  return phase === 'check_plan' ? attempt.planDraftMarkdown : attempt.answerDraftMarkdown;
}

function getAssessmentSummaryTitle(result: AssessmentResult) {
  if (result.independentTaskPass) return '这次新题独立完成';
  if (result.planning === 'incorrect') return '方法还需要修正';
  if (result.planning === 'unanswered') return '这次还没有留下计划证据';
  if (result.planning === 'unknown') return '计划证据还不足';
  if (result.execution === 'incorrect') return '方法有依据，执行还需要修正';
  if (result.execution === 'unanswered') return '这次还没有留下执行证据';
  if (result.execution === 'unknown') return '执行证据还不足';
  return '答案有依据，但这次不能记为独立通过';
}

export function AssessmentCheckPage({ username }: { username: string }) {
  const { sessionId = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const assessmentEditorRef = useRef<HTMLTextAreaElement>(null);
  const draftRevisionRef = useRef(0);
  const focusEditorAfterTransitionRef = useRef(false);
  const blankAnswerCancelRef = useRef<HTMLButtonElement>(null);
  const blankAnswerDialogRef = useRef<HTMLElement>(null);
  const helpCancelRef = useRef<HTMLButtonElement>(null);
  const helpDialogRef = useRef<HTMLElement>(null);
  const requestRef = useRef(0);
  const saveRequestRef = useRef(0);
  const skipNextCleanUrlLoadRef = useRef(false);
  const [attempt, setAttempt] = useState<AssessmentAttempt | null>(null);
  const [blankAnswerConfirmation, setBlankAnswerConfirmation] = useState(false);
  const [confirmedHandwriting, setConfirmedHandwriting] = useState<ConfirmedHandwriting | null>(null);
  const [draft, setDraft] = useState('');
  const [draftSaveState, setDraftSaveState] = useState<DraftSaveState>('saved');
  const [error, setError] = useState('');
  const [editorFocusRequest, setEditorFocusRequest] = useState(0);
  const [helpConfirmation, setHelpConfirmation] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState('');
  const [reviewingHandwriting, setReviewingHandwriting] = useState(false);
  const [taskCollapsed, setTaskCollapsed] = useState(false);
  const reassessmentIntent = new URLSearchParams(location.search).get('intent') === 'reassess';

  useEffect(() => {
    if (skipNextCleanUrlLoadRef.current && !reassessmentIntent) {
      skipNextCleanUrlLoadRef.current = false;
      return;
    }

    const requestNumber = ++requestRef.current;
    const controller = new AbortController();
    setLoading(true);
    setError('');

    async function restoreAssessment() {
      let restoredAttempt: AssessmentAttempt | null = null;
      try {
        try {
          const result = await apiFetch<AssessmentResponse>(
            `/api/assessment/sessions/${sessionId}`,
            { signal: controller.signal },
          );
          restoredAttempt = result.attempt;
        } catch (requestError) {
          if (!(requestError instanceof ApiError) || requestError.status !== 404) throw requestError;
        }

        if (requestRef.current !== requestNumber) return;
        if (!reassessmentIntent) {
          if (restoredAttempt) applyAttempt(restoredAttempt);
          else setAttempt(null);
          return;
        }

        if (restoredAttempt && restoredAttempt.phase !== 'summary') {
          applyAttempt(restoredAttempt);
          clearReassessmentIntent();
          return;
        }

        try {
          const result = await apiFetch<AssessmentResponse>(
            restoredAttempt
              ? `/api/assessment/sessions/${sessionId}/reassess`
              : `/api/assessment/sessions/${sessionId}/start`,
            { body: '{}', method: 'POST', signal: controller.signal },
          );
          if (requestRef.current !== requestNumber) return;
          focusEditorAfterTransitionRef.current = true;
          applyAttempt(result.attempt);
          clearReassessmentIntent();
        } catch (requestError) {
          if (requestRef.current !== requestNumber) return;
          if (restoredAttempt) {
            applyAttempt(restoredAttempt);
            setError(
              requestError instanceof ApiError && requestError.status === 422
                ? REASSESSMENT_NOT_READY_MESSAGE
                : '暂时无法准备下一道检验题。上一份结果已保留。',
            );
          } else {
            setAttempt(null);
            setError(
              requestError instanceof ApiError && requestError.status === 409
                ? ORIGINAL_ANSWER_NOT_READY_MESSAGE
                : requestError instanceof ApiError && requestError.status === 422
                  ? '这次生成的新题没有通过独立复核，未向你展示。可以重新生成。'
                  : '暂时无法生成可靠的新题，请稍后重试。',
            );
          }
        }
      } catch {
        if (requestRef.current !== requestNumber) return;
        setError('暂时无法读取检验记录，请稍后重试。');
      } finally {
        if (requestRef.current === requestNumber) setLoading(false);
      }
    }

    void restoreAssessment();
    return () => controller.abort();
  }, [location.search, reassessmentIntent, sessionId]);

  useEffect(() => {
    if (attempt?.phase === 'grading' && !pendingAction) void finishCheck();
  }, [attempt?.phase]);

  useEffect(() => {
    if (!helpConfirmation) return;
    helpCancelRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeHelpConfirmation();
        return;
      }
      if (event.key !== 'Tab' || !helpDialogRef.current) return;

      const focusable = Array.from(
        helpDialogRef.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [helpConfirmation]);

  useEffect(() => {
    if (!blankAnswerConfirmation) return;
    blankAnswerCancelRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeBlankAnswerConfirmation();
        return;
      }
      if (event.key !== 'Tab' || !blankAnswerDialogRef.current) return;

      const focusable = Array.from(
        blankAnswerDialogRef.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [blankAnswerConfirmation]);

  useEffect(() => {
    if (
      !attempt
      || draftSaveState !== 'dirty'
      || pendingAction
      || (attempt.phase !== 'check_plan' && attempt.phase !== 'check_answer')
    ) return;

    const timeout = window.setTimeout(() => void saveDraft(false), 800);
    return () => window.clearTimeout(timeout);
  }, [attempt?.id, attempt?.phase, attempt?.version, draft, draftSaveState, pendingAction]);

  useEffect(() => {
    function syncRecoveredDraft() {
      if (
        !attempt
        || !isAssessmentDraftPhase(attempt.phase)
        || pendingAction
        || !['error', 'local', 'recovered'].includes(draftSaveState)
      ) return;
      void saveDraft(false);
    }

    window.addEventListener('online', syncRecoveredDraft);
    return () => window.removeEventListener('online', syncRecoveredDraft);
  }, [attempt?.id, attempt?.phase, attempt?.version, draft, draftSaveState, pendingAction]);

  function applyAttempt(next: AssessmentAttempt) {
    saveRequestRef.current += 1;
    if (
      next.taskId !== attempt?.taskId
      || (next.phase !== 'check_plan' && next.phase !== 'check_answer')
    ) {
      setTaskCollapsed(false);
    }
    const serverDraft = draftMarkdownForAttempt(next);
    let nextDraft = serverDraft;
    let nextSaveState: DraftSaveState = 'saved';
    const storage = getAssessmentDraftStorage();
    if (storage && next.phase !== 'check_plan') {
      clearCachedAssessmentDraft(storage, next.id, 'check_plan');
    }
    if (storage && !isAssessmentDraftPhase(next.phase)) {
      clearCachedAssessmentDraft(storage, next.id, 'check_answer');
    }
    if (isAssessmentDraftPhase(next.phase)) {
      const cachedDraft = storage
        ? readCachedAssessmentDraft(storage, next.id, next.phase)
        : null;
      if (storage && cachedDraft?.markdown === serverDraft) {
        clearCachedAssessmentDraft(storage, next.id, next.phase);
      } else if (cachedDraft) {
        nextDraft = cachedDraft.markdown;
        nextSaveState = 'recovered';
        draftRevisionRef.current += 1;
      }
    }
    setAttempt(next);
    setBlankAnswerConfirmation(false);
    setConfirmedHandwriting(null);
    setDraft(nextDraft);
    setDraftSaveState(nextSaveState);
    setError('');
    if (
      focusEditorAfterTransitionRef.current
      && (next.phase === 'check_plan' || next.phase === 'check_answer')
    ) {
      focusEditorAfterTransitionRef.current = false;
      setEditorFocusRequest((request) => request + 1);
    }
  }

  function clearReassessmentIntent() {
    const search = new URLSearchParams(location.search);
    if (search.get('intent') !== 'reassess') return;
    search.delete('intent');
    skipNextCleanUrlLoadRef.current = true;
    void navigate(
      { pathname: location.pathname, search: search.size ? `?${search.toString()}` : '' },
      { replace: true },
    );
  }

  async function startCheck() {
    focusEditorAfterTransitionRef.current = true;
    setPendingAction('start');
    setError('');
    try {
      const result = await apiFetch<AssessmentResponse>(
        `/api/assessment/sessions/${sessionId}/start`,
        { body: '{}', method: 'POST' },
      );
      applyAttempt(result.attempt);
    } catch (requestError) {
      focusEditorAfterTransitionRef.current = false;
      setError(
        requestError instanceof ApiError && requestError.status === 409
          ? ORIGINAL_ANSWER_NOT_READY_MESSAGE
          : requestError instanceof ApiError && requestError.status === 422
            ? '这次生成的新题没有通过独立复核，未向你展示。可以重新生成。'
            : '暂时无法生成可靠的新题，请稍后重试。',
      );
    } finally {
      setPendingAction('');
    }
  }

  async function saveDraft(manual = true) {
    if (!attempt || !isAssessmentDraftPhase(attempt.phase)) return;
    const currentAttempt = attempt;
    const currentPhase = attempt.phase;
    const currentDraft = draft;
    const currentRevision = draftRevisionRef.current;
    const requestNumber = ++saveRequestRef.current;
    setDraftSaveState('saving');
    if (manual) setError('');
    try {
      const result = await apiFetch<AssessmentResponse>(
        `/api/assessment/attempts/${currentAttempt.id}/draft`,
        {
          body: JSON.stringify({
            expectedVersion: currentAttempt.version,
            kind: currentAttempt.phase === 'check_plan' ? 'plan' : 'answer',
            markdown: currentDraft,
          }),
          method: 'PATCH',
        },
      );
      if (saveRequestRef.current !== requestNumber) return;
      setAttempt(result.attempt);
      if (draftRevisionRef.current === currentRevision) {
        const storage = getAssessmentDraftStorage();
        if (storage) clearCachedAssessmentDraft(storage, currentAttempt.id, currentPhase);
        setDraft(draftMarkdownForAttempt(result.attempt));
        setDraftSaveState('saved');
        setError('');
      } else {
        setDraftSaveState('dirty');
      }
    } catch {
      if (
        saveRequestRef.current !== requestNumber
        || draftRevisionRef.current !== currentRevision
      ) return;
      const storage = getAssessmentDraftStorage();
      const cached = storage
        ? writeCachedAssessmentDraft(
            storage,
            currentAttempt.id,
            currentPhase,
            currentDraft,
          )
        : false;
      setDraftSaveState(cached ? 'local' : 'error');
      setError(cached ? '' : '自动保存失败，当前输入仍保留在页面中；可立即重试。');
    }
  }

  async function submitPlan(noPlan = false) {
    if (!attempt) return;
    focusEditorAfterTransitionRef.current = true;
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
            ...(!noPlan && confirmedHandwriting?.markdown.trim() === draft.trim()
              ? {
                  transcriptId: confirmedHandwriting.transcriptId,
                  transcriptRevision: confirmedHandwriting.revision,
                }
              : {}),
          }),
          method: 'POST',
        },
      );
      const storage = getAssessmentDraftStorage();
      if (storage && isAssessmentDraftPhase(attempt.phase)) {
        clearCachedAssessmentDraft(storage, attempt.id, attempt.phase);
      }
      applyAttempt(result.attempt);
    } catch {
      focusEditorAfterTransitionRef.current = false;
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
          body: JSON.stringify({
            answerMarkdown: draft,
            expectedVersion: attempt.version,
            ...(confirmedHandwriting?.markdown.trim() === draft.trim()
              ? {
                  transcriptId: confirmedHandwriting.transcriptId,
                  transcriptRevision: confirmedHandwriting.revision,
                }
              : {}),
          }),
          method: 'POST',
        },
      );
      const storage = getAssessmentDraftStorage();
      if (storage && isAssessmentDraftPhase(attempt.phase)) {
        clearCachedAssessmentDraft(storage, attempt.id, attempt.phase);
      }
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
      const storage = getAssessmentDraftStorage();
      if (storage && isAssessmentDraftPhase(attempt.phase)) {
        clearCachedAssessmentDraft(storage, attempt.id, attempt.phase);
      }
      applyAttempt(result.attempt);
      setHelpConfirmation(false);
    } catch {
      setError('求助状态尚未保存，本次独立资格没有被页面擅自改变。请重试。');
    } finally {
      setPendingAction('');
    }
  }

  async function startReassessment() {
    focusEditorAfterTransitionRef.current = true;
    setPendingAction('reassess');
    setError('');
    try {
      const result = await apiFetch<AssessmentResponse>(
        `/api/assessment/sessions/${sessionId}/reassess`,
        { body: '{}', method: 'POST' },
      );
      applyAttempt(result.attempt);
      clearReassessmentIntent();
    } catch (requestError) {
      focusEditorAfterTransitionRef.current = false;
      setError(
        requestError instanceof ApiError && requestError.status === 422
          ? REASSESSMENT_NOT_READY_MESSAGE
          : '暂时无法准备下一道检验题。上一份结果已保留。',
      );
    } finally {
      setPendingAction('');
    }
  }

  function updateDraft(value: string) {
    draftRevisionRef.current += 1;
    setBlankAnswerConfirmation(false);
    setConfirmedHandwriting(null);
    setDraft(value);
    const storage = getAssessmentDraftStorage();
    if (storage && attempt && isAssessmentDraftPhase(attempt.phase)) {
      writeCachedAssessmentDraft(storage, attempt.id, attempt.phase, value);
    }
    setDraftSaveState('dirty');
  }

  function applyConfirmedHandwriting(result: ConfirmedHandwriting) {
    draftRevisionRef.current += 1;
    setConfirmedHandwriting(result);
    setDraft(result.markdown);
    const storage = getAssessmentDraftStorage();
    if (storage && attempt && isAssessmentDraftPhase(attempt.phase)) {
      writeCachedAssessmentDraft(storage, attempt.id, attempt.phase, result.markdown);
    }
    setDraftSaveState('dirty');
  }

  function closeHelpConfirmation() {
    setHelpConfirmation(false);
    requestAnimationFrame(() => assessmentEditorRef.current?.focus());
  }

  function closeBlankAnswerConfirmation() {
    setBlankAnswerConfirmation(false);
    requestAnimationFrame(() => assessmentEditorRef.current?.focus());
  }

  function compactTaskForMobileWriting() {
    if (
      typeof window.matchMedia === 'function'
      && window.matchMedia('(max-width: 720px)').matches
    ) {
      setTaskCollapsed(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          assessmentEditorRef.current
            ?.closest<HTMLElement>('.assessment-workbench')
            ?.querySelector<HTMLElement>('.assessment-paper')
            ?.scrollIntoView?.({ behavior: 'auto', block: 'start' });
        });
      });
    }
  }

  if (loading) {
    return (
      <main className="assessment-page">
        <div className="assessment-loading" role="status">
          {reassessmentIntent ? '正在准备一道不同的新题…' : '正在恢复独立检验记录…'}
        </div>
      </main>
    );
  }

  if (!attempt) {
    return (
      <main className="assessment-page">
        <header className="assessment-topbar">
          <Link to={`/study?session=${sessionId}`} aria-label="返回当前学习">← 当前学习</Link>
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
          {error === ORIGINAL_ANSWER_NOT_READY_MESSAGE ? (
            <Link className="assessment-return-original" to={`/study?session=${sessionId}`}>
              返回原题完成核对
            </Link>
          ) : (
            <button type="button" disabled={pendingAction === 'start'} onClick={() => void startCheck()}>
              {pendingAction === 'start' ? '正在生成并复核新题…' : '开始独立检验'}
            </button>
          )}
          <small>本系统只能判断当前账号内是否见过；无法判断你是否在其他渠道看过。</small>
        </section>
      </main>
    );
  }

  const isEditing = attempt.phase === 'check_plan' || attempt.phase === 'check_answer';
  const saveInProgress = draftSaveState === 'saving';
  const saveStatusLabel = draftSaveState === 'saved'
    ? '已自动保存'
    : draftSaveState === 'saving'
      ? '正在自动保存'
      : draftSaveState === 'local'
        ? '已保存在本机，等待网络恢复'
        : draftSaveState === 'recovered'
          ? '已恢复本机草稿，尚未同步'
      : draftSaveState === 'error'
        ? '自动保存失败'
        : '尚未保存';
  const stageIndex = attempt.phase === 'check_plan' ? 0 : attempt.phase === 'summary' ? 2 : 1;

  return (
    <main className="assessment-page">
      <header className="assessment-topbar">
        <Link to={`/study?session=${sessionId}`} aria-label="返回当前学习">← 当前学习</Link>
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
        <section
          className="assessment-paper"
          data-collapsed={taskCollapsed}
          aria-labelledby="assessment-task-title"
        >
          <span>NEW TASK / 未记录先前曝光</span>
          <h1 id="assessment-task-title">独立检验题</h1>
          <button
            type="button"
            className="assessment-paper-toggle"
            aria-controls="assessment-task-content"
            aria-expanded={!taskCollapsed}
            aria-label={taskCollapsed ? '展开完整题目' : '收起题目'}
            onClick={() => setTaskCollapsed((collapsed) => !collapsed)}
          >
            {taskCollapsed ? '展开题目' : '收起题目'}
          </button>
          <div id="assessment-task-content">
            <MathMarkdown
              className={taskCollapsed ? 'assessment-paper-compact' : undefined}
              content={attempt.promptMarkdown}
            />
          </div>
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
              <AssessmentEditor
                confirmedHandwriting={Boolean(confirmedHandwriting)}
                draft={draft}
                disabled={Boolean(pendingAction)}
                editorRef={assessmentEditorRef}
                focusRequest={editorFocusRequest}
                onChange={updateDraft}
                onFormat={updateDraft}
                onHandwritingConfirmed={applyConfirmedHandwriting}
                onHandwritingReviewingChange={setReviewingHandwriting}
                onFocus={compactTaskForMobileWriting}
                placeholder="例如：我准备先……，再根据……判断……"
                sessionId={attempt.sessionId}
              />
              <div className="assessment-actions" data-save-state={draftSaveState}>
                <span className="assessment-save-status" data-state={draftSaveState} role="status" aria-label="草稿保存状态">{saveStatusLabel}</span>
                {draftSaveState === 'saved' ? null : (
                  <button type="button" className="secondary" disabled={Boolean(pendingAction) || saveInProgress || reviewingHandwriting} onClick={() => void saveDraft()}>
                    {saveInProgress
                      ? '保存中…'
                      : ['error', 'local', 'recovered'].includes(draftSaveState)
                        ? '立即同步'
                        : '立即保存'}
                  </button>
                )}
                <button type="button" className="quiet" disabled={Boolean(pendingAction) || saveInProgress || reviewingHandwriting} onClick={() => void submitPlan(true)}>暂时没有计划</button>
                <button type="button" disabled={Boolean(pendingAction) || saveInProgress || reviewingHandwriting || !draft.trim()} onClick={() => void submitPlan(false)}>
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
              <AssessmentEditor
                confirmedHandwriting={Boolean(confirmedHandwriting)}
                draft={draft}
                disabled={Boolean(pendingAction)}
                editorRef={assessmentEditorRef}
                focusRequest={editorFocusRequest}
                onChange={updateDraft}
                onFormat={updateDraft}
                onHandwritingConfirmed={applyConfirmedHandwriting}
                onHandwritingReviewingChange={setReviewingHandwriting}
                onFocus={compactTaskForMobileWriting}
                placeholder="写下计算、证明过程和最终结论…"
                sessionId={attempt.sessionId}
              />
              <div className="assessment-actions" data-save-state={draftSaveState}>
                <span className="assessment-save-status" data-state={draftSaveState} role="status" aria-label="草稿保存状态">{saveStatusLabel}</span>
                {draftSaveState === 'saved' ? null : (
                  <button type="button" className="secondary" disabled={Boolean(pendingAction) || saveInProgress || reviewingHandwriting} onClick={() => void saveDraft()}>
                    {saveInProgress
                      ? '保存中…'
                      : ['error', 'local', 'recovered'].includes(draftSaveState)
                        ? '立即同步'
                        : '立即保存'}
                  </button>
                )}
                <button
                  type="button"
                  className="quiet"
                  disabled={Boolean(pendingAction) || saveInProgress || reviewingHandwriting}
                  onClick={() => {
                    setHelpConfirmation(false);
                    setBlankAnswerConfirmation(true);
                  }}
                >
                  暂时不作答
                </button>
                <button type="button" disabled={Boolean(pendingAction) || saveInProgress || reviewingHandwriting || !draft.trim()} onClick={() => void finishCheck()}>
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

          {isEditing && !blankAnswerConfirmation ? (
            <aside className="assessment-help-boundary">
              <div><strong>真的卡住了？</strong><span>可以求助，但会结束本次独立资格。</span></div>
              <button
                type="button"
                disabled={Boolean(pendingAction) || saveInProgress || reviewingHandwriting}
                onClick={() => {
                  setBlankAnswerConfirmation(false);
                  setHelpConfirmation(true);
                }}
              >
                我需要帮助
              </button>
            </aside>
          ) : null}
          {helpConfirmation ? (
            <section
              ref={helpDialogRef}
              className="assessment-help-confirm"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="assessment-help-title"
              aria-describedby="assessment-help-description"
            >
              <h2 id="assessment-help-title">结束本次独立检验并求助？</h2>
              <p id="assessment-help-description">当前输入会先保存；之后即使答案正确，也只记为“带帮助完成”。</p>
              <div>
                <button ref={helpCancelRef} type="button" className="secondary" onClick={closeHelpConfirmation}>继续独立完成</button>
                <button type="button" disabled={pendingAction === 'help'} onClick={() => void requestHelp()}>
                  {pendingAction === 'help' ? '正在保存状态…' : '确认求助'}
                </button>
              </div>
            </section>
          ) : null}
          {blankAnswerConfirmation ? (
            <section
              ref={blankAnswerDialogRef}
              className="assessment-help-confirm assessment-final-confirm"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="assessment-final-title"
              aria-describedby="assessment-final-description"
            >
              <h2 id="assessment-final-title">以空白答案结束本次检验？</h2>
              <p id="assessment-final-description">
                提交后答案会冻结，系统会记录“未作答”；如果只是暂时没写完，请继续独立完成。
              </p>
              <div>
                <button
                  ref={blankAnswerCancelRef}
                  type="button"
                  className="secondary"
                  onClick={closeBlankAnswerConfirmation}
                >
                  继续作答
                </button>
                <button
                  type="button"
                  disabled={pendingAction === 'finish'}
                  onClick={() => void finishCheck()}
                >
                  {pendingAction === 'finish' ? '正在冻结…' : '确认未作答并结束'}
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
  confirmedHandwriting,
  disabled,
  draft,
  editorRef,
  focusRequest,
  onChange,
  onFormat,
  onHandwritingConfirmed,
  onHandwritingReviewingChange,
  onFocus,
  placeholder,
  sessionId,
}: {
  confirmedHandwriting: boolean;
  disabled: boolean;
  draft: string;
  editorRef: RefObject<HTMLTextAreaElement | null>;
  focusRequest: number;
  onChange: (value: string) => void;
  onFormat: (value: string) => void;
  onHandwritingConfirmed: (result: ConfirmedHandwriting) => void;
  onHandwritingReviewingChange: (reviewing: boolean) => void;
  onFocus: () => void;
  placeholder: string;
  sessionId: string;
}) {
  const handwritingRef = useRef<HandwritingInputHandle>(null);
  const handledFocusRequestRef = useRef(0);
  const liveDraftRef = useRef(draft);
  const pendingCaretRef = useRef<number | null>(null);
  const voiceDraftRangeRef = useRef<{ end: number; start: number } | null>(null);
  liveDraftRef.current = draft;

  useEffect(() => {
    voiceDraftRangeRef.current = null;
  }, [focusRequest, sessionId]);

  useLayoutEffect(() => {
    if (
      disabled
      || focusRequest === 0
      || handledFocusRequestRef.current === focusRequest
    ) return;
    handledFocusRequestRef.current = focusRequest;
    editorRef.current?.focus();
  }, [disabled, focusRequest]);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    const position = pendingCaretRef.current;
    if (!editor || position === null) return;
    pendingCaretRef.current = null;
    editor.focus();
    editor.setSelectionRange(position, position);
  }, [draft]);

  function placeCaret(position: number) {
    pendingCaretRef.current = position;
  }

  function insertFormulaTemplate(syntax: string) {
    voiceDraftRangeRef.current = null;
    const editor = editorRef.current;
    const selectionStart = editor?.selectionStart ?? draft.length;
    const selectionEnd = editor?.selectionEnd ?? selectionStart;
    const before = draft.slice(0, selectionStart);
    const spacer = before && !/\s$/.test(before) ? ' ' : '';
    const insertion = `${spacer}${syntax}`;
    onChange(`${before}${insertion}${draft.slice(selectionEnd)}`);
    const firstSlot = syntax.indexOf('{}');
    placeCaret(selectionStart + spacer.length + (firstSlot >= 0 ? firstSlot + 1 : syntax.length));
  }

  function updateVoiceDraft(text: string) {
    const editor = editorRef.current;
    const currentDraft = liveDraftRef.current;
    const currentRange = voiceDraftRangeRef.current;
    const selectionStart = currentRange?.start ?? editor?.selectionStart ?? currentDraft.length;
    const selectionEnd = currentRange?.end ?? editor?.selectionEnd ?? selectionStart;
    const before = currentDraft.slice(0, selectionStart);
    const spacer = currentRange === null && before && !/\s$/.test(before) ? ' ' : '';
    const insertion = `${spacer}${text}`;
    const nextDraft = `${before}${insertion}${currentDraft.slice(selectionEnd)}`;
    const range = {
      start: selectionStart + spacer.length,
      end: selectionStart + insertion.length,
    };
    voiceDraftRangeRef.current = range;
    liveDraftRef.current = nextDraft;
    onChange(nextDraft);
    placeCaret(range.end);
  }

  function commitVoiceDraft(text: string) {
    updateVoiceDraft(text);
    voiceDraftRangeRef.current = null;
  }

  function moveToNextFormulaSlot() {
    const editor = editorRef.current;
    if (!editor) return false;
    const caretOffset = editor.selectionStart;
    const formulaStart = draft.lastIndexOf('$', Math.max(0, caretOffset - 1));
    const formulaEnd = draft.indexOf('$', caretOffset);
    if (formulaStart < 0 || formulaEnd < 0 || formulaEnd <= formulaStart) return false;

    const nextSlot = draft.indexOf('{}', caretOffset);
    const nextPosition = nextSlot >= 0 && nextSlot < formulaEnd ? nextSlot + 1 : formulaEnd + 1;
    editor.focus();
    editor.setSelectionRange(nextPosition, nextPosition);
    return true;
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Tab' && !event.shiftKey && moveToNextFormulaSlot()) {
      event.preventDefault();
    }
  }

  function handlePaste(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    const image = Array.from(event.clipboardData.files).find((file) => file.type.startsWith('image/'));
    if (!image) return;
    event.preventDefault();
    handwritingRef.current?.selectFile(image);
  }

  return (
    <div className="assessment-editor">
      <HandwritingInput
        ref={handwritingRef}
        disabled={disabled}
        onConfirmed={(result) => {
          voiceDraftRangeRef.current = null;
          onHandwritingConfirmed(result);
          requestAnimationFrame(() => editorRef.current?.focus());
        }}
        onReviewingChange={onHandwritingReviewingChange}
        sessionId={sessionId}
      />
      <textarea
        ref={editorRef}
        aria-label="独立检验作答"
        disabled={disabled}
        placeholder={placeholder}
        value={draft}
        onChange={(event) => {
          voiceDraftRangeRef.current = null;
          onChange(event.target.value);
        }}
        onFocus={onFocus}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
      />
      <div className="assessment-editor-tools" role="toolbar" aria-label="公式快捷输入">
        {MATH_FORMULA_SHORTCUTS.map((shortcut) => (
          <button
            type="button"
            key={shortcut.name}
            aria-label={shortcut.name}
            title={shortcut.name}
            disabled={disabled}
            onClick={() => insertFormulaTemplate(shortcut.syntax)}
          >
            {shortcut.label}
          </button>
        ))}
      </div>
      <div className="assessment-editor-footer">
        <span>填完一格，按 <kbd>Tab</kbd> 或点“下一格”</span>
        <div>
          <button
            type="button"
            className="assessment-handwriting-trigger"
            aria-label="添加手写作答"
            disabled={disabled}
            onClick={() => handwritingRef.current?.openFilePicker()}
          >
            手写
          </button>
          <button
            type="button"
            className="assessment-formula-next"
            aria-label="移动到下一个公式输入格"
            disabled={disabled || !draft.includes('$')}
            onClick={moveToNextFormulaSlot}
          >
            下一格 <span aria-hidden="true">→</span>
          </button>
          <VoiceInputButton
            disabled={disabled}
            onInterimTranscript={updateVoiceDraft}
            onTranscript={commitVoiceDraft}
          />
          <MathFormatButton
            disabled={disabled}
            text={draft}
            onFormatted={(markdown) => {
              voiceDraftRangeRef.current = null;
              placeCaret(markdown.length);
              onFormat(markdown);
            }}
          />
        </div>
      </div>
      {draft.includes('$') ? (
        <div className="assessment-preview" aria-label="公式预览">
          <span>预览</span><MathMarkdown content={draft} />
        </div>
      ) : null}
      {confirmedHandwriting ? (
        <p className="assessment-handwriting-confirmed" role="status">
          手写转写已确认；继续编辑后将按普通文字提交。
        </p>
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
  const summaryTitle = getAssessmentSummaryTitle(result);
  const remediation = result.independentTaskPass
    ? null
    : result.planning !== 'correct'
      ? {
          action: '回学习页梳理方法',
          detail: '先把方法想清楚，再决定是否换题',
          focus: 'method',
          label: 'METHOD / 先修方法',
          title: '下一步先补上方法依据',
        }
      : result.execution !== 'correct'
        ? {
            action: '回学习页处理执行卡点',
            detail: '先修正执行，再决定是否换题',
            focus: 'execution',
            label: 'EXECUTION / 先修执行',
            title: '方法已经成立，下一步只处理执行卡点',
          }
        : {
            action: '回学习页查看证据边界',
            detail: '先看清为什么这次还不能记为独立通过',
            focus: 'evidence',
            label: 'EVIDENCE / 先看边界',
            title: '答案有依据，但独立证据还不完整',
          };
  return (
    <section className="assessment-summary" aria-labelledby="assessment-summary-title">
      <span>CHECKED / FIRST ATTEMPT</span>
      <h2 id="assessment-summary-title">{summaryTitle}</h2>
      <p>{result.summary}</p>
      <dl>
        <div data-verdict={result.planning}><dt>首次计划</dt><dd>{verdictLabels[result.planning]}</dd><small>{result.independentPlanning ? '独立证据成立' : '未形成独立通过证据'}</small></div>
        <div data-verdict={result.execution}><dt>最终执行</dt><dd>{verdictLabels[result.execution]}</dd><small>{result.independentExecution ? '独立证据成立' : '未形成独立通过证据'}</small></div>
      </dl>
      <section className="assessment-work-evidence" aria-labelledby="assessment-work-evidence-title">
        <header>
          <span>YOUR WORK / 已冻结</span>
          <h3 id="assessment-work-evidence-title">你的独立作答证据</h3>
          <p>回看计划与执行是否对应；这里展示的是你的提交，不是参考答案。</p>
        </header>
        <div className="assessment-work-evidence-grid">
          <article data-verdict={result.planning}>
            <div><span aria-hidden="true">01</span><strong>首次计划</strong></div>
            {attempt.planUnanswered || !attempt.lockedPlanMarkdown ? (
              <p>本次没有提交计划。</p>
            ) : (
              <MathMarkdown content={attempt.lockedPlanMarkdown} />
            )}
            <small>提交后即锁定，最终答案不会反向改写这份计划。</small>
          </article>
          <article data-verdict={result.execution}>
            <div><span aria-hidden="true">02</span><strong>最终执行</strong></div>
            {attempt.finalAnswerMarkdown ? (
              <MathMarkdown content={attempt.finalAnswerMarkdown} />
            ) : (
              <p>本次没有提交最终答案。</p>
            )}
            <small>这是冻结后统一核对的最终版本。</small>
          </article>
        </div>
      </section>
      {result.evidence.length ? (
        <section className="assessment-check-evidence" aria-labelledby="assessment-check-evidence-title">
          <h3 id="assessment-check-evidence-title">本次核对依据</h3>
          <ul>{result.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
      ) : null}
      <aside><strong>结论边界</strong>{result.limitations.map((item) => <p key={item}>{item}</p>)}</aside>
      {remediation ? (
        <section className="assessment-next-step" aria-labelledby="assessment-next-step-title">
          <span>{remediation.label}</span>
          <div>
            <h3 id="assessment-next-step-title">{remediation.title}</h3>
            <p>{remediation.detail}</p>
          </div>
        </section>
      ) : null}
      <div
        className="assessment-summary-actions"
        data-outcome={remediation ? 'remediate' : 'passed'}
      >
        {remediation ? (
          <Link
            className="assessment-remediation-primary"
            to={`/study?session=${rootSessionId}&remediate=${remediation.focus}`}
          >
            {remediation.action}
          </Link>
        ) : (
          <button type="button" disabled={pending} onClick={onReassess}>
            {pending ? '正在寻找并复核不同新题…' : '再测一道不同的新题'}
          </button>
        )}
        <Link className="secondary" to={`/learn/${rootSessionId}/report`}>查看完整学习报告</Link>
        {remediation ? (
          <button
            className="assessment-reassess-secondary"
            type="button"
            disabled={pending}
            onClick={onReassess}
          >
            {pending ? '正在复核新题…' : '换题再测'}
          </button>
        ) : (
          <Link className="secondary" to={`/study?session=${rootSessionId}`}>返回学习页</Link>
        )}
      </div>
    </section>
  );
}
