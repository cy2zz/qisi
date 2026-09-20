import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../../lib/api';
import { bankStatusLabel, QuestionCard, type BankQuestion } from './QuestionCard';
import {
  focusQuestionAnchor,
  QuestionNavigator,
  questionAnchorId,
} from './QuestionNavigator';
import {
  type BankScope,
  RandomQuestionControl,
  type RandomQuestionSelection,
} from './RandomQuestionControl';
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

interface PaperDetail extends PaperSummary {
  questions: BankQuestion[];
}

interface PaperListResponse {
  papers: PaperSummary[];
  scope?: BankScope;
  total: number;
}

interface PaperFilters {
  keyword: string;
  region: string;
  track: string;
  year: string;
}

function filtersFromSearch(search: string): PaperFilters {
  const query = new URLSearchParams(search);
  return {
    keyword: query.get('keyword') ?? '',
    region: query.get('region') ?? '',
    track: query.get('track') ?? '',
    year: query.get('year') ?? '',
  };
}

function filterQuery(filters: PaperFilters, mode?: 'random') {
  const query = new URLSearchParams();
  if (mode) query.set('mode', mode);
  if (filters.year) query.set('year', filters.year);
  if (filters.region) query.set('region', filters.region);
  if (filters.track) query.set('track', filters.track);
  if (filters.keyword.trim()) query.set('keyword', filters.keyword.trim());
  return query;
}

function filterSearch(filters: PaperFilters, mode?: 'random') {
  const query = filterQuery(filters, mode).toString();
  return query ? `?${query}` : '';
}

function randomSelectionPath(selection: RandomQuestionSelection, filters: PaperFilters) {
  return `/bank/papers/${selection.paper.id}/questions/${selection.question.id}${filterSearch(filters, 'random')}`;
}

