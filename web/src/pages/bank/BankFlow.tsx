import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { MathFormatButton } from '../../features/input/MathFormatButton';
import {
  HandwritingInput,
  type ConfirmedHandwriting,
  type HandwritingInputHandle,
} from '../../features/input/HandwritingInput';
import {
  ImageQuestionInput,
  type ImageQuestionInputHandle,
} from '../../features/input/ImageQuestionInput';
import { VoiceInputButton } from '../../features/input/VoiceInputButton';
import { ReadAloudButton, ReadAloudProvider } from '../../features/speech/ReadAloud';
import { apiFetch, apiStream } from '../../lib/api';
import { MathMarkdown } from '../../shared/MathMarkdown';
import { MATH_FORMULA_SHORTCUTS } from '../../shared/math-input';
import {
  PaperPickerDialog,
  type PaperSelection,
} from './PaperPickerDialog';
import { RichComposer, type RichComposerHandle } from './RichComposer';
import { StudySidebar, type StudyRecord } from './StudySidebar';
import {
  fixtureSessionId,
  getFixtureProblem,
  problemIdFromFixtureSession,
} from './fixture-bank';
import {
  clearCachedLearningDraft,
  readCachedLearningDraft,
  writeCachedLearningDraft,
} from './learning-draft-cache';

interface StudentPageProps {
  username: string;
}

interface ConversationMessage {
  assistanceMode?: AssistanceMode;
  analysis?: ProblemAnalysis;
  content: string;
  currentVerdict?: 'correct' | 'incorrect' | 'unknown';
  history?: ProblemChatMessage[];
  handwriting?: Pick<ConfirmedHandwriting, 'revision' | 'transcriptId'>;
  id: string;
  preparationStatus?: 'needs_review' | 'ready' | 'unavailable';
  request?: string;
  requestId?: string;
  recognitionUncertain?: string[];
  remediationFocus?: RemediationFocus;
  role: 'guide' | 'student';
  routeAttribution?: 'student' | 'coauthored';
  state?: 'analysis' | 'error' | 'loading' | 'reply' | 'reply-loading' | 'text';
}

interface ActiveStudentWork {
  content: string;
  lineCount: number;
}

interface StudentWorkSegment {
  content: string;
  lineNumber: number;
}

interface ProblemChatMessage {
  content: string;
  role: 'guide' | 'student';
}

interface ProblemAnalysis {
  firstQuestion: string;
  keyConditions: string[];
  knowledgePoints: string[];
  overview: string;
  target: string;
}

type AssistanceMode = 'attempt' | 'hint' | 'explain' | 'worked_solution' | 'finish_problem';
type RemediationFocus = 'evidence' | 'execution' | 'method';

const assistanceModeLabels: Record<AssistanceMode, string> = {
  attempt: '思路反馈',
  hint: '最小提示',
  explain: '局部解释',
  worked_solution: '直接讲解',
  finish_problem: '本题核对',
};

const remediationFocusDetails: Record<RemediationFocus, {
  action: string;
  activeLabel: string;
  detail: string;
  label: string;
  prompt: string;
  title: string;
}> = {
  evidence: {
    action: '询问证据边界',
    activeLabel: '只核对证据边界',
    detail: '核对帮助记录和独立资格，不把答案正确直接等同于已经掌握。',
    label: 'EVIDENCE / 证据边界',
    prompt: '请解释这次为什么还不能记为独立通过。',
    title: '先看清这次为什么不能记为独立通过',
  },
  execution: {
    action: '写下执行卡点',
    activeLabel: '只处理执行卡点',
    detail: '对照刚才的步骤，只找计算、变形或表达中需要修正的一行。',
    label: 'EXECUTION / 执行修正',
    prompt: '我的方法是对的，但执行中有一步需要修正。我卡在：',
    title: '方法已经成立，只定位执行卡点',
  },
  method: {
    action: '写下方法卡点',
    activeLabel: '只梳理方法依据',
    detail: '回到原题，只梳理准备怎么做；暂时不急着重算整题。',
    label: 'METHOD / 方法修正',
    prompt: '我想先把方法想清楚。我的原计划是：',
    title: '先把方法依据补完整',
  },
};

function isRemediationFocus(value: unknown): value is RemediationFocus {
  return value === 'method' || value === 'execution' || value === 'evidence';
}

function isRouteAttribution(value: unknown): value is 'student' | 'coauthored' {
  return value === 'student' || value === 'coauthored';
}

function countStudentWorkLines(content: string) {
  return content.split(/\r?\n/).filter((line) => line.trim()).length;
}

function splitStudentWorkSegments(content: string): StudentWorkSegment[] {
  const lines = content.split(/\r?\n/);
  const segments: StudentWorkSegment[] = [];
  let blockEnd: string | null = null;
  let blockLines: string[] = [];
  let blockStartLine = 0;

  function commitBlock() {
    const block = blockLines.join('\n').trim();
    if (block) segments.push({ content: block, lineNumber: blockStartLine });
    blockEnd = null;
    blockLines = [];
    blockStartLine = 0;
  }

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const lineNumber = index + 1;
    if (blockEnd) {
      blockLines.push(line);
      if (trimmed.endsWith(blockEnd)) commitBlock();
      return;
    }
    if (!trimmed) return;

    const blockBoundary = trimmed.startsWith('$$')
      ? '$$'
      : trimmed.startsWith('\\[')
        ? '\\]'
        : trimmed.startsWith('```')
          ? '```'
          : trimmed.startsWith('~~~')
            ? '~~~'
            : null;
    const closesOnSameLine = blockBoundary
      ? trimmed.length > blockBoundary.length && trimmed.endsWith(blockBoundary)
      : false;

    if (blockBoundary && !closesOnSameLine) {
      blockEnd = blockBoundary;
      blockLines = [line];
      blockStartLine = lineNumber;
      return;
    }
    segments.push({ content: line, lineNumber });
  });

  if (blockLines.length) commitBlock();
  return segments;
}

function getRemediationFocus(search: string): RemediationFocus | null {
  const focus = new URLSearchParams(search).get('remediate');
  return isRemediationFocus(focus) ? focus : null;
}

type SessionRecord = StudyRecord;
type DraftSaveState = 'dirty' | 'error' | 'local' | 'recovered' | 'saved' | 'saving';

function getDraftStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function shouldUseCompactQuestionContext() {
  return typeof window !== 'undefined' && window.innerWidth <= 720;
}

const quickReplies: ReadonlyArray<{
  intent: string;
  label: string;
  message: string | null;
  mode: AssistanceMode;
}> = [
  { intent: 'try', label: '我来写', message: null, mode: 'attempt' },
  { intent: 'unsure', label: '我还不确定', message: '我还不确定', mode: 'hint' },
  { intent: 'hint', label: '提示一点', message: '请只指出下一步要关注什么，不要替我计算或给出答案。', mode: 'hint' },
  { intent: 'explain', label: '讲清这一步', message: '请直接讲清楚这一步', mode: 'explain' },
] as const;

const learningStages = [
  { label: '读懂题目', title: '先读懂题目', detail: '确认条件、目标和题目真正问什么。' },
  { label: '自己尝试', title: '先做一步', detail: '不用写完整答案，先留下一个判断或关键式子。' },
  { label: '定位卡点', title: '只处理当前卡点', detail: '根据你刚才的产物，选择最小必要帮助。' },
  { label: '核对结论', title: '核对这次答案', detail: '只核对本题作答；是否掌握还要看之后的独立检验。' },
] as const;

const learningHelpActions: ReadonlyArray<{
  compactLabel: string;
  label: string;
  message: string;
  mode: AssistanceMode;
}> = [
  { compactLabel: '不会开始', label: '我不知道从哪开始', message: '我不知道从哪开始。请只帮我确认第一步要做什么。', mode: 'hint' },
  { compactLabel: '提示一点', label: '给一点提示', message: '请只给我一个最小提示，不要直接给答案。', mode: 'hint' },
  { compactLabel: '解释卡点', label: '解释当前卡点', message: '请解释我当前最可能卡住的这个地方。', mode: 'explain' },
  { compactLabel: '直接讲解', label: '直接讲清楚', message: '请直接讲清楚当前关键步骤。', mode: 'worked_solution' },
] as const;

const stuckPointOptions = [
  { label: '条件没看懂', prompt: '我卡在题目条件：我还没看懂这些条件之间的关系。' },
  { label: '方法想不到', prompt: '我卡在方法选择：我不知道应该先用哪个知识点。' },
  { label: '公式不会列', prompt: '我卡在列式：思路大概知道，但不知道公式怎么写。' },
  { label: '计算卡住', prompt: '我卡在计算：方法已经确定，但这一步算不下去。' },
  { label: '答案不确定', prompt: '我卡在核对：已经算完，但不确定哪一步可能有问题。' },
] as const;

type JourneyStep = 'choose' | 'prepare' | 'learn';

const journeySteps: Array<{ id: JourneyStep; number: string; label: string }> = [
  { id: 'choose', number: '01', label: '选择题目' },
  { id: 'prepare', number: '02', label: '准备题目' },
  { id: 'learn', number: '03', label: '开始学习' },
];

function StudyHeader({ username }: StudentPageProps) {
  return (
    <header className="study-header">
      <Link className="wordmark" to="/bank" aria-label="启思 AI 题库">
        <span className="wordmark-mark" aria-hidden="true">
          Q
        </span>
        <span>启思 AI</span>
      </Link>
      <div className="student-identity" aria-label={`当前用户：${username}`}>
        <span aria-hidden="true">STUDENT</span>
        <strong>{username}</strong>
      </div>
    </header>
  );
}

