import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../../lib/api';
import { StudySidebar } from './StudySidebar';

interface StudentPageProps {
  username: string;
}

interface FilterOptions {
  regions: string[];
  tracks: string[];
  years: number[];
}

interface PaperSummary {
  examType: string;
  examYear: number;
  id: string;
  introImageUrl: string | null;
  isOfficial: boolean;
  questionCount: number;
  region: string | null;
  session: string | null;
  status: string;
  subject: string;
  title: string;
  track: string;
  variant: string | null;
}

interface PaperQuestion {
  id: string;
  imageHeight: number | null;
  imageWidth: number | null;
  number: number | null;
  questionCode: string | null;
  questionImageUrl: string | null;
  statementMarkdown: string | null;
  status: string;
}

interface PaperDetail extends PaperSummary {
  questions: PaperQuestion[];
}

interface PaperListResponse {
  papers: PaperSummary[];
  total: number;
}

interface PaperFilters {
  keyword: string;
  region: string;
  track: string;
  year: string;
}

const EMPTY_FILTERS: PaperFilters = { keyword: '', region: '', track: '', year: '' };

function questionLabel(question: PaperQuestion) {
  return question.number === null ? '未编号题目' : `第 ${question.number} 题`;
}

function PaperBankShell({ children, username }: StudentPageProps & { children: ReactNode }) {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <main className="study-chat-page paper-bank-shell">
      <StudySidebar
        active="bank"
        open={sidebarOpen}
        username={username}
        onClose={() => setSidebarOpen(false)}
        onStartNew={() => navigate('/study')}
      />

      <section className="chat-main paper-bank-main" aria-label="题库工作区">
        <header className="chat-topbar paper-bank-topbar">
          <button
            className="chat-mobile-menu"
            type="button"
            aria-label="打开导航"
            onClick={() => setSidebarOpen(true)}
          >
            ☰
          </button>
          <div className="paper-bank-topbar-copy">
            <span>QUESTION BANK</span>
            <h1>从题库选择</h1>
            <p>选一份试卷，再选一道题。解析不会提前显示。</p>
          </div>
        </header>
        <div className="paper-bank-scroll">{children}</div>
      </section>
    </main>
  );
}