function shouldUseCompactPaperBank() {
  return typeof window !== 'undefined' && window.innerWidth <= 720;
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
  const location = useLocation();
  const navigate = useNavigate();
  const routeParams = useParams<{ paperId?: string; questionId?: string }>();
  const routeRandomTarget = useMemo(() => {
    const isRandom = new URLSearchParams(location.search).get('mode') === 'random';
    return isRandom && routeParams.paperId && routeParams.questionId
      ? { paperId: routeParams.paperId, questionId: routeParams.questionId }
      : null;
  }, [location.search, routeParams.paperId, routeParams.questionId]);
  const [filters, setFilters] = useState<PaperFilters>(() => filtersFromSearch(location.search));
  const [options, setOptions] = useState<FilterOptions>({ regions: [], tracks: [], years: [] });
  const [papers, setPapers] = useState<PaperSummary[]>([]);
  const [scope, setScope] = useState<BankScope | null>(null);
  const [randomTarget, setRandomTarget] = useState<{ paperId: string; questionId: string } | null>(
    routeRandomTarget,
  );
  const [selectedPaperId, setSelectedPaperId] = useState(routeParams.paperId ?? '');
  const [paper, setPaper] = useState<PaperDetail | null>(null);
  const [filterPanelOpen, setFilterPanelOpen] = useState(() => !shouldUseCompactPaperBank());
  const [paperPanelOpen, setPaperPanelOpen] = useState(() => !shouldUseCompactPaperBank());
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
        setScope(result.scope ?? null);
        setRandomTarget(routeRandomTarget);
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
  }, [queryString, reloadKey, routeParams.paperId, routeRandomTarget]);

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

  useEffect(() => {
    if (!paper) return;
    const questionId = randomTarget?.paperId === paper.id
      ? randomTarget.questionId
      : routeParams.paperId === paper.id
        ? routeParams.questionId
        : undefined;
    if (!questionId) return;
    const frame = requestAnimationFrame(() => focusQuestionAnchor('paper-bank', questionId));
    return () => cancelAnimationFrame(frame);
  }, [paper, randomTarget, routeParams.paperId, routeParams.questionId]);

  function updateFilter(name: keyof PaperFilters, value: string) {
    const nextFilters = { ...filters, [name]: value };
    setFilters(nextFilters);
    setRandomTarget(null);
    navigate(`/bank${filterSearch(nextFilters)}`, { replace: true });
  }

  function revealRandomQuestion(selection: RandomQuestionSelection) {
    setSelectedPaperId(selection.paper.id);
    setRandomTarget({ paperId: selection.paper.id, questionId: selection.question.id });
    if (shouldUseCompactPaperBank()) setPaperPanelOpen(false);
    navigate(randomSelectionPath(selection, filters), { replace: true });
  }

  function choosePaper(paperId: string) {
    setSelectedPaperId(paperId);
    setRandomTarget(null);
    if (shouldUseCompactPaperBank()) setPaperPanelOpen(false);
    if (routeParams.paperId) navigate(`/bank${filterSearch(filters)}`, { replace: true });
  }

  function confirmQuestion(question: BankQuestion) {
    if (!paper) return;
    setRandomTarget(null);
    navigate(`/bank/papers/${paper.id}/questions/${question.id}${filterSearch(filters)}`);
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

  const selectedPaper = papers.find((item) => item.id === selectedPaperId);
  const activeFilterCount = Object.values(filters).filter((value) => value.trim()).length;

  return (
    <PaperBankShell username={username}>
      <section className="paper-bank-workspace" aria-label="题库选择工作区">
        <details
          className="paper-bank-filter-panel"
          open={filterPanelOpen}
          onToggle={(event) => setFilterPanelOpen(event.currentTarget.open)}
        >
          <summary>
            <span>筛选试卷</span>
            <strong>{activeFilterCount ? `${activeFilterCount} 项条件` : '全部试卷'}</strong>
            <small>{filterPanelOpen ? '收起' : '展开'}</small>
          </summary>
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
        </details>

        <RandomQuestionControl filters={filters} scope={scope} onDraw={revealRandomQuestion} />

        <div className="paper-picker-body paper-bank-picker-body">
          <details
            className="paper-bank-paper-panel"
            open={paperPanelOpen}
            onToggle={(event) => setPaperPanelOpen(event.currentTarget.open)}
          >
            <summary>
              <span>当前试卷</span>
              <strong>{selectedPaper?.title ?? '选择一份试卷'}</strong>
              <small>{papers.length} 份 · {paperPanelOpen ? '收起' : '换卷'}</small>
            </summary>
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
                        {[item.region, item.track, `${item.questionCount} 题`, bankStatusLabel(item.status)]
                          .filter(Boolean)
                          .join(' · ')}
                      </small>
                    </button>
                  </li>
                ))}
              </ol>
            )}
            </aside>
          </details>

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
                <>
                  <QuestionNavigator
                    questions={paper.questions}
                    targetPrefix="paper-bank"
                    highlightedQuestionId={
                      randomTarget?.paperId === paper.id
                        ? randomTarget.questionId
                        : routeParams.paperId === paper.id
                          ? routeParams.questionId
                          : null
                    }
                  />
                  <ol>
                    {paper.questions.map((question) => {
                      const isSelected =
                        routeParams.paperId === paper.id
                        && routeParams.questionId === question.id
                        && routeRandomTarget === null;
                      const isRandomTarget =
                        randomTarget?.paperId === paper.id && randomTarget.questionId === question.id;

                      return (
                        <li key={question.id}>
                          <QuestionCard
                            anchorId={questionAnchorId('paper-bank', question.id)}
                            question={question}
                            highlighted={isRandomTarget}
                            footerNote={isRandomTarget
                              ? '从当前范围随机抽中，核对题面后再选择'
                              : undefined}
                            selected={isSelected}
                            onSelect={confirmQuestion}
                          />
                        </li>
                      );
                    })}
                  </ol>
                </>
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
