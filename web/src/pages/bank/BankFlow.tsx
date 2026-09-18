import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { apiFetch, apiStream } from '../../lib/api';
import { MathMarkdown } from '../../shared/MathMarkdown';
import { RichComposer, type RichComposerHandle } from './RichComposer';
import {
  FIXTURE_BANK_VERSION,
  fixtureProblems,
  fixtureSessionId,
  getFixtureProblem,
  problemIdFromFixtureSession,
} from './fixture-bank';

interface StudentPageProps {
  username: string;
}

interface ConversationMessage {
  analysis?: ProblemAnalysis;
  content: string;
  history?: ProblemChatMessage[];
  id: string;
  request?: string;
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

interface SessionRecord {
  content: string;
  id: string;
  title: string;
  topic: string;
}

const formulaShortcuts = [
  { label: '分式', name: '插入分式', syntax: '$\\frac{}{}$' },
  { label: '根式', name: '插入根式', syntax: '$\\sqrt{}$' },
  { label: '上标', name: '插入上标', syntax: '$x^{}$' },
  { label: '下标', name: '插入下标', syntax: '$x_{}$' },
  { label: '积分', name: '插入积分', syntax: '$\\int_{}^{}$' },
  { label: '极限', name: '插入极限', syntax: '$\\lim_{x\\to }$' },
];

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
  const analysisRequestRef = useRef(0);
  const chatAbortRef = useRef<AbortController | null>(null);
  const chatRequestRef = useRef(0);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const composerFormRef = useRef<HTMLFormElement>(null);
  const composerRef = useRef<RichComposerHandle>(null);
  const [activeRecord, setActiveRecord] = useState<SessionRecord | null>(null);
  const [bankOpen, setBankOpen] = useState(false);
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [hasProblem, setHasProblem] = useState(false);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [records, setRecords] = useState<SessionRecord[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [isReplying, setIsReplying] = useState(false);

  useEffect(() => {
    const scrollArea = chatScrollRef.current;
    if (scrollArea) scrollArea.scrollTop = scrollArea.scrollHeight;
  }, [messages]);

  function rememberRecord(record: SessionRecord) {
    setRecords((current) => [record, ...current.filter((item) => item.id !== record.id)]);
  }

  async function analyzeProblem(record: SessionRecord, requestNumber: number) {
    const analysisMessageId = `analysis-${record.id}`;

    try {
      const result = await apiFetch<{ analysis: ProblemAnalysis }>('/api/problems/analyze', {
        body: JSON.stringify({ problemMd: record.content }),
        method: 'POST',
      });
      if (analysisRequestRef.current !== requestNumber) return;

      setMessages((current) =>
        current.map((message) =>
          message.id === analysisMessageId
            ? {
                analysis: result.analysis,
                content: result.analysis.overview,
                id: analysisMessageId,
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
    chatAbortRef.current?.abort();
    chatRequestRef.current += 1;
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
    setBankOpen(false);
    setFormulaOpen(false);
    setSidebarOpen(false);
    void analyzeProblem(record, requestNumber);
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  function chooseProblem(problemId: string) {
    const problem = getFixtureProblem(problemId);
    if (!problem) return;

    beginConversation({
      content: problem.statementMd,
      id: problem.id,
      title: `${problem.number} · ${problem.topic}`,
      topic: '本地演示题',
    });
  }

  function openLocalBank() {
    setBankOpen(true);
    setFormulaOpen(false);
    setSidebarOpen(false);
  }

  function startNewProblem() {
    chatAbortRef.current?.abort();
    chatRequestRef.current += 1;
    analysisRequestRef.current += 1;
    setActiveRecord(null);
    setMessages([]);
    setHasProblem(false);
    composerRef.current?.clear();
    setBankOpen(false);
    setFormulaOpen(false);
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
  ) {
    if (!activeRecord) return;

    chatAbortRef.current?.abort();
    const abortController = new AbortController();
    chatAbortRef.current = abortController;
    const requestNumber = ++chatRequestRef.current;
    setIsReplying(true);
    setMessages((current) =>
      current.map((message) =>
        message.id === guideMessageId
          ? { ...message, content: '正在核对你的这一步', state: 'reply-loading' }
          : message,
      ),
    );

    try {
      await apiStream(
        '/api/problems/chat',
        { history, message: studentMessage, problemMd: activeRecord.content },
        (event) => {
          if (chatRequestRef.current !== requestNumber) return;
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
              if (event.type === 'done') return { ...message, state: 'reply' };
              return { ...message, content: event.message, state: 'error' };
            }),
          );
        },
        abortController.signal,
      );
    } catch {
      if (abortController.signal.aborted || chatRequestRef.current !== requestNumber) return;
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
        setIsReplying(false);
        requestAnimationFrame(() => composerRef.current?.focus());
      }
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
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
    const history = visibleChatHistory();
    setMessages((current) => [
      ...current,
      { content, id: messageId, role: 'student' },
      {
        content: '正在核对你的这一步',
        history,
        id: guideMessageId,
        request: content,
        role: 'guide',
        state: 'reply-loading',
      },
    ]);
    composerRef.current?.clear();
    void requestReply(guideMessageId, content, history);
  }

  function insertFormula(syntax: string) {
    composerRef.current?.insertText(syntax);
  }

  return (
    <main className="study-chat-page">
      <button
        className="chat-sidebar-backdrop"
        type="button"
        aria-label="关闭导航遮罩"
        data-open={sidebarOpen}
        onClick={() => setSidebarOpen(false)}
      />

      <aside className="chat-sidebar" data-open={sidebarOpen}>
        <div className="chat-sidebar-top">
          <div className="chat-brand-row">
            <Link className="chat-brand" to="/bank" aria-label="启思 AI 学习空间">
              <span aria-hidden="true">Q</span>
              <strong>启思 AI</strong>
            </Link>
            <button
              className="chat-sidebar-close"
              type="button"
              aria-label="关闭导航"
              onClick={() => setSidebarOpen(false)}
            >
              ×
            </button>
          </div>

          <button className="new-problem-button" type="button" onClick={startNewProblem}>
            <span aria-hidden="true">＋</span>
            开始新题
          </button>

          <nav className="chat-nav" aria-label="学习导航">
            <button className="chat-nav-item is-active" type="button" onClick={() => setSidebarOpen(false)}>
              <span aria-hidden="true">◫</span>
              当前对话
            </button>
            <button className="chat-nav-item" type="button" onClick={openLocalBank}>
              <span aria-hidden="true">▤</span>
              本地题库
            </button>
          </nav>
        </div>

        <section className="chat-history" aria-labelledby="history-title">
          <div className="chat-history-heading">
            <h2 id="history-title">做题记录</h2>
            <span>当前页面</span>
          </div>
          {records.length === 0 ? (
            <p className="chat-history-empty">还没有记录。输入或选择一道题后会显示在这里。</p>
          ) : (
            <ul>
              {records.map((record) => (
                <li key={record.id}>
                  <button type="button" onClick={() => beginConversation(record)}>
                    <span>{record.title}</span>
                    <small>{record.topic} · 刚刚</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="chat-profile" aria-label={`当前用户：${username}`}>
          <span aria-hidden="true">{username.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{username}</strong>
            <small>高三数学</small>
          </div>
        </div>
      </aside>

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
            <span>{hasProblem ? '本次记录仅保存在当前页面' : '输入题目，或从本地题库选择'}</span>
          </div>
          <span className="fixture-chip">开发夹具</span>
        </header>

        <div className="chat-scroll" ref={chatScrollRef}>
          <div className="chat-content">
            {messages.length === 0 ? (
              <section className="chat-empty" aria-labelledby="chat-empty-title">
                <span className="chat-empty-mark" aria-hidden="true">∑</span>
                <h1 id="chat-empty-title">今天想解决哪道题？</h1>
                <p>直接输入题目，支持 Markdown 和 LaTeX；也可以从本地演示题库里选择。</p>
                <button type="button" onClick={openLocalBank}>
                  从本地题库选择
                  <span aria-hidden="true">→</span>
                </button>
              </section>
            ) : (
              <section className="conversation" aria-label="当前对话" aria-live="polite">
                {messages.map((message) => (
                  <article className={`chat-message chat-message-${message.role}`} key={message.id}>
                    <span className="chat-message-avatar" aria-hidden="true">
                      {message.role === 'student' ? username.slice(0, 1).toUpperCase() : 'Q'}
                    </span>
                    <div>
                      <strong>{message.role === 'student' ? '你' : '启思'}</strong>
                      {message.analysis ? (
                        <section className="problem-analysis" aria-labelledby={`${message.id}-title`}>
                          <h2 id={`${message.id}-title`}>题目分析</h2>
                          <p>{message.analysis.overview}</p>
                          <div className="analysis-tags" aria-label="相关知识点">
                            {message.analysis.knowledgePoints.map((point) => (
                              <span key={point}>{point}</span>
                            ))}
                          </div>
                          <dl>
                            <div>
                              <dt>关键条件</dt>
                              <dd>{message.analysis.keyConditions.join('；')}</dd>
                            </div>
                            <div>
                              <dt>目标</dt>
                              <dd>{message.analysis.target}</dd>
                            </div>
                          </dl>
                          <div className="analysis-first-question">
                            <span>先想一步</span>
                            <p>{message.analysis.firstQuestion}</p>
                          </div>
                        </section>
                      ) : message.state === 'reply-loading' ? (
                        <span className="analysis-loading" role="status">
                          <i aria-hidden="true" />
                          {message.content}
                        </span>
                      ) : message.state === 'reply-streaming' ? (
                        <p className="streaming-reply">
                          {message.content}
                          <span aria-hidden="true" />
                        </p>
                      ) : (
                        <MathMarkdown content={message.content} />
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
                            requestReply(message.id, message.request!, message.history!)
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
            {bankOpen && (
              <section className="local-bank-panel" role="dialog" aria-label="本地题库">
                <header>
                  <div>
                    <strong>选择一道题</strong>
                    <span>{FIXTURE_BANK_VERSION} · 自拟演示夹具</span>
                  </div>
                  <button type="button" aria-label="关闭本地题库" onClick={() => setBankOpen(false)}>
                    ×
                  </button>
                </header>
                <div className="local-bank-list">
                  {fixtureProblems.map((problem) => (
                    <button
                      type="button"
                      key={problem.id}
                      aria-label={`选择 ${problem.number} ${problem.topic}`}
                      onClick={() => chooseProblem(problem.id)}
                    >
                      <span>{problem.number}</span>
                      <div>
                        <strong>{problem.topic}</strong>
                        <MathMarkdown content={problem.statementMd} />
                      </div>
                      <span aria-hidden="true">→</span>
                    </button>
                  ))}
                </div>
                <p>当前仅有三道自拟夹具，不代表正式题库，也不会在浏览器内随机冒充服务端选题。</p>
              </section>
            )}

            {formulaOpen && (
              <div className="formula-toolbar" aria-label="公式快捷输入">
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
            )}

            {draft.includes('$') && (
              <div className="composer-preview" aria-label="公式预览">
                <span>预览</span>
                <MathMarkdown content={draft} />
              </div>
            )}

            <form ref={composerFormRef} className="chat-composer" onSubmit={handleSubmit}>
              <RichComposer
                ref={composerRef}
                placeholder={hasProblem ? '写下你的想法、步骤或公式…' : '输入一道数学题…'}
                onChange={setDraft}
                onSubmit={() => composerFormRef.current?.requestSubmit()}
              />
              <div className="composer-actions">
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      setBankOpen((current) => !current);
                      setFormulaOpen(false);
                    }}
                  >
                    <span aria-hidden="true">▤</span>
                    题库
                  </button>
                  <button
                    type="button"
                    aria-expanded={formulaOpen}
                    onClick={() => {
                      setFormulaOpen((current) => !current);
                      setBankOpen(false);
                    }}
                  >
                    <span aria-hidden="true">∑</span>
                    公式
                  </button>
                </div>
                <button
                  className="composer-send"
                  type="submit"
                  disabled={!draft.trim() || isReplying}
                  aria-label={isReplying ? '等待回复' : '发送'}
                >
                  ↑
                </button>
              </div>
            </form>
            <p className="composer-note">Enter 发送，Shift + Enter 换行。回复校验通过后才会流式显示；当前对话尚未保存。</p>
          </div>
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
