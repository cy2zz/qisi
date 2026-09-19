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
  ImageQuestionInput,
  type ImageQuestionInputHandle,
} from '../../features/input/ImageQuestionInput';
import { VoiceInputButton } from '../../features/input/VoiceInputButton';
import { apiFetch, apiStream } from '../../lib/api';
import { MathMarkdown } from '../../shared/MathMarkdown';
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

interface StudentPageProps {
  username: string;
}

interface ConversationMessage {
  assistanceMode?: AssistanceMode;
  analysis?: ProblemAnalysis;
  content: string;
  history?: ProblemChatMessage[];
  id: string;
  request?: string;
  requestId?: string;
  recognitionUncertain?: string[];
  role: 'guide' | 'student';
  state?: 'analysis' | 'error' | 'loading' | 'reply' | 'reply-loading' | 'reply-streaming' | 'text';
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

const assistanceModeLabels: Record<AssistanceMode, string> = {
  attempt: '思路反馈',
  hint: '最小提示',
  explain: '局部解释',
  worked_solution: '直接讲解',
  finish_problem: '本题核对',
};

type SessionRecord = StudyRecord;

const formulaShortcuts = [
  { label: '分式', name: '插入分式', syntax: '$\\frac{}{}$' },
  { label: '根式', name: '插入根式', syntax: '$\\sqrt{}$' },
  { label: '上标', name: '插入上标', syntax: '$x^{}$' },
  { label: '下标', name: '插入下标', syntax: '$x_{}$' },
  { label: '绝对值', name: '插入绝对值', syntax: '$\\left|{}\\right|$' },
  { label: '括号', name: '插入自适应括号', syntax: '$\\left({}\\right)$' },
  { label: '求和', name: '插入求和', syntax: '$\\sum_{}^{}$' },
  { label: '积分', name: '插入积分', syntax: '$\\int_{}^{}$' },
  { label: '极限', name: '插入极限', syntax: '$\\lim_{x\\to {}}$' },
  { label: '向量', name: '插入向量', syntax: '$\\vec{}$' },
  { label: '联立', name: '插入联立式', syntax: '$\\begin{cases}{}\\\\{}\\end{cases}$' },
];

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
  const requestedSessionId = new URLSearchParams(location.search).get('session');
  const analysisRequestRef = useRef(0);
  const chatAbortRef = useRef<AbortController | null>(null);
  const chatRequestRef = useRef(0);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const composerFormRef = useRef<HTMLFormElement>(null);
  const composerRef = useRef<RichComposerHandle>(null);
  const highImpactHelpConfirmRef = useRef<HTMLButtonElement>(null);
  const imageInputRef = useRef<ImageQuestionInputHandle>(null);
  const restoreRequestRef = useRef(0);
  const [activeRecord, setActiveRecord] = useState<SessionRecord | null>(null);
  const [bankOpen, setBankOpen] = useState(false);
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [hasProblem, setHasProblem] = useState(false);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [records, setRecords] = useState<SessionRecord[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [questionCollapsed, setQuestionCollapsed] = useState(false);
  const [draft, setDraft] = useState('');
  const [isReplying, setIsReplying] = useState(false);
  const [finishIntent, setFinishIntent] = useState(false);
  const [pendingHelpAction, setPendingHelpAction] = useState<(typeof learningHelpActions)[number] | null>(null);
  const [replyToRevealId, setReplyToRevealId] = useState<string | null>(null);

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
    composerRef.current?.focus({ preventScroll: true });
  }, [messages, replyToRevealId]);

  useEffect(() => {
    if (pendingHelpAction) {
      requestAnimationFrame(() => highImpactHelpConfirmRef.current?.focus());
    }
  }, [pendingHelpAction]);

  function rememberRecord(record: SessionRecord) {
    setRecords((current) => [record, ...current.filter((item) => item.id !== record.id)]);
  }

  async function restoreSession(sessionId: string) {
    const requestNumber = ++restoreRequestRef.current;
    try {
      const detail = await apiFetch<{
        analysis: ProblemAnalysis;
        messages: Array<{
          assistanceMode?: AssistanceMode;
          content: string;
          id: string;
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
              recognitionUncertain: detail.record.recognitionUncertain,
              role: 'guide',
              state: 'analysis',
            }
          : {
              assistanceMode: message.assistanceMode,
              content: message.content,
              id: `persisted-${message.id}`,
              role: message.role,
              state: 'reply',
            },
      );
      setActiveRecord(detail.record);
      setReplyToRevealId(null);
      setMessages(restoredMessages);
      rememberRecord(detail.record);
      setHasProblem(true);
      setFormulaOpen(false);
      setFinishIntent(false);
      setPendingHelpAction(null);
      setQuestionCollapsed(false);
      setSidebarOpen(false);
      requestAnimationFrame(() => composerRef.current?.focus());
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
                recognitionUncertain: result.recognitionUncertain,
                role: 'guide',
                state: 'analysis',
              }
            : message,
        ),
      );
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
    composerRef.current?.clear();
    imageInputRef.current?.clear();
    setBankOpen(false);
    setFormulaOpen(false);
    setFinishIntent(false);
    setPendingHelpAction(null);
    setQuestionCollapsed(false);
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
    composerRef.current?.clear();
    imageInputRef.current?.clear();
    setBankOpen(false);
    setFormulaOpen(false);
    setFinishIntent(false);
    setPendingHelpAction(null);
    setQuestionCollapsed(false);
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
  ) {
    if (!activeRecord) return;

    chatAbortRef.current?.abort();
    const abortController = new AbortController();
    chatAbortRef.current = abortController;
    const requestNumber = ++chatRequestRef.current;
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
        },
        (event) => {
          if (chatRequestRef.current !== requestNumber) return;
          if (event.type === 'done') setReplyToRevealId(guideMessageId);
          setMessages((current) =>
            current.map((message) => {
              if (message.id !== guideMessageId) return message;
              if (event.type === 'status') {
                return { ...message, content: event.message, state: 'reply-loading' };
              }
              if (event.type === 'chunk') {
                const previous = message.state === 'reply-streaming' ? message.content : '';
                return { ...message, content: previous + event.text, state: 'reply-streaming' };
              }
              if (event.type === 'done') {
                committedVersion = event.version;
                return { ...message, state: 'reply' };
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
        setReplyToRevealId(guideMessageId);
        setIsReplying(false);
      }
    }
  }

  function submitContent(rawContent: string, assistanceMode: AssistanceMode = 'attempt') {
    const content = rawContent.trim();
    if (!content || isReplying) return;

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
    setMessages((current) => [
      ...current,
      { content, id: messageId, role: 'student' },
      {
        content: '正在核对你的这一步',
        assistanceMode,
        history,
        id: guideMessageId,
        request: content,
        requestId,
        role: 'guide',
        state: 'reply-loading',
      },
    ]);
    composerRef.current?.clear();
    setFormulaOpen(false);
    if (assistanceMode === 'finish_problem') setFinishIntent(false);
    void requestReply(guideMessageId, content, history, assistanceMode, requestId);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitContent(draft, finishIntent ? 'finish_problem' : 'attempt');
  }

  function insertFormula(syntax: string) {
    composerRef.current?.insertFormulaTemplate(syntax);
  }

  function handleRecognizedImage(markdown: string, autoSubmit: boolean) {
    if (autoSubmit) {
      submitContent(markdown, finishIntent ? 'finish_problem' : 'attempt');
      return;
    }
    composerRef.current?.replaceText(markdown);
  }

  const currentAnalysis = messages.find((message) => message.analysis)?.analysis;
  const hasStudentAttempt = messages.some(
    (message) => message.role === 'student' && !message.id.startsWith('student-'),
  );
  const isAnalyzing = messages.some((message) => message.state === 'loading');
  const hasFinishTurn = messages.some((message) => message.assistanceMode === 'finish_problem');
  const exposedHelpLabels = messages.reduce<string[]>((labels, message) => {
    const mode = message.assistanceMode;
    if (
      message.role !== 'guide'
      || message.state !== 'reply'
      || (mode !== 'hint' && mode !== 'explain' && mode !== 'worked_solution')
    ) return labels;

    const label = assistanceModeLabels[mode];
    return labels.includes(label) ? labels : [...labels, label];
  }, []);
  const learningStageIndex = isAnalyzing ? 0 : hasFinishTurn ? 3 : hasStudentAttempt ? 2 : 1;
  const learningStage = learningStages[learningStageIndex];

  return (
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
        >
          {hasProblem && activeRecord && (
            <aside className="problem-sheet" role="complementary" aria-label="题目原文">
              <header className="problem-sheet-header">
                <div>
                  <span>PROBLEM / 题目原文</span>
                  <h1 id="problem-sheet-title">{activeRecord.title}</h1>
                  {activeRecord.topic && <p>{activeRecord.topic}</p>}
                </div>
                <button
                  type="button"
                  aria-expanded={!questionCollapsed}
                  onClick={() => setQuestionCollapsed((current) => !current)}
                >
                  {questionCollapsed ? '展开题目' : '收起题目'}
                </button>
              </header>
              {!questionCollapsed && (
                <div className="problem-sheet-body">
                  <section aria-label="题目正文">
                    <MathMarkdown content={activeRecord.content} />
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
                    {messages.filter((message) => !message.id.startsWith('student-')).map((message) => (
                  <article
                    className={`chat-message chat-message-${message.role}`}
                    id={message.id}
                    key={message.id}
                  >
                    <span className="chat-message-avatar" aria-hidden="true">
                      {message.role === 'student' ? username.slice(0, 1).toUpperCase() : 'Q'}
                    </span>
                    <div>
                      <strong>{message.role === 'student' ? '你' : '启思'}</strong>
                      {message.role === 'guide'
                        && message.assistanceMode
                        && (message.state === 'reply' || message.state === 'reply-streaming') && (
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
                          <MathMarkdown
                            className="analysis-overview"
                            content={message.analysis.overview}
                          />
                          <div className="analysis-tags" aria-label="相关知识点">
                            {message.analysis.knowledgePoints.map((point) => (
                              <span key={point}>{point}</span>
                            ))}
                          </div>
                          <dl>
                            <div>
                              <dt>关键条件</dt>
                              <dd>
                                <MathMarkdown content={message.analysis.keyConditions.join('；')} />
                              </dd>
                            </div>
                            <div>
                              <dt>目标</dt>
                              <dd><MathMarkdown content={message.analysis.target} /></dd>
                            </div>
                          </dl>
                          <div className="analysis-first-question">
                            <span>先想一步</span>
                            <MathMarkdown content={message.analysis.firstQuestion} />
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
                        <span className="analysis-loading" role="status">
                          <i aria-hidden="true" />
                          {message.content}
                        </span>
                      ) : message.state === 'reply-streaming' ? (
                        <div className="streaming-reply">
                          <MathMarkdown content={message.content} />
                          <span aria-hidden="true" />
                        </div>
                      ) : (
                        <MathMarkdown content={message.content} />
                      )}
                      {message.role === 'guide'
                        && message.assistanceMode === 'finish_problem'
                        && message.state === 'reply' && (
                          <aside
                            className="learning-checkpoint-note"
                            role="note"
                            aria-label="本题核对说明"
                          >
                            <span aria-hidden="true">CHECKED / CURRENT PROBLEM</span>
                            <strong>只核对这次作答</strong>
                            <p>掌握情况尚未独立验证，之后需要用新题检验。</p>
                            <dl className="learning-evidence-strip">
                              <div>
                                <dt>本题作答</dt>
                                <dd>已核对</dd>
                              </div>
                              <div>
                                <dt>帮助记录</dt>
                                <dd>{exposedHelpLabels.length
                                  ? `已使用：${exposedHelpLabels.join('、')}`
                                  : '本页未记录帮助'}</dd>
                              </div>
                              <div>
                                <dt>独立检验</dt>
                                <dd>尚未进行</dd>
                              </div>
                            </dl>
                            {activeRecord ? (
                              <Link
                                className="learning-checkpoint-action"
                                to={`/learn/${activeRecord.id}/check`}
                              >
                                换一道题独立检验 <span aria-hidden="true">→</span>
                              </Link>
                            ) : null}
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
                            )
                          }
                        >
                          重新回答
                        </button>
                      )}
                    </div>
                  </article>
                    ))}
                  </section>
                )}
              </div>
            </div>

            <div className="composer-dock">
              <div className="composer-wrap">
                {hasProblem && hasStudentAttempt && pendingHelpAction && (
                  <section
                    className="help-disclosure-confirmation"
                    role="alertdialog"
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

                {hasProblem && hasStudentAttempt && !pendingHelpAction && !finishIntent && (
                  <>
                  <div className="learning-helpbar" role="group" aria-label="学习帮助">
                    <div>
                      <strong>卡住了？自己选帮助深度</strong>
                      <span>每次帮助都会标明深度</span>
                    </div>
                    <div>
                      {learningHelpActions.map((action, index) => (
                        <button
                          type="button"
                          key={action.label}
                          aria-label={action.label}
                          data-level={index}
                          disabled={!currentAnalysis || isReplying}
                          onClick={() => {
                            if (action.mode === 'worked_solution') {
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
                  <div className="learning-finishbar">
                    <div>
                      <span>FINISH / 本题结论</span>
                      <strong>答案和关键依据都写完了？</strong>
                    </div>
                    <button
                      type="button"
                      disabled={!currentAnalysis || isReplying}
                      onClick={() => {
                        if (draft.trim()) {
                          submitContent(draft, 'finish_problem');
                          return;
                        }
                        setFinishIntent(true);
                        requestAnimationFrame(() => composerRef.current?.focus());
                      }}
                    >
                      核对本题结论 <span aria-hidden="true">→</span>
                    </button>
                  </div>
                  </>
                )}

                {hasProblem && hasStudentAttempt && !pendingHelpAction && finishIntent && (
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

                {formulaOpen && (
                  <div className="formula-tools" role="group" aria-label="公式快捷输入">
                    <div className="formula-toolbar">
                      {formulaShortcuts.map((shortcut) => (
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
                  <ImageQuestionInput
                    ref={imageInputRef}
                    disabled={isReplying}
                    onRecognized={handleRecognizedImage}
                  />
                  <RichComposer
                    ref={composerRef}
                    placeholder={finishIntent
                      ? '写最终结论，并补上最关键的一步依据…'
                      : hasProblem ? '写下你的判断、步骤或公式…' : '输入或粘贴一道数学题…'}
                    onChange={setDraft}
                    onImagePaste={(file) => imageInputRef.current?.selectFile(file)}
                    onSubmit={() => composerFormRef.current?.requestSubmit()}
                  />
                  <div className="composer-actions">
                    <div>
                      <button
                        type="button"
                        aria-label="添加题目图片"
                        data-tooltip="添加题目图片"
                        title="添加题目图片"
                        onClick={() => imageInputRef.current?.openFilePicker()}
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
                        type="button"
                        aria-label="公式"
                        aria-expanded={formulaOpen}
                        data-tooltip="公式快捷输入"
                        title="公式快捷输入"
                        onClick={() => {
                          setFormulaOpen((current) => !current);
                          setBankOpen(false);
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
                <p className="composer-note">
                  <span className="composer-note-desktop">
                    {finishIntent ? 'Enter 提交本题结论，Shift + Enter 换行。' : 'Enter 发送，Shift + Enter 换行。一次只推进一个关键判断。'}
                  </span>
                  <span className="composer-note-mobile">
                    {finishIntent ? '提交前确认最终答案和关键依据都写清楚。' : '公式可预览，发送前还能继续修改。'}
                  </span>
                </p>
              </div>
            </div>
          </section>
        </div>
      </section>
    </main>
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