function JourneyRail({ current }: { current: JourneyStep }) {
  return (
    <nav className="journey-rail" aria-label="学习流程">
      <ol>
        {journeySteps.map((step) => {
          const currentIndex = journeySteps.findIndex((item) => item.id === current);
          const stepIndex = journeySteps.findIndex((item) => item.id === step.id);
          const state = stepIndex < currentIndex ? 'done' : step.id === current ? 'current' : 'next';

          return (
            <li key={step.id} data-state={state} aria-current={step.id === current ? 'step' : undefined}>
              <span>{state === 'done' ? '✓' : step.number}</span>
              <strong>{step.label}</strong>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StudyFrame({
  children,
  current,
  username,
}: StudentPageProps & { children: ReactNode; current: JourneyStep }) {
  return (
    <main className="study-page">
      <div className="study-shell">
        <StudyHeader username={username} />
        <div className="study-body">
          <JourneyRail current={current} />
          <div className="study-content">{children}</div>
        </div>
      </div>
    </main>
  );
}

export function BankPage({ username }: StudentPageProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const requestedSessionId = new URLSearchParams(location.search).get('session');
  const remediationFocus = getRemediationFocus(location.search);
  const remediation = remediationFocus ? remediationFocusDetails[remediationFocus] : null;
  const activeReplyMessageIdRef = useRef<string | null>(null);
  const analysisRequestRef = useRef(0);
  const chatAbortRef = useRef<AbortController | null>(null);
  const chatRequestRef = useRef(0);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const composerDockRef = useRef<HTMLDivElement>(null);
  const composerFormRef = useRef<HTMLFormElement>(null);
  const composerRef = useRef<RichComposerHandle>(null);
  const draftRevisionRef = useRef(0);
  const draftSaveRequestRef = useRef(0);
  const formulaToolsRef = useRef<HTMLDivElement>(null);
  const formulaTriggerRef = useRef<HTMLButtonElement>(null);
  const highImpactHelpConfirmRef = useRef<HTMLButtonElement>(null);
  const highImpactHelpDialogRef = useRef<HTMLElement>(null);
  const handwritingInputRef = useRef<HandwritingInputHandle>(null);
  const imageInputRef = useRef<ImageQuestionInputHandle>(null);
  const restoreRequestRef = useRef(0);
  const studentWorkCloseRef = useRef<HTMLButtonElement>(null);
  const studentWorkDialogRef = useRef<HTMLDivElement>(null);
  const studentWorkTriggerRef = useRef<HTMLButtonElement | null>(null);
  const suppressNextDraftChangeRef = useRef(false);
  const [activeRecord, setActiveRecord] = useState<SessionRecord | null>(null);
  const [bankOpen, setBankOpen] = useState(false);
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [hasProblem, setHasProblem] = useState(false);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [records, setRecords] = useState<SessionRecord[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [questionCollapsed, setQuestionCollapsed] = useState(false);
  const [questionFocusMode, setQuestionFocusMode] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirmedHandwriting, setConfirmedHandwriting] = useState<ConfirmedHandwriting | null>(null);
  const [draftSaveState, setDraftSaveState] = useState<DraftSaveState>('saved');
  const [isReplying, setIsReplying] = useState(false);
  const [finishIntent, setFinishIntent] = useState(false);
  const [stuckPointOpen, setStuckPointOpen] = useState(false);
  const [pendingHelpAction, setPendingHelpAction] = useState<(typeof learningHelpActions)[number] | null>(null);
  const [pendingRemediationFocus, setPendingRemediationFocus] = useState<RemediationFocus | null>(null);
  const [remediationTrackError, setRemediationTrackError] = useState<string | null>(null);
  const [replyToRevealId, setReplyToRevealId] = useState<string | null>(null);
  const [reviewedStudentWork, setReviewedStudentWork] = useState<ActiveStudentWork | null>(null);

  function closeStudentWorkReader() {
    setReviewedStudentWork(null);
    requestAnimationFrame(() => studentWorkTriggerRef.current?.focus());
  }

  function quoteStudentWorkSegment(segment: StudentWorkSegment) {
    const quotedContent = segment.content.replace(/\s*\n\s*/g, ' ').trim();
    const prefix = draft.trim() ? '\n\n' : '';
    setReviewedStudentWork(null);
    requestAnimationFrame(() => {
      composerRef.current?.insertText(
        `${prefix}我想核对第 ${segment.lineNumber} 行：“${quotedContent}”\n我的疑问：`,
      );
    });
  }

  useEffect(() => {
    const abortController = new AbortController();
    apiFetch<{ sessions?: SessionRecord[] }>('/api/learning/sessions', {
      signal: abortController.signal,
    })
      .then((result) => {
        if (!Array.isArray(result.sessions)) return;
        setRecords(result.sessions);
        const targetSessionId = requestedSessionId ?? result.sessions[0]?.id;
        if (targetSessionId) void restoreSession(targetSessionId);
      })
      .catch(() => undefined);

    return () => abortController.abort();
  }, [requestedSessionId]);

  useEffect(() => {
    if (!activeRecord?.version || draftSaveState !== 'dirty') return;
    const timeout = window.setTimeout(() => {
      void persistDraft(activeRecord.id, draft, draftRevisionRef.current);
    }, 800);
    return () => window.clearTimeout(timeout);
  }, [activeRecord?.id, activeRecord?.version, draft, draftSaveState]);

  useEffect(() => {
    function syncRecoveredDraft() {
      if (
        !activeRecord?.version
        || !['error', 'local', 'recovered'].includes(draftSaveState)
      ) return;
      void persistDraft(activeRecord.id, draft, draftRevisionRef.current);
    }

    window.addEventListener('online', syncRecoveredDraft);
    return () => window.removeEventListener('online', syncRecoveredDraft);
  }, [activeRecord?.id, activeRecord?.version, draft, draftSaveState]);

  useLayoutEffect(() => {
    const scrollArea = chatScrollRef.current;
    if (!scrollArea) return;

    if (!replyToRevealId) {
      scrollArea.scrollTop = scrollArea.scrollHeight;
      return;
    }

    const reply = document.getElementById(replyToRevealId);
    if (reply) {
      const scrollAreaTop = scrollArea.getBoundingClientRect().top;
      const replyTop = reply.getBoundingClientRect().top;
      scrollArea.scrollTop = Math.max(
        0,
        scrollArea.scrollTop + replyTop - scrollAreaTop - 12,
      );
    }
    if (!isReplying) composerRef.current?.focus({ preventScroll: true });
  }, [isReplying, messages, replyToRevealId]);

  useEffect(() => {
    if (pendingHelpAction) {
      requestAnimationFrame(() => highImpactHelpConfirmRef.current?.focus());
    }
  }, [pendingHelpAction]);

  useEffect(() => {
    if (!pendingHelpAction) return;

    const cancelHelpDisclosure = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setPendingHelpAction(null);
        requestAnimationFrame(() => composerRef.current?.focus());
        return;
      }
      if (event.key !== 'Tab' || !highImpactHelpDialogRef.current) return;

      const actions = Array.from(
        highImpactHelpDialogRef.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
      );
      const first = actions[0];
      const last = actions.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', cancelHelpDisclosure);
    return () => window.removeEventListener('keydown', cancelHelpDisclosure);
  }, [pendingHelpAction]);

  useEffect(() => {
    if (!questionFocusMode) return;
    const leaveQuestionFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setQuestionFocusMode(false);
      requestAnimationFrame(() => composerRef.current?.focus());
    };
    window.addEventListener('keydown', leaveQuestionFocus);
    return () => window.removeEventListener('keydown', leaveQuestionFocus);
  }, [questionFocusMode]);

  useEffect(() => {
    if (!reviewedStudentWork) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusFrame = requestAnimationFrame(() => studentWorkCloseRef.current?.focus());

    function handleStudentWorkReaderKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeStudentWorkReader();
        return;
      }
      if (event.key !== 'Tab' || !studentWorkDialogRef.current) return;

      const actions = Array.from(
        studentWorkDialogRef.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
      );
      const first = actions[0];
      const last = actions.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', handleStudentWorkReaderKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleStudentWorkReaderKeyDown);
    };
  }, [reviewedStudentWork]);

  function rememberRecord(record: SessionRecord) {
    setRecords((current) => [record, ...current.filter((item) => item.id !== record.id)]);
  }

  async function restoreSession(sessionId: string) {
    const requestNumber = ++restoreRequestRef.current;
    const draftRevision = draftRevisionRef.current;
    try {
      const detail = await apiFetch<{
        analysis: ProblemAnalysis;
        draftMarkdown?: string;
        remediationFocus?: unknown;
        messages: Array<{
          assistanceMode?: AssistanceMode;
          content: string;
          id: string;
          metadata?: {
            currentVerdict?: 'correct' | 'incorrect' | 'unknown';
            remediationFocus?: unknown;
            routeAttribution?: unknown;
          };
          messageType: string;
          role: 'guide' | 'student';
        }>;
        record: SessionRecord;
      }>(`/api/learning/sessions/${sessionId}`);
      if (restoreRequestRef.current !== requestNumber) return;

      const restoredMessages: ConversationMessage[] = detail.messages.map((message) =>
        message.messageType === 'analysis'
          ? {
              analysis: detail.analysis,
              content: message.content,
              id: `analysis-${detail.record.id}`,
              preparationStatus: detail.record.preparationStatus,
              recognitionUncertain: detail.record.recognitionUncertain,
              role: 'guide',
              state: 'analysis',
            }
          : {
              assistanceMode: message.assistanceMode,
              content: message.content,
              currentVerdict: message.metadata?.currentVerdict,
              id: `persisted-${message.id}`,
              remediationFocus: isRemediationFocus(message.metadata?.remediationFocus)
                ? message.metadata.remediationFocus
                : undefined,
              role: message.role,
              routeAttribution: isRouteAttribution(message.metadata?.routeAttribution)
                ? message.metadata.routeAttribution
                : undefined,
              state: 'reply',
            },
      );
      const latestRestoredMessage = restoredMessages.at(-1);
      const restoredMultistepWorkId = latestRestoredMessage?.role === 'student'
        && countStudentWorkLines(latestRestoredMessage.content) > 1
        ? latestRestoredMessage.id
        : null;
      setActiveRecord(detail.record);
      setReplyToRevealId(restoredMultistepWorkId);
      setMessages(restoredMessages);
      rememberRecord(detail.record);
      setHasProblem(true);
      handwritingInputRef.current?.clear();
      imageInputRef.current?.clear();
      setFormulaOpen(false);
      setFinishIntent(false);
      setStuckPointOpen(false);
      setPendingHelpAction(null);
      setPendingRemediationFocus(
        isRemediationFocus(detail.remediationFocus) ? detail.remediationFocus : null,
      );
      setRemediationTrackError(null);
      setQuestionCollapsed(shouldUseCompactQuestionContext());
      setQuestionFocusMode(false);
      setSidebarOpen(false);
      requestAnimationFrame(() => {
        if (draftRevisionRef.current === draftRevision) {
          const serverDraft = detail.draftMarkdown ?? '';
          const storage = getDraftStorage();
          const localDraft = storage
            ? readCachedLearningDraft(storage, detail.record.id)
            : null;
          if (storage && localDraft?.markdown === serverDraft) {
            clearCachedLearningDraft(storage, detail.record.id);
          }
          replaceComposerDraft(localDraft?.markdown ?? serverDraft, !remediation);
          if (localDraft && localDraft.markdown !== serverDraft) {
            setDraftSaveState('recovered');
          }
        }
        if (!remediation) composerRef.current?.focus();
      });
    } catch {
      if (restoreRequestRef.current === requestNumber) {
        setRecords((current) => current.filter((record) => record.id !== sessionId));
      }
    }
  }

  async function analyzeProblem(record: SessionRecord, requestNumber: number) {
    const analysisMessageId = `analysis-${record.id}`;

    try {
      const result = await apiFetch<{
        analysis: ProblemAnalysis;
        preparation?: { cached: boolean; status: 'needs_review' | 'ready' | 'unavailable' };
        problemMd?: string;
        recognitionUncertain?: string[];
        session?: { id: string; title: string; version: number };
      }>('/api/problems/analyze', {
        body: JSON.stringify({
          content: record.content,
          problemMd: record.problemMd ?? record.content,
          ...(record.questionId ? { questionId: record.questionId } : {}),
          ...(record.questionId ? { title: record.title } : {}),
          topic: record.topic,
        }),
        method: 'POST',
      });
      if (analysisRequestRef.current !== requestNumber) return;

      const analyzedRecord = {
        ...record,
        ...(result.session
          ? {
              id: result.session.id,
              title: result.session.title,
              version: result.session.version,
            }
          : {}),
        ...(result.problemMd ? { problemMd: result.problemMd } : {}),
        ...(result.preparation ? { preparationStatus: result.preparation.status } : {}),
        ...(result.recognitionUncertain
          ? { recognitionUncertain: result.recognitionUncertain }
          : {}),
      };
      setActiveRecord((current) => (current?.id === record.id ? analyzedRecord : current));
      setRecords((current) =>
        current.map((item) => (item.id === record.id ? analyzedRecord : item)),
      );

      setMessages((current) =>
        current.map((message) =>
          message.id === analysisMessageId
            ? {
                analysis: result.analysis,
                content: result.analysis.overview,
                id: analysisMessageId,
                preparationStatus: result.preparation?.status,
                recognitionUncertain: result.recognitionUncertain,
                role: 'guide',
                state: 'analysis',
              }
            : message,
        ),
      );
      if (shouldUseCompactQuestionContext()) setQuestionCollapsed(true);
    } catch {
      if (analysisRequestRef.current !== requestNumber) return;

      setMessages((current) =>
        current.map((message) =>
          message.id === analysisMessageId
            ? {
                content: '暂时无法分析这道题。题目仍保留在当前对话中，可以稍后重试。',
                id: analysisMessageId,
                role: 'guide',
                state: 'error',
              }
            : message,
          ),
      );
    } finally {
      if (analysisRequestRef.current === requestNumber) {
        requestAnimationFrame(() => composerRef.current?.focus());
      }
    }
  }

  function requestAnalysis(record: SessionRecord) {
    const requestNumber = ++analysisRequestRef.current;
    const analysisMessageId = `analysis-${record.id}`;
    setMessages((current) =>
      current.map((message) =>
        message.id === analysisMessageId
          ? {
              content: '正在分析题目…',
              id: analysisMessageId,
              role: 'guide',
              state: 'loading',
            }
          : message,
      ),
    );
    void analyzeProblem(record, requestNumber);
  }

  function beginConversation(record: SessionRecord) {
    restoreRequestRef.current += 1;
    chatAbortRef.current?.abort();
    chatRequestRef.current += 1;
    setReplyToRevealId(null);
    setIsReplying(false);
    const requestNumber = ++analysisRequestRef.current;
    setMessages([
      { content: record.content, id: `student-${record.id}`, role: 'student' },
      {
        content: '正在分析题目…',
        id: `analysis-${record.id}`,
        role: 'guide',
        state: 'loading',
      },
    ]);
    setActiveRecord(record);
    rememberRecord(record);
    setHasProblem(true);
    clearComposerWithoutSaving();
    handwritingInputRef.current?.clear();
    imageInputRef.current?.clear();
    setBankOpen(false);
    setFormulaOpen(false);
    setFinishIntent(false);
    setStuckPointOpen(false);
    setPendingHelpAction(null);
    setPendingRemediationFocus(null);
    setRemediationTrackError(null);
    setQuestionCollapsed(false);
    setQuestionFocusMode(false);
    setSidebarOpen(false);
    void analyzeProblem(record, requestNumber);
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  function chooseBankQuestion({ paper, question }: PaperSelection) {
    const label = question.number === null ? '未编号题目' : `第 ${question.number} 题`;
    const content = question.statementMarkdown
      ?? (question.questionImageUrl
        ? `![${paper.title}${label}](${question.questionImageUrl})`
        : `${paper.title}${label}`);
    beginConversation({
      content,
      id: `paper-${paper.id}-question-${question.id}`,
      ...(question.statementMarkdown ? { problemMd: question.statementMarkdown } : {}),
      questionId: question.id,
      title: `${paper.title} · ${label}`,
      topic: [paper.examYear, paper.region, paper.track].filter(Boolean).join(' · '),
    });
  }

  function openLocalBank() {
    setBankOpen(true);
    setFormulaOpen(false);
    setStuckPointOpen(false);
    setSidebarOpen(false);
  }

  function startNewProblem() {
    restoreRequestRef.current += 1;
    chatAbortRef.current?.abort();
    chatRequestRef.current += 1;
    analysisRequestRef.current += 1;
    setReplyToRevealId(null);
    setActiveRecord(null);
    setMessages([]);
    setHasProblem(false);
    clearComposerWithoutSaving();
    handwritingInputRef.current?.clear();
    imageInputRef.current?.clear();
    setBankOpen(false);
    setFormulaOpen(false);
    setFinishIntent(false);
    setStuckPointOpen(false);
    setPendingHelpAction(null);
    setPendingRemediationFocus(null);
    setRemediationTrackError(null);
    setQuestionCollapsed(false);
    setQuestionFocusMode(false);
    setSidebarOpen(false);
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  function visibleChatHistory(): ProblemChatMessage[] {
    return messages
      .filter(
        (message) =>
          (message.role === 'student' && !message.id.startsWith('student-')) ||
          (message.role === 'guide' && message.state === 'reply'),
      )
      .slice(-16)
      .map(({ content, role }) => ({ content, role }));
  }

  async function requestReply(
    guideMessageId: string,
    studentMessage: string,
    history: ProblemChatMessage[],
    assistanceMode: AssistanceMode,
    requestId: string,
    handwriting?: Pick<ConfirmedHandwriting, 'revision' | 'transcriptId'>,
    remediationFocus?: RemediationFocus,
  ) {
    if (!activeRecord) return;

    let checkedReply = '';

    chatAbortRef.current?.abort();
    const abortController = new AbortController();
    chatAbortRef.current = abortController;
    const requestNumber = ++chatRequestRef.current;
    activeReplyMessageIdRef.current = guideMessageId;
    setReplyToRevealId(null);
    setIsReplying(true);
    setMessages((current) =>
      current.map((message) =>
        message.id === guideMessageId
          ? { ...message, content: '正在核对你的这一步', state: 'reply-loading' }
          : message,
      ),
    );

    try {
      let committedVersion: number | undefined;
      await apiStream(
        '/api/problems/chat',
        {
          assistanceMode,
          ...(activeRecord.version
            ? {
                expectedVersion: activeRecord.version,
                requestId,
                sessionId: activeRecord.id,
              }
            : {}),
          history,
          message: studentMessage,
          problemMd: activeRecord.problemMd ?? activeRecord.content,
          ...(remediationFocus ? { remediationFocus } : {}),
          ...(handwriting
            ? {
                transcriptId: handwriting.transcriptId,
                transcriptRevision: handwriting.revision,
              }
            : {}),
        },
        (event) => {
          if (chatRequestRef.current !== requestNumber) return;
          if (event.type === 'chunk') checkedReply += event.text;
          if (event.type === 'done') setReplyToRevealId(guideMessageId);
          setMessages((current) =>
            current.map((message) => {
              if (message.id !== guideMessageId) return message;
              if (event.type === 'status') {
                return { ...message, content: event.message, state: 'reply-loading' };
              }
              if (event.type === 'chunk') {
                return message;
              }
              if (event.type === 'done') {
                committedVersion = event.version;
                if (
                  remediationFocus
                  && assistanceMode === 'finish_problem'
                  && event.currentVerdict === 'correct'
                ) {
                  setPendingRemediationFocus(null);
                  setRemediationTrackError(null);
                }
                return {
                  ...message,
                  content: checkedReply,
                  ...(event.currentVerdict ? { currentVerdict: event.currentVerdict } : {}),
                  ...(event.routeAttribution ? { routeAttribution: event.routeAttribution } : {}),
                  state: 'reply',
                };
              }
              return { ...message, content: event.message, state: 'error' };
            }),
          );
        },
        abortController.signal,
      );
      if (typeof committedVersion === 'number') {
        setActiveRecord((current) =>
          current ? { ...current, version: committedVersion } : current,
        );
        setRecords((current) =>
          current.map((record) =>
            record.id === activeRecord.id ? { ...record, version: committedVersion } : record,
          ),
        );
      }
    } catch {
      if (abortController.signal.aborted || chatRequestRef.current !== requestNumber) return;
      setReplyToRevealId(guideMessageId);
      setMessages((current) =>
        current.map((message) =>
          message.id === guideMessageId
            ? {
                ...message,
                content: '暂时无法回应这一步。你的内容已经保留，可以重试。',
                state: 'error',
              }
            : message,
        ),
      );
    } finally {
      if (chatRequestRef.current === requestNumber) {
        activeReplyMessageIdRef.current = null;
        chatAbortRef.current = null;
        setReplyToRevealId(guideMessageId);
        setIsReplying(false);
      }
    }
  }

  function stopCurrentReply(guideMessageId: string) {
    if (!isReplying || activeReplyMessageIdRef.current !== guideMessageId) return;

    chatRequestRef.current += 1;
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    activeReplyMessageIdRef.current = null;
    setIsReplying(false);
    setReplyToRevealId(guideMessageId);
    setMessages((current) =>
      current.map((message) =>
        message.id === guideMessageId
          ? {
              ...message,
              content: '已停止本轮回复。你的作答已保留，可以重新回答。',
              state: 'error',
            }
          : message,
      ),
    );
    requestAnimationFrame(() => composerRef.current?.focus({ preventScroll: true }));
  }

  function submitContent(
    rawContent: string,
    assistanceMode: AssistanceMode = 'attempt',
    handwriting: ConfirmedHandwriting | null = null,
  ) {
    const content = rawContent.trim();
    if (!content || isReplying) return;
    const handwritingBinding = handwriting?.markdown.trim() === content
      ? {
          revision: handwriting.revision,
          transcriptId: handwriting.transcriptId,
        }
      : undefined;

    if (!hasProblem) {
      const recordId = `custom-${Date.now()}`;
      beginConversation({
        content,
        id: recordId,
        title: content.replace(/[$\\{}]/g, '').slice(0, 26),
        topic: '手动输入',
      });
      return;
    }

    const messageId = `message-${Date.now()}`;
    const guideMessageId = `guide-${messageId}`;
    const requestId = crypto.randomUUID();
    const history = visibleChatHistory();
    const remediationFocus = pendingRemediationFocus ?? undefined;
    setMessages((current) => [
      ...current,
      { content, id: messageId, role: 'student' },
      {
        content: '正在核对你的这一步',
        assistanceMode,
        history,
        handwriting: handwritingBinding,
        id: guideMessageId,
        request: content,
        requestId,
        remediationFocus,
        role: 'guide',
        state: 'reply-loading',
      },
    ]);
    clearComposerWithoutSaving(true);
    setFormulaOpen(false);
    setStuckPointOpen(false);
    if (assistanceMode === 'finish_problem') setFinishIntent(false);
    void requestReply(
      guideMessageId,
      content,
      history,
      assistanceMode,
      requestId,
      handwritingBinding,
      remediationFocus,
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitContent(
      draft,
      finishIntent ? 'finish_problem' : 'attempt',
      confirmedHandwriting,
    );
  }

  function updateDraft(markdown: string) {
    setDraft(markdown);
    if (suppressNextDraftChangeRef.current) {
      suppressNextDraftChangeRef.current = false;
      setDraftSaveState('saved');
      return;
    }
    setConfirmedHandwriting(null);
    draftRevisionRef.current += 1;
    const storage = getDraftStorage();
    if (storage && activeRecord?.id) {
      writeCachedLearningDraft(storage, activeRecord.id, markdown);
    }
    setDraftSaveState('dirty');
  }

  function clearComposerWithoutSaving(clearLocalDraft = false) {
    if (clearLocalDraft) {
      const storage = getDraftStorage();
      if (storage && activeRecord?.id) clearCachedLearningDraft(storage, activeRecord.id);
    }
    setConfirmedHandwriting(null);
    suppressNextDraftChangeRef.current = true;
    composerRef.current?.clear();
  }

  function replaceComposerDraft(markdown: string, focus = true) {
    setConfirmedHandwriting(null);
    suppressNextDraftChangeRef.current = true;
    composerRef.current?.replaceText(markdown, { focus });
  }

  async function persistDraft(sessionId: string, markdown: string, revision: number) {
    const requestNumber = ++draftSaveRequestRef.current;
    setDraftSaveState('saving');
    try {
      await apiFetch<{ savedAt: string }>(`/api/learning/sessions/${sessionId}/draft`, {
        body: JSON.stringify({ markdown }),
        method: 'PATCH',
      });
      if (
        draftSaveRequestRef.current === requestNumber
        && draftRevisionRef.current === revision
      ) {
        const storage = getDraftStorage();
        if (storage) clearCachedLearningDraft(storage, sessionId);
        setDraftSaveState('saved');
      }
    } catch {
      if (
        draftSaveRequestRef.current === requestNumber
        && draftRevisionRef.current === revision
      ) {
        const storage = getDraftStorage();
        const cached = storage
          ? writeCachedLearningDraft(storage, sessionId, markdown)
          : false;
        setDraftSaveState(cached ? 'local' : 'error');
      }
    }
  }

  function insertFormula(syntax: string) {
    composerRef.current?.insertFormulaTemplate(syntax);
  }

  function insertStuckPoint(prompt: string) {
    setFinishIntent(false);
    composerRef.current?.insertText(`${draft.trim() ? '\n' : ''}${prompt}`);
    setStuckPointOpen(false);
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  function startFinishCheck() {
    setStuckPointOpen(false);
    if (draft.trim()) {
      submitContent(draft, 'finish_problem', confirmedHandwriting);
      return;
    }
    setFinishIntent(true);
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  function clearRemediationHandoff() {
    const searchParams = new URLSearchParams(location.search);
    searchParams.delete('remediate');
    const search = searchParams.toString();
    void navigate(
      { pathname: location.pathname, search: search ? `?${search}` : '' },
      { replace: true },
    );
  }

  async function persistRemediationTrack(focus: RemediationFocus | null) {
    if (!activeRecord) return false;
    setRemediationTrackError(null);
    try {
      await apiFetch<{ remediationFocus: RemediationFocus | null }>(
        `/api/learning/sessions/${activeRecord.id}/remediation`,
        {
          body: JSON.stringify({ focus }),
          method: 'PATCH',
        },
      );
      return true;
    } catch {
      setRemediationTrackError(
        focus ? '修正轨道暂未保存；发送成功后会再次保存。' : '暂时无法退出修正轨道，请重试。',
      );
      return false;
    }
  }

  async function exitRemediationTrack() {
    if (await persistRemediationTrack(null)) {
      setPendingRemediationFocus(null);
      requestAnimationFrame(() => composerRef.current?.focus());
    }
  }

  function insertRemediationStarter() {
    if (!remediation || !remediationFocus) return;
    setFinishIntent(false);
    setStuckPointOpen(false);
    setPendingRemediationFocus(remediationFocus);
    void persistRemediationTrack(remediationFocus);
    composerRef.current?.insertText(`${draft.trim() ? '\n' : ''}${remediation.prompt}`);
    clearRemediationHandoff();
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  function handleRecognizedImage(markdown: string, autoSubmit: boolean) {
    if (autoSubmit) {
      submitContent(markdown, finishIntent ? 'finish_problem' : 'attempt');
      return;
    }
    composerRef.current?.replaceText(markdown);
  }

  function handleConfirmedHandwriting(result: ConfirmedHandwriting) {
    setConfirmedHandwriting(result);
    suppressNextDraftChangeRef.current = true;
    composerRef.current?.replaceText(result.markdown);
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  const currentAnalysis = messages.find((message) => message.analysis)?.analysis;
  const hasStudentAttempt = messages.some(
    (message) => message.role === 'student' && !message.id.startsWith('student-'),
  );
  const isAnalyzing = messages.some((message) => message.state === 'loading');
  const hasFinishTurn = messages.some((message) => message.assistanceMode === 'finish_problem');
  const latestFinishMessageId = messages.reduce<string | null>(
    (latestId, message) => (
      message.role === 'guide' && message.assistanceMode === 'finish_problem'
        ? message.id
        : latestId
    ),
    null,
  );
  const latestFinishMessage = latestFinishMessageId
    ? messages.find((message) => message.id === latestFinishMessageId)
    : undefined;
  const readyForIndependentAssessment = latestFinishMessage?.currentVerdict === 'correct'
    && messages[messages.length - 1]?.id === latestFinishMessageId;
  const exposedHelpSummaryByMessage = new Map<string, string>();
  let cumulativeHelpLabels: string[] = [];
  for (const message of messages) {
    const mode = message.assistanceMode;
    if (
      message.role === 'guide'
      && message.state === 'reply'
      && (mode === 'hint' || mode === 'explain' || mode === 'worked_solution')
    ) {
      const label = assistanceModeLabels[mode];
      if (!cumulativeHelpLabels.includes(label)) {
        cumulativeHelpLabels = [...cumulativeHelpLabels, label];
      }
    }
    exposedHelpSummaryByMessage.set(
      message.id,
      cumulativeHelpLabels.length
        ? `已使用：${cumulativeHelpLabels.join('、')}`
        : '本页未记录帮助',
    );
  }
  const learningStageIndex = readyForIndependentAssessment
    ? learningStages.length
    : isAnalyzing ? 0 : hasFinishTurn ? 3 : hasStudentAttempt ? 2 : 1;
  const learningStage = readyForIndependentAssessment
    ? {
        detail: '撤去本题帮助，换一道新题确认能否独立完成。',
        label: '独立验证',
        title: '本题已核对，去独立验证',
      }
    : isAnalyzing
      ? learningStages[0]
      : hasFinishTurn
        ? learningStages[3]
        : hasStudentAttempt
          ? learningStages[2]
          : learningStages[1];
  const draftSaveLabel = !hasProblem
    ? '发送后建立学习记录'
    : !activeRecord?.version
      ? '正在建立草稿记录'
      : draftSaveState === 'saved'
        ? '已自动保存'
        : draftSaveState === 'saving'
          ? '正在自动保存'
          : draftSaveState === 'local'
            ? '已保存在本机，等待网络恢复'
            : draftSaveState === 'recovered'
              ? '已恢复本机草稿，尚未同步'
          : draftSaveState === 'error'
            ? '自动保存失败，输入仍在本页'
            : '尚未保存';
  const hasMultistepDraft = draft.includes('\n');

  useLayoutEffect(() => {
    if (!readyForIndependentAssessment || !latestFinishMessageId) return;

    const scrollArea = chatScrollRef.current;
    const composerDock = composerDockRef.current;
    const finishMessage = document.getElementById(latestFinishMessageId);
    const action = finishMessage?.querySelector<HTMLElement>('.learning-checkpoint-action');
    if (!scrollArea || !action) return;

    let frameId = 0;
    const alignActionAboveComposer = () => {
      const scrollAreaBottom = scrollArea.getBoundingClientRect().bottom;
      const composerTop = composerDock?.getBoundingClientRect().top ?? scrollAreaBottom;
      const visibleBottom = Math.min(scrollAreaBottom, composerTop) - 12;
      const actionBottom = action.getBoundingClientRect().bottom;
      if (actionBottom > visibleBottom) {
        scrollArea.scrollTop += actionBottom - visibleBottom;
      }
    };
    const scheduleAlignment = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(alignActionAboveComposer);
    };

    alignActionAboveComposer();
    scheduleAlignment();
    window.addEventListener('resize', scheduleAlignment);
    window.visualViewport?.addEventListener('resize', scheduleAlignment);

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleAlignment);
    resizeObserver?.observe(scrollArea);
    resizeObserver?.observe(action);
    if (composerDock) resizeObserver?.observe(composerDock);

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', scheduleAlignment);
      window.visualViewport?.removeEventListener('resize', scheduleAlignment);
    };
  }, [latestFinishMessageId, readyForIndependentAssessment]);

  return (
    <ReadAloudProvider>
      <main className="study-chat-page">
      <PaperPickerDialog
        open={bankOpen}
        onClose={() => setBankOpen(false)}
        onSelect={chooseBankQuestion}
      />

      <StudySidebar
        active="chat"
        open={sidebarOpen}
        records={records}
        username={username}
        onClose={() => setSidebarOpen(false)}
        onSelectRecord={(record) => void restoreSession(record.id)}
        onStartNew={startNewProblem}
      />

      <section className="chat-main" aria-label="数学答题区">
        <header className="chat-topbar">
          <button
            className="chat-mobile-menu"
            type="button"
            aria-label="打开导航"
            onClick={() => setSidebarOpen(true)}
          >
            ☰
          </button>
          <div>
            <strong>{hasProblem ? '当前题目' : '数学学习'}</strong>
            <span>
              {hasProblem
                ? activeRecord?.version ? '已保存，可刷新继续' : '正在建立学习记录'
                : '输入题目，或去题库选择'}
            </span>
          </div>
          <span className="fixture-chip">历年真题</span>
        </header>

        <div
          className="study-workbench"
          data-has-problem={hasProblem}
          data-question-collapsed={hasProblem && questionCollapsed}
          data-question-focus={hasProblem && questionFocusMode}
        >
          {hasProblem && activeRecord && (
            <aside className="problem-sheet" role="complementary" aria-label="题目原文">
              <header className="problem-sheet-header">
                <div>
                  <span>PROBLEM / 题目原文</span>
                  <h1 id="problem-sheet-title">{activeRecord.title}</h1>
                  {activeRecord.topic && <p>{activeRecord.topic}</p>}
                </div>
                <div className="problem-sheet-actions" role="group" aria-label="题目显示方式">
                  {questionFocusMode ? (
                    <button
                      type="button"
                      onClick={() => {
                        setQuestionFocusMode(false);
                        requestAnimationFrame(() => composerRef.current?.focus());
                      }}
                    >
                      返回作答
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setQuestionCollapsed(false);
                          setQuestionFocusMode(true);
                        }}
                      >
                        专注读题
                      </button>
                      <button
                        type="button"
                        aria-expanded={!questionCollapsed}
                        onClick={() => setQuestionCollapsed((current) => !current)}
                      >
                        {questionCollapsed ? '展开题目' : '收起题目'}
                      </button>
                    </>
                  )}
                </div>
              </header>
              {questionCollapsed && currentAnalysis && (
                <section
                  className="problem-sheet-collapsed-context"
                  aria-label="折叠题目摘要"
                >
                  <span>CURRENT / 当前目标</span>
                  <div
                    className="problem-sheet-collapsed-target"
                    role="region"
                    aria-label="当前目标"
                  >
                    <MathMarkdown content={currentAnalysis.target} />
                  </div>
                  <p>题干仍保留，随时展开核对。</p>
                </section>
              )}
              {!questionCollapsed && (
                <div className="problem-sheet-body">
                  <section aria-label="题目正文">
                    <MathMarkdown content={activeRecord.content} interactiveImages />
                  </section>
                  {currentAnalysis && (
                    <section className="problem-sheet-target" aria-label="当前目标">
                      <span>当前目标</span>
                      <MathMarkdown content={currentAnalysis.target} />
                    </section>
                  )}
                  <p className="problem-sheet-note">题目始终保留在这里；右侧只推进当前一步。</p>
                </div>
              )}
            </aside>
          )}

          <section className="study-dialogue" aria-label="思路训练区">
            {hasProblem && (
              <header className="learning-focus">
                <div className="learning-focus-copy">
                  <span>当前学习焦点</span>
                  <h2>{learningStage.title}</h2>
                  <p>{learningStage.detail}</p>
                </div>
                <ol aria-label="学习阶段">
                  {learningStages.map((stage, index) => (
                    <li
                      key={stage.label}
                      data-state={index < learningStageIndex ? 'done' : index === learningStageIndex ? 'current' : 'next'}
                      aria-current={index === learningStageIndex ? 'step' : undefined}
                    >
                      <span>{index < learningStageIndex ? '✓' : index + 1}</span>
                      {stage.label}
                    </li>
                  ))}
                </ol>
              </header>
            )}

            {hasProblem
              && activeRecord?.id === requestedSessionId
              && remediation ? (
              <section className="remediation-handoff" aria-label="独立检验修正衔接">
                <span>{remediation.label}</span>
                <div>
                  <strong>{remediation.title}</strong>
                  <p>
                    {remediation.detail}
                    <small>只会追加到输入框，不会自动发送，也不会覆盖已有草稿。</small>
                  </p>
                </div>
                <div className="remediation-handoff-actions">
                  <button type="button" onClick={insertRemediationStarter}>
                    {remediation.action}
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => {
                      setPendingRemediationFocus(null);
                      clearRemediationHandoff();
                    }}
                  >
                    暂不处理
                  </button>
                </div>
              </section>
            ) : null}

            <div className="chat-scroll" ref={chatScrollRef}>
              <div className="chat-content">
                {messages.length === 0 ? (
                  <section className="chat-empty" aria-labelledby="chat-empty-title">
                    <span className="chat-empty-eyebrow">START WITH YOUR WORK</span>
                    <span className="chat-empty-mark" aria-hidden="true">∑</span>
                    <h1 id="chat-empty-title">今天想解决哪道题？</h1>
                    <p>把题干放进输入框，或从历年真题中选择。启思先读条件，再围绕你的第一步定位卡点。</p>
                    <div className="chat-empty-principles" aria-label="学习方式">
                      <span>题目常驻</span>
                      <span>一次一步</span>
                      <span>提示可控</span>
                    </div>
                    <button type="button" onClick={openLocalBank}>
                      去题库选择
                      <span aria-hidden="true">→</span>
                    </button>
                  </section>
                ) : (
                  <section className="conversation" aria-label="当前对话" aria-live="polite">
                    {messages.filter((message) => !message.id.startsWith('student-')).map((message) => {
                      const studentWorkLineCount = message.role === 'student'
                        ? countStudentWorkLines(message.content)
                        : 0;
                      const isMultistepStudentWork = studentWorkLineCount > 1;

                      return (
                  <article
                    aria-label={isMultistepStudentWork
                      ? `你的多步演算，共 ${studentWorkLineCount} 行`
                      : undefined}
                    className={`chat-message chat-message-${message.role}`}
                    data-multistep={isMultistepStudentWork || undefined}
                    id={message.id}
                    key={message.id}
                  >
                    <span className="chat-message-avatar" aria-hidden="true">
                      {message.role === 'student' ? username.slice(0, 1).toUpperCase() : 'Q'}
                    </span>
                    <div>
                      <strong>{message.role === 'student' ? '你' : '启思'}</strong>
                      {isMultistepStudentWork ? (
                        <div className="student-work-meta">
                          <div>
                            <span>YOUR WORK / 多步演算</span>
                            <small>{studentWorkLineCount} 行 · 已提交，不代表已核对</small>
                          </div>
                          <button
                            type="button"
                            aria-label="完整回看多步演算"
                            onClick={(event) => {
                              studentWorkTriggerRef.current = event.currentTarget;
                              setReviewedStudentWork({
                                content: message.content,
                                lineCount: studentWorkLineCount,
                              });
                            }}
                          >
                            完整回看 <span aria-hidden="true">↗</span>
                          </button>
                        </div>
                      ) : null}
                      {message.role === 'guide'
                        && message.assistanceMode
                        && message.state === 'reply' && (
                          <span
                            className="chat-message-mode"
                            data-mode={message.assistanceMode}
                            aria-label={message.assistanceMode === 'finish_problem'
                              ? '核对状态：本题结论'
                              : `帮助深度：${assistanceModeLabels[message.assistanceMode]}`}
                          >
                            {assistanceModeLabels[message.assistanceMode]}
                          </span>
                        )}
                      {message.role === 'guide'
                        && message.remediationFocus
                        && message.state === 'reply' && (
                          <span
                            className="chat-message-mode chat-message-remediation"
                            aria-label={`修正类型：${remediationFocusDetails[message.remediationFocus].activeLabel}`}
                          >
                            {remediationFocusDetails[message.remediationFocus].activeLabel}
                          </span>
                        )}
                      {message.role === 'guide'
                        && message.routeAttribution
                        && message.state === 'reply' && (
                          <span
                            className="chat-message-mode chat-message-route"
                            aria-label={message.routeAttribution === 'student'
                              ? '路线归属：沿用你的解法'
                              : '路线归属：共同补全'}
                          >
                            {message.routeAttribution === 'student' ? '沿你的路线' : '共同补全'}
                          </span>
                        )}
                      {message.role === 'guide'
                        && message.assistanceMode
                        && message.state === 'error' && (
                          <span
                            className="chat-message-mode"
                            data-mode="requested-not-exposed"
                            aria-label="帮助状态：已请求，尚未发出"
                          >
                            已请求 · 尚未发出
                          </span>
                        )}
                      {message.analysis ? (
                        <section className="problem-analysis" aria-labelledby={`${message.id}-title`}>
                          <h2 id={`${message.id}-title`}>题目分析</h2>
                          {message.recognitionUncertain?.length ? (
                            <div className="analysis-source-note" role="status">
                              <strong>题面识别有待核对</strong>
                              <span>{message.recognitionUncertain.join('；')}</span>
                            </div>
                          ) : null}
                          {message.preparationStatus ? (
                            <div
                              className="analysis-preparation-note"
                              data-status={message.preparationStatus}
                              role="status"
                            >
                              <span aria-hidden="true">
                                {message.preparationStatus === 'ready'
                                  ? '✓'
                                  : message.preparationStatus === 'unavailable'
                                    ? '!'
                                    : '…'}
                              </span>
                              <div>
                                <strong>
                                  {message.preparationStatus === 'ready'
                                    ? '原卷解析已核对'
                                    : message.preparationStatus === 'unavailable'
                                      ? '原卷解析暂时不可用'
                                      : '题解依据仍在核对'}
                                </strong>
                                <small>
                                  {message.preparationStatus === 'ready'
                                    ? '后续提示会依据这道题的条件与路线生成，但不会提前显示答案。'
                                    : message.preparationStatus === 'unavailable'
                                      ? '先保留题目并从题面起步；不会用未经检查的答案继续教学。'
                                      : '先从题面帮助你起步，不把未经核对的内容当作结论。'}
                                </small>
                              </div>
                            </div>
                          ) : null}
                          {message.analysis.keyConditions.length > 0
                            || message.analysis.knowledgePoints.length > 0 ? (
                            <details
                              className="analysis-brief"
                              aria-label="题面提要"
                              onToggle={(event) => {
                                if (event.currentTarget.open || !shouldUseCompactQuestionContext()) return;
                                requestAnimationFrame(() => {
                                  const scrollArea = chatScrollRef.current;
                                  if (scrollArea) scrollArea.scrollTop = scrollArea.scrollHeight;
                                });
                              }}
                            >
                              <summary>
                                <span>题面提要</span>
                                <strong>
                                  {message.analysis.keyConditions.length} 个条件
                                  <i aria-hidden="true">·</i>
                                  {message.analysis.knowledgePoints.length} 个知识点
                                </strong>
                                <small>
                                  <span className="analysis-brief-label-closed">展开核对</span>
                                  <span className="analysis-brief-label-open">收起提要</span>
                                  <i aria-hidden="true">↓</i>
                                </small>
                              </summary>
                              <div className="analysis-brief-body">
                                <div className="speech-content-row analysis-overview-row">
                                  <MathMarkdown
                                    className="analysis-overview"
                                    content={message.analysis.overview}
                                  />
                                  <ReadAloudButton
                                    id={`${message.id}-overview`}
                                    label="朗读题目分析"
                                    text={message.analysis.overview}
                                  />
                                </div>
                                <div className="analysis-tags" aria-label="相关知识点">
                                  {message.analysis.knowledgePoints.map((point) => (
                                    <span key={point}>{point}</span>
                                  ))}
                                </div>
                                <dl>
                                  <div>
                                    <dt>关键条件</dt>
                                    <dd>
                                      <div className="speech-content-row">
                                        <MathMarkdown content={message.analysis.keyConditions.join('；')} />
                                        <ReadAloudButton
                                          id={`${message.id}-conditions`}
                                          label="朗读关键条件"
                                          text={message.analysis.keyConditions.join('；')}
                                        />
                                      </div>
                                    </dd>
                                  </div>
                                  <div>
                                    <dt>目标</dt>
                                    <dd>
                                      <div className="speech-content-row">
                                        <MathMarkdown content={message.analysis.target} />
                                        <ReadAloudButton
                                          id={`${message.id}-target`}
                                          label="朗读目标"
                                          text={message.analysis.target}
                                        />
                                      </div>
                                    </dd>
                                  </div>
                                </dl>
                              </div>
                            </details>
                          ) : (
                            <div className="speech-content-row analysis-overview-row">
                              <MathMarkdown
                                className="analysis-overview"
                                content={message.analysis.overview}
                              />
                              <ReadAloudButton
                                id={`${message.id}-overview`}
                                label="朗读题目分析"
                                text={message.analysis.overview}
                              />
                            </div>
                          )}
                          <div className="analysis-first-question">
                            <span>先想一步</span>
                            <div className="speech-content-row">
                              <MathMarkdown content={message.analysis.firstQuestion} />
                              <ReadAloudButton
                                id={`${message.id}-first-question`}
                                label="朗读当前问题"
                                text={message.analysis.firstQuestion}
                              />
                            </div>
                          </div>
                          {!messages.some(
                            (item) => item.role === 'student' && !item.id.startsWith('student-'),
                          ) && (
                            <div className="analysis-quick-replies" role="group" aria-label="快捷回应">
                              <span>快速回应</span>
                              {quickReplies.map((reply) => (
                                <button
                                  type="button"
                                  key={reply.label}
                                  data-intent={reply.intent}
                                  disabled={isReplying}
                                  onClick={() => {
                                    if (reply.message) submitContent(reply.message, reply.mode);
                                    else composerRef.current?.focus();
                                  }}
                                >
                                  {reply.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </section>
                      ) : message.state === 'reply-loading' ? (
                        <div className="reply-progress">
                          <span className="analysis-loading" role="status">
                            <i aria-hidden="true" />
                            {message.content}
                          </span>
                          <button
                            type="button"
                            aria-label="停止本轮回复"
                            onClick={() => stopCurrentReply(message.id)}
                          >
                            停止
                          </button>
                        </div>
                      ) : message.role === 'guide' && message.state === 'reply' ? (
                        <div className="speech-content-row guide-reply-row">
                          <MathMarkdown content={message.content} />
                          <ReadAloudButton
                            id={`${message.id}-reply`}
                            label="朗读启思回复"
                            text={message.content}
                          />
                        </div>
                      ) : (
                        <MathMarkdown content={message.content} />
                      )}
                      {message.role === 'guide'
                        && message.assistanceMode === 'finish_problem'
                        && message.state === 'reply' && (
                          <aside
                            className="learning-checkpoint-note"
                            data-verdict={message.currentVerdict ?? 'unknown'}
                            role="note"
                            aria-label="本题核对说明"
                          >
                            <span aria-hidden="true">
                              {message.currentVerdict === 'correct'
                                ? 'CHECKED / CURRENT PROBLEM'
                                : message.currentVerdict === 'incorrect'
                                  ? 'REVISE / CURRENT PROBLEM'
                                  : 'MORE EVIDENCE / CURRENT PROBLEM'}
                            </span>
                            <strong>
                              {message.currentVerdict === 'correct'
                                ? '这次结论已经核对'
                                : message.currentVerdict === 'incorrect'
                                  ? '这次结论还需要修正'
                                  : '目前证据还不足'}
                            </strong>
                            <p>
                              {message.currentVerdict === 'correct'
                                ? '掌握情况尚未独立验证，之后需要用新题检验。'
                                : message.currentVerdict === 'incorrect'
                                  ? '先修改本题结论或关键步骤，暂不进入独立检验。'
                                  : '再补一行关键依据，暂不把这次作答记为正确。'}
                            </p>
                            <dl className="learning-evidence-strip">
                              <div>
                                <dt>本题作答</dt>
                                <dd>
                                  {message.currentVerdict === 'correct'
                                    ? '结论正确'
                                    : message.currentVerdict === 'incorrect'
                                      ? '需要修正'
                                      : '证据不足'}
                                </dd>
                              </div>
                              <div>
                                <dt>帮助记录</dt>
                                <dd>{exposedHelpSummaryByMessage.get(message.id)}</dd>
                              </div>
                              <div>
                                <dt>独立检验</dt>
                                <dd>{message.currentVerdict === 'correct' ? '尚未进行' : '暂不开始'}</dd>
                              </div>
                            </dl>
                            {message.id !== latestFinishMessageId ? (
                              <small className="learning-checkpoint-superseded">
                                已由后续作答更新
                              </small>
                            ) : activeRecord && message.currentVerdict === 'correct' ? (
                              <Link
                                className="learning-checkpoint-action"
                                to={`/learn/${activeRecord.id}/check?intent=reassess`}
                              >
                                换一道题独立检验 <span aria-hidden="true">→</span>
                              </Link>
                            ) : (
                              <button
                                className="learning-checkpoint-action learning-checkpoint-revise"
                                type="button"
                                onClick={() => composerRef.current?.focus()}
                              >
                                {message.currentVerdict === 'incorrect'
                                  ? '继续修改这次答案'
                                  : '补充一行关键依据'}
                                <span aria-hidden="true">↓</span>
                              </button>
                            )}
                          </aside>
                        )}
                      {message.state === 'loading' && (
                        <span className="analysis-loading" role="status">
                          <i aria-hidden="true" />
                          正在读取条件与目标
                        </span>
                      )}
                      {message.state === 'error' && activeRecord && !message.request && (
                        <button
                          className="analysis-retry"
                          type="button"
                          onClick={() => requestAnalysis(activeRecord)}
                        >
                          重新分析
                        </button>
                      )}
                      {message.state === 'error' && message.request && message.history && (
                        <button
                          className="analysis-retry"
                          type="button"
                          onClick={() =>
                            requestReply(
                              message.id,
                              message.request!,
                              message.history!,
                              message.assistanceMode ?? 'attempt',
                              message.requestId ?? crypto.randomUUID(),
                              message.handwriting,
                              message.remediationFocus,
                            )
                          }
                        >
                          重新回答
                        </button>
                      )}
                    </div>
                  </article>
                      );
                    })}
                  </section>
                )}
              </div>
            </div>

            <div ref={composerDockRef} className="composer-dock">
              <div
                className="composer-wrap"
                data-formula-open={formulaOpen}
                data-multistep={hasMultistepDraft}
              >
                {hasProblem && hasStudentAttempt && pendingHelpAction && (
                  <section
                    ref={highImpactHelpDialogRef}
                    className="help-disclosure-confirmation"
                    role="alertdialog"
                    aria-modal="true"
                    aria-labelledby="help-disclosure-title"
                    aria-describedby="help-disclosure-description"
                  >
                    <div>
                      <strong id="help-disclosure-title">要直接讲解这一步吗？</strong>
                      <p id="help-disclosure-description">
                        这会展示关键方法，并把本轮标记为“直接讲解”。想保留独立尝试，可以先看一点提示。
                      </p>
                    </div>
                    <div>
                      <button
                        ref={highImpactHelpConfirmRef}
                        type="button"
                        onClick={() => {
                          const action = pendingHelpAction;
                          setPendingHelpAction(null);
                          submitContent(action.message, action.mode);
                        }}
                      >
                        继续直接讲解
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPendingHelpAction(null);
                          requestAnimationFrame(() => composerRef.current?.focus());
                        }}
                      >
                        先自己做
                      </button>
                    </div>
                  </section>
                )}

                {hasProblem
                  && hasStudentAttempt
                  && !pendingHelpAction
                  && !finishIntent
                  && !pendingRemediationFocus
                  && !readyForIndependentAssessment && (
                  <>
                  <div className="learning-helpbar" role="group" aria-label="学习帮助">
                    <div>
                      <strong>卡住了？先标卡点或选帮助</strong>
                      <span>标记不发送；帮助会标明深度</span>
                    </div>
                    <div>
                      <button
                        className="stuck-point-trigger"
                        type="button"
                        aria-controls="stuck-point-options"
                        aria-expanded={stuckPointOpen}
                        aria-label="先标记卡点，仅填入输入框"
                        onClick={() => setStuckPointOpen((current) => !current)}
                      >
                        <span className="help-action-long">先标记卡点</span>
                        <span className="help-action-short" aria-hidden="true">标卡点</span>
                      </button>
                      {learningHelpActions.map((action, index) => (
                        <button
                          type="button"
                          key={action.label}
                          aria-label={action.label}
                          data-level={index}
                          disabled={!currentAnalysis || isReplying}
                          onClick={() => {
                            if (action.mode === 'worked_solution') {
                              setStuckPointOpen(false);
                              setPendingHelpAction(action);
                              return;
                            }
                            submitContent(action.message, action.mode);
                          }}
                        >
                          <span className="help-action-long">{action.label}</span>
                          <span className="help-action-short" aria-hidden="true">
                            {action.compactLabel}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                  {stuckPointOpen && (
                    <section
                      className="stuck-point-panel"
                      id="stuck-point-options"
                      role="group"
                      aria-label="卡点类型"
                    >
                      <div>
                        <strong>先选最接近的一类</strong>
                        <span>只放进输入框，你还能继续补充或修改。</span>
                      </div>
                      <div>
                        {stuckPointOptions.map((option) => (
                          <button
                            type="button"
                            key={option.label}
                            onClick={() => insertStuckPoint(option.prompt)}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                  <div className="learning-finishbar">
                    <div>
                      <span>FINISH / 本题结论</span>
                      <strong>答案和关键依据都写完了？</strong>
                    </div>
                    <button
                      type="button"
                      disabled={!currentAnalysis || isReplying}
                      onClick={startFinishCheck}
                    >
                      核对本题结论 <span aria-hidden="true">→</span>
                    </button>
                  </div>
                  </>
                )}

                {hasProblem
                  && hasStudentAttempt
                  && !pendingHelpAction
                  && finishIntent
                  && !readyForIndependentAssessment && (
                  <section
                    className="finish-composer-intent"
                    role="status"
                    aria-label="本题结论提交方式"
                  >
                    <div>
                      <span>FINAL ANSWER / 待提交</span>
                      <strong>写下最终结论和关键一步</strong>
                      <p>这里只核对本题作答，不会直接记为“已掌握”。</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setFinishIntent(false);
                        requestAnimationFrame(() => composerRef.current?.focus());
                      }}
                    >
                      改为普通作答
                    </button>
                  </section>
                )}

                {pendingRemediationFocus && !finishIntent && (
                  <section
                    className="remediation-composer-focus"
                    role="status"
                    aria-label="本轮修正目标"
                  >
                    <span aria-hidden="true">FIX / 修正</span>
                    <div>
                      <strong>{remediationFocusDetails[pendingRemediationFocus].activeLabel}</strong>
                      <small>后续作答会继续按这个范围诊断；核对修正完成后再换新题独立检验。</small>
                      {remediationTrackError && <small role="alert">{remediationTrackError}</small>}
                    </div>
                    <div className="remediation-composer-actions">
                      <button
                        className="secondary"
                        type="button"
                        disabled={isReplying}
                        onClick={() => void exitRemediationTrack()}
                      >
                        退出修正模式
                      </button>
                      <button
                        className="primary"
                        type="button"
                        disabled={!currentAnalysis || isReplying}
                        onClick={startFinishCheck}
                      >
                        核对修正结果
                      </button>
                    </div>
                  </section>
                )}

                {formulaOpen && (
                  <div
                    ref={formulaToolsRef}
                    className="formula-tools"
                    id="formula-tools"
                    role="group"
                    aria-label="公式快捷输入"
                    onKeyDown={(event) => {
                      if (event.key !== 'Escape') return;
                      event.preventDefault();
                      setFormulaOpen(false);
                      requestAnimationFrame(() => formulaTriggerRef.current?.focus());
                    }}
                  >
                    <div className="formula-toolbar">
                      {MATH_FORMULA_SHORTCUTS.map((shortcut) => (
                        <button
                          type="button"
                          key={shortcut.name}
                          aria-label={shortcut.name}
                          onClick={() => insertFormula(shortcut.syntax)}
                        >
                          {shortcut.label}
                        </button>
                      ))}
                    </div>
                    <div className="formula-toolbar-footer">
                      <p className="formula-toolbar-note">
                        <span className="formula-note-desktop">直接输入，按 <kbd>Tab</kbd> 或点“下一格”</span>
                        <span className="formula-note-mobile">直接输入，填完点“下一格”</span>
                      </p>
                      <button
                        className="formula-next-slot"
                        type="button"
                        aria-label="移动到下一个公式输入格"
                        disabled={!draft.includes('$')}
                        onClick={() => composerRef.current?.advanceFormulaSlot()}
                      >
                        下一格 <span aria-hidden="true">→</span>
                      </button>
                    </div>
                  </div>
                )}

                {draft.includes('$') && (
                  <div className="composer-preview" aria-label="公式预览">
                    <span>预览</span>
                    <MathMarkdown content={draft} />
                  </div>
                )}

                <form ref={composerFormRef} className="chat-composer" onSubmit={handleSubmit}>
                  {hasProblem && activeRecord?.version ? (
                    <HandwritingInput
                      ref={handwritingInputRef}
                      disabled={isReplying}
                      onConfirmed={handleConfirmedHandwriting}
                      sessionId={activeRecord.id}
                    />
                  ) : !hasProblem ? (
                    <ImageQuestionInput
                      ref={imageInputRef}
                      disabled={isReplying}
                      onRecognized={handleRecognizedImage}
                    />
                  ) : null}
                  <RichComposer
                    ref={composerRef}
                    placeholder={readyForIndependentAssessment
                      ? '想比较其他解法？可在这里继续补充…'
                      : finishIntent
                      ? '写最终结论，并补上最关键的一步依据…'
                      : hasProblem ? '写下你的判断、步骤或公式…' : '输入或粘贴一道数学题…'}
                    onChange={updateDraft}
                    onImagePaste={(file) => {
                      if (hasProblem) handwritingInputRef.current?.selectFile(file);
                      else imageInputRef.current?.selectFile(file);
                    }}
                    onSubmit={() => composerFormRef.current?.requestSubmit()}
                  />
                  <div className="composer-actions">
                    <div>
                      <button
                        type="button"
                        aria-label={hasProblem ? '添加手写作答' : '添加题目图片'}
                        data-tooltip={hasProblem ? '添加手写作答' : '添加题目图片'}
                        title={hasProblem ? '添加手写作答' : '添加题目图片'}
                        disabled={isReplying || (hasProblem && !activeRecord?.version)}
                        onClick={() => {
                          setFormulaOpen(false);
                          setBankOpen(false);
                          if (hasProblem) handwritingInputRef.current?.openFilePicker();
                          else imageInputRef.current?.openFilePicker();
                        }}
                      >
                        <svg className="composer-tool-icon" aria-hidden="true" viewBox="0 0 24 24">
                          <rect x="3.5" y="4" width="17" height="16" rx="2" />
                          <circle cx="9" cy="9" r="1.6" />
                          <path d="m5.5 17 4.2-4.3 3.1 3 2.1-2.1 3.6 3.4" />
                        </svg>
                        <span className="composer-action-label">图片</span>
                      </button>
                      <button
                        type="button"
                        aria-label="题库"
                        data-tooltip="题库"
                        title="题库"
                        onClick={() => {
                          setBankOpen((current) => !current);
                          setFormulaOpen(false);
                        }}
                      >
                        <svg className="composer-tool-icon" aria-hidden="true" viewBox="0 0 24 24">
                          <path d="M5 5.5h14M5 12h14M5 18.5h14" />
                          <path d="M8 3.5v4M8 10v4M8 16.5v4" />
                        </svg>
                        <span className="composer-action-label">题库</span>
                      </button>
                      <button
                        ref={formulaTriggerRef}
                        type="button"
                        aria-label="公式"
                        aria-controls="formula-tools"
                        aria-expanded={formulaOpen}
                        data-tooltip="公式快捷输入"
                        title="公式快捷输入"
                        onClick={(event) => {
                          const opening = !formulaOpen;
                          setFormulaOpen(opening);
                          setBankOpen(false);
                          if (opening && event.detail === 0) {
                            requestAnimationFrame(() => {
                              formulaToolsRef.current
                                ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
                                ?.focus();
                            });
                          }
                        }}
                      >
                        <span className="composer-formula-symbol" aria-hidden="true">∑</span>
                        <span className="composer-action-label">公式</span>
                      </button>
                      <MathFormatButton
                        disabled={isReplying}
                        text={draft}
                        onFormatted={(markdown) => composerRef.current?.replaceText(markdown)}
                      />
                    </div>
                    <div className="composer-primary-actions">
                      <VoiceInputButton
                        disabled={isReplying}
                        onInterimTranscript={(text) => composerRef.current?.updateVoiceDraft(text)}
                        onTranscript={(text) => composerRef.current?.commitVoiceDraft(text)}
                      />
                      <button
                        className="composer-send"
                        type="submit"
                        disabled={!draft.trim() || isReplying}
                        aria-label={isReplying ? '等待回复' : finishIntent ? '核对本题结论' : '发送'}
                        data-tooltip={isReplying ? '等待回复' : finishIntent ? '核对本题结论' : '发送'}
                        title={isReplying ? '等待回复' : finishIntent ? '核对本题结论' : '发送'}
                      >
                        ↑
                      </button>
                    </div>
                  </div>
                </form>
                <div className="composer-note">
                  <span
                    className="composer-draft-status"
                    data-state={draftSaveState}
                    role="status"
                    aria-label="草稿保存状态"
                  >
                    {draftSaveLabel}
                    {['error', 'local', 'recovered'].includes(draftSaveState)
                    && activeRecord?.version ? (
                      <button
                        type="button"
                        onClick={() => void persistDraft(
                          activeRecord.id,
                          draft,
                          draftRevisionRef.current,
                        )}
                      >
                        立即同步
                      </button>
                    ) : null}
                  </span>
                  <span className="composer-guidance composer-note-desktop">
                    {confirmedHandwriting
                      ? '手写转写已确认；如果继续修改，将按普通文字提交。'
                      : hasMultistepDraft
                      ? '多步演算：Enter 换行，Ctrl/⌘ + Enter 发送。'
                      : readyForIndependentAssessment
                      ? '本题仍可继续讨论；是否掌握，以新题独立检验为准。'
                      : finishIntent
                        ? 'Enter 提交本题结论，Shift + Enter 换行。'
                        : 'Enter 发送，Shift + Enter 换行。一次只推进一个关键判断。'}
                  </span>
                  <span className="composer-guidance composer-note-mobile">
                    {confirmedHandwriting
                      ? '手写转写已确认；修改后按普通文字提交。'
                      : hasMultistepDraft
                      ? '多步演算：回车换行，点箭头发送。'
                      : readyForIndependentAssessment
                      ? '可继续讨论；掌握情况要用新题验证。'
                      : finishIntent
                        ? '提交前确认最终答案和关键依据都写清楚。'
                        : '公式可预览，发送前还能继续修改。'}
                  </span>
                </div>
              </div>
            </div>
          </section>
        </div>
      </section>
      </main>
      {reviewedStudentWork ? (
        <div
          className="student-work-reader-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeStudentWorkReader();
          }}
        >
          <div
            ref={studentWorkDialogRef}
            className="student-work-reader"
            role="dialog"
            aria-modal="true"
            aria-label="回看你的多步演算"
          >
            <header>
              <div>
                <span>YOUR WORK / 作答回看</span>
                <strong>你的多步演算</strong>
                <small>
                  {reviewedStudentWork.lineCount} 行 · 已提交，不代表已核对 · 选择一行只填入草稿
                </small>
              </div>
              <button
                ref={studentWorkCloseRef}
                type="button"
                aria-label="关闭多步演算回看"
                onClick={closeStudentWorkReader}
              >
                关闭
              </button>
            </header>
            <div className="student-work-reader-body">
              <ol className="student-work-reader-lines" aria-label="多步演算逐行回看">
                {splitStudentWorkSegments(reviewedStudentWork.content).map((segment, index) => (
                  <li key={`${segment.lineNumber}-${index}`}>
                    <span className="student-work-line-number" aria-hidden="true">
                      {segment.lineNumber}
                    </span>
                    <MathMarkdown content={segment.content} />
                    <button
                      type="button"
                      aria-label={`引用第 ${segment.lineNumber} 行到草稿`}
                      onClick={() => quoteStudentWorkSegment(segment)}
                    >
                      引用这行
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      ) : null}
    </ReadAloudProvider>
  );
}

export function PreparePage({ username }: StudentPageProps) {
  const navigate = useNavigate();
  const { problemId } = useParams();
  const problem = getFixtureProblem(problemId);

  if (!problem) {
    return <Navigate to="/bank" replace />;
  }

  return (
    <StudyFrame current="prepare" username={username}>
      <section className="prepare-layout" aria-labelledby="prepare-title">
        <div className="prepare-copy">
          <p className="section-code">PREPARATION / {problem.number}</p>
          <span className="fixture-label">开发夹具 · 非正式题库</span>
          <h1 id="prepare-title">题目已准备</h1>
          <p>
            这道开发演示题已完成页面显示检查。正式题库接入后，这里会展示真实的备课与核对状态。
          </p>

          <ul className="preparation-checks">
            <li><span aria-hidden="true">✓</span>题干和公式可以正常读取</li>
            <li><span aria-hidden="true">✓</span>页面没有提前展示答案或提示</li>
            <li><span aria-hidden="true">✓</span>学习入口可以打开</li>
          </ul>

          <div className="prepare-actions">
            <Button onClick={() => navigate(`/learn/${fixtureSessionId(problem.id)}`)}>
              进入学习页 <span aria-hidden="true">→</span>
            </Button>
            <Button variant="quiet" onClick={() => navigate('/bank')}>
              返回重新选题
            </Button>
          </div>
        </div>

        <article className="prepare-problem-paper">
          <div className="problem-meta">
            <span>{problem.number}</span>
            <span>{problem.topic}</span>
          </div>
          <MathMarkdown className="problem-statement" content={problem.statementMd} />
          <p>{problem.source}</p>
        </article>
      </section>
    </StudyFrame>
  );
}

export function FixtureLearningPage({ username }: StudentPageProps) {
  const { sessionId } = useParams();
  const problem = getFixtureProblem(problemIdFromFixtureSession(sessionId));

  if (!problem) {
    return <Navigate to="/bank" replace />;
  }

  return (
    <StudyFrame current="learn" username={username}>
      <section className="learning-layout">
        <article className="learning-problem" aria-labelledby="problem-title">
          <div className="problem-meta">
            <span>{problem.number}</span>
            <span>{problem.topic}</span>
          </div>
          <h2 id="problem-title">题目</h2>
          <MathMarkdown className="problem-statement" content={problem.statementMd} />
          <p className="fixture-label">开发夹具 · 不代表正式题库</p>
        </article>

        <section className="learning-workspace" aria-labelledby="learning-prompt">
          <p className="section-code">YOUR FIRST MOVE</p>
          <h1 id="learning-prompt">你准备从哪里入手？</h1>
          <p>可以写计划、已有步骤，或告诉我目前不知道哪里。</p>

          <label htmlFor="first-attempt">你的想法</label>
          <textarea
            id="first-attempt"
            disabled
            placeholder="教学工作流接入后，可以在这里写下第一步……"
          />
          <div className="learning-actions">
            <Button disabled>提交想法</Button>
            <span>当前只打通学习入口，提交功能尚未接入。</span>
          </div>
        </section>
      </section>
    </StudyFrame>
  );
}