export function PaperBankPage({ username }: StudentPageProps) {
  const navigate = useNavigate();
  const routeParams = useParams<{ paperId?: string; questionId?: string }>();
  const [filters, setFilters] = useState<PaperFilters>(EMPTY_FILTERS);
  const [options, setOptions] = useState<FilterOptions>({ regions: [], tracks: [], years: [] });
  const [papers, setPapers] = useState<PaperSummary[]>([]);
  const [selectedPaperId, setSelectedPaperId] = useState(routeParams.paperId ?? '');
  const [paper, setPaper] = useState<PaperDetail | null>(null);
  const [isListLoading, setIsListLoading] = useState(true);
  const [isPaperLoading, setIsPaperLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const queryString = useMemo(() => {
    const query = new URLSearchParams();
    if (filters.year) query.set('year', filters.year);
    if (filters.region) query.set('region', filters.region);
    if (filters.track) query.set('track', filters.track);
    if (filters.keyword.trim()) query.set('keyword', filters.keyword.trim());
    const value = query.toString();
    return value ? `?${value}` : '';
  }, [filters]);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<FilterOptions>('/api/bank/filters', { signal: controller.signal })
      .then((result) => setOptions(result))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setHasError(true);
      });
    return () => controller.abort();
  }, [reloadKey]);

  useEffect(() => {
    const controller = new AbortController();
    setIsListLoading(true);
    setHasError(false);
    apiFetch<PaperListResponse>(`/api/bank/papers${queryString}`, { signal: controller.signal })
      .then((result) => {
        setPapers(result.papers);
        setSelectedPaperId((current) => {
          if (routeParams.paperId && result.papers.some((item) => item.id === routeParams.paperId)) {
            return routeParams.paperId;
          }
          if (result.papers.some((item) => item.id === current)) return current;
          return result.papers[0]?.id ?? '';
        });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setHasError(true);
      })
      .finally(() => setIsListLoading(false));
    return () => controller.abort();
  }, [queryString, reloadKey, routeParams.paperId]);

  useEffect(() => {
    if (!selectedPaperId) {
      setPaper(null);
      return;
    }
    const controller = new AbortController();
    setIsPaperLoading(true);
    apiFetch<PaperDetail>(`/api/bank/papers/${selectedPaperId}`, { signal: controller.signal })
      .then(setPaper)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setHasError(true);
      })
      .finally(() => setIsPaperLoading(false));
    return () => controller.abort();
  }, [selectedPaperId, reloadKey]);

  function updateFilter(name: keyof PaperFilters, value: string) {
    setFilters((current) => ({ ...current, [name]: value }));
    if (routeParams.paperId) navigate('/bank', { replace: true });
  }

  function choosePaper(paperId: string) {
    setSelectedPaperId(paperId);
    if (routeParams.paperId) navigate('/bank', { replace: true });
  }

  function confirmQuestion(question: PaperQuestion) {
    if (!paper) return;
    navigate(`/bank/papers/${paper.id}/questions/${question.id}`);
  }

  if (hasError) {
    return (
      <PaperBankShell username={username}>
        <section className="paper-picker-state paper-bank-state" role="alert">
          <strong>暂时无法读取题库</strong>
          <p>请确认本地服务和数据库已启动。已选条件不会影响题库数据。</p>
          <button type="button" onClick={() => setReloadKey((value) => value + 1)}>
            重新加载
          </button>
        </section>
      </PaperBankShell>
    );
  }

  return (
    <PaperBankShell username={username}>
      <section className="paper-bank-workspace" aria-label="题库选择工作区">
        <div className="paper-picker-filters paper-bank-filters" aria-label="筛选试卷">
          <label>
            <span>年份</span>
            <select value={filters.year} onChange={(event) => updateFilter('year', event.target.value)}>
              <option value="">全部年份</option>
              {options.years.map((year) => <option key={year} value={year}>{year} 年</option>)}
            </select>
          </label>
          <label>
            <span>地区 / 卷种</span>
            <select value={filters.region} onChange={(event) => updateFilter('region', event.target.value)}>
              <option value="">全部地区与卷种</option>
              {options.regions.map((region) => <option key={region} value={region}>{region}</option>)}
            </select>
          </label>
          <label>
            <span>科类</span>
            <select value={filters.track} onChange={(event) => updateFilter('track', event.target.value)}>
              <option value="">全部科类</option>
              {options.tracks.map((track) => <option key={track} value={track}>{track}</option>)}
            </select>
          </label>
          <label className="paper-picker-search">
            <span>关键词</span>
            <input
              type="search"
              value={filters.keyword}
              placeholder="试卷名称"
              onChange={(event) => updateFilter('keyword', event.target.value)}
            />
          </label>
        </div>

        <div className="paper-picker-body paper-bank-picker-body">
          <aside className="paper-picker-papers" aria-label="试卷列表">
            <div className="paper-picker-section-title">
              <strong>试卷</strong>
              <span>{isListLoading ? '读取中' : `${papers.length} 份`}</span>
            </div>
            {isListLoading ? (
              <p className="paper-picker-loading" role="status">正在读取试卷…</p>
            ) : papers.length === 0 ? (
              <p className="paper-picker-empty">没有符合条件的试卷。</p>
            ) : (
              <ol>
                {papers.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-current={item.id === selectedPaperId ? 'true' : undefined}
                      onClick={() => choosePaper(item.id)}
                    >
                      <span>{item.examYear}</span>
                      <strong>{item.title}</strong>
                      <small>
                        {[item.region, item.track, `${item.questionCount} 题`].filter(Boolean).join(' · ')}
                      </small>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </aside>

          <section className="paper-picker-questions" aria-label="试卷内容">
            <div className="paper-picker-section-title">
              <div>
                <strong>{paper?.title ?? '题目'}</strong>
                <small>{paper ? '浏览整份试卷，选择一道题' : '先选择一份试卷'}</small>
              </div>
              <span>{paper ? `${paper.questions.length} 题` : '—'}</span>
            </div>
            {isPaperLoading ? (
              <p className="paper-picker-loading" role="status">正在展开题目…</p>
            ) : paper ? (
              paper.questions.length === 0 ? (
                <p className="paper-picker-empty">这份试卷还没有可选题目。</p>
              ) : (
                <ol>
                  {paper.questions.map((question) => {
                    const isSelected =
                      routeParams.paperId === paper.id && routeParams.questionId === question.id;
                    const hasQuestionContent = Boolean(
                      question.questionImageUrl || question.statementMarkdown,
                    );

                    return (
                      <li key={question.id}>
                        <article
                          aria-labelledby={`paper-bank-question-${question.id}`}
                          data-selected={isSelected || undefined}
                        >
                          <header>
                            <span className="paper-picker-question-number">{question.number ?? '—'}</span>
                            <strong id={`paper-bank-question-${question.id}`}>
                              {questionLabel(question)}
                            </strong>
                            <span className="paper-bank-question-status">
                              {isSelected
                                ? '已选择'
                                : question.status === 'ready'
                                  ? '题图已就绪'
                                  : '待核对'}
                            </span>
                          </header>
                          <div className="paper-picker-question-content">
                            {question.questionImageUrl ? (
                              <img
                                src={question.questionImageUrl}
                                alt={`${questionLabel(question)}题目`}
                                width={question.imageWidth ?? undefined}
                                height={question.imageHeight ?? undefined}
                                loading="lazy"
                              />
                            ) : question.statementMarkdown ? (
                              <p>{question.statementMarkdown}</p>
                            ) : (
                              <p>暂无可用题目内容</p>
                            )}
                          </div>
                          <footer>
                            <span>
                              {isSelected
                                ? '选择已保存到当前链接，刷新后仍会回到这道题'
                                : '仅展示题目，解析未提前显示'}
                            </span>
                            <button
                              type="button"
                              disabled={isSelected || !hasQuestionContent}
                              aria-label={`${isSelected ? '已选择' : '选择'}${questionLabel(question)}`}
                              onClick={() => confirmQuestion(question)}
                            >
                              {isSelected ? '已选择' : '选择'}
                            </button>
                          </footer>
                        </article>
                      </li>
                    );
                  })}
                </ol>
              )
            ) : (
              <p className="paper-picker-empty">选择左侧试卷后，这里会显示题目。</p>
            )}
          </section>
        </div>
      </section>
    </PaperBankShell>
  );
}
