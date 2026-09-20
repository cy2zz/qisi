import { useEffect, useMemo, useRef, useState } from 'react';
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

interface FilterOptions {
  regions: string[];
  tracks: string[];
  years: number[];
}

export interface PaperSummary {
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

export type PaperQuestion = BankQuestion;

interface PaperDetail extends PaperSummary {
  questions: PaperQuestion[];
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

export interface PaperSelection {
  paper: PaperSummary;
  question: PaperQuestion;
}

interface PaperPickerDialogProps {
  onClose: () => void;
  onSelect: (selection: PaperSelection) => void;
  open: boolean;
}

const EMPTY_FILTERS: PaperFilters = { keyword: '', region: '', track: '', year: '' };

export function PaperPickerDialog({ onClose, onSelect, open }: PaperPickerDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [filters, setFilters] = useState<PaperFilters>(EMPTY_FILTERS);
  const [options, setOptions] = useState<FilterOptions>({ regions: [], tracks: [], years: [] });
  const [papers, setPapers] = useState<PaperSummary[]>([]);
  const [scope, setScope] = useState<BankScope | null>(null);
  const [randomTarget, setRandomTarget] = useState<{ paperId: string; questionId: string } | null>(null);
  const [selectedPaperId, setSelectedPaperId] = useState('');
  const [paper, setPaper] = useState<PaperDetail | null>(null);
  const [isListLoading, setIsListLoading] = useState(false);
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
    if (!open) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button, input, select, a[href], [tabindex]',
        ),
      ).filter((element) => !element.matches(':disabled, [tabindex="-1"]'));
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
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();

    apiFetch<FilterOptions>('/api/bank/filters', { signal: controller.signal })
      .then(setOptions)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setHasError(true);
      });

    return () => controller.abort();
  }, [open, reloadKey]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setIsListLoading(true);
    setHasError(false);

    apiFetch<PaperListResponse>(`/api/bank/papers${queryString}`, { signal: controller.signal })
      .then((result) => {
        setPapers(result.papers);
        setScope(result.scope ?? null);
        setRandomTarget(null);
        setSelectedPaperId((current) =>
          result.papers.some((item) => item.id === current) ? current : (result.papers[0]?.id ?? ''),
        );
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setHasError(true);
      })
      .finally(() => setIsListLoading(false));

    return () => controller.abort();
  }, [open, queryString, reloadKey]);

  useEffect(() => {
    if (!open || !selectedPaperId) {
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
  }, [open, selectedPaperId, reloadKey]);

  useEffect(() => {
    if (!open || !paper || randomTarget?.paperId !== paper.id) return;
    const frame = requestAnimationFrame(() => {
      focusQuestionAnchor('paper-picker', randomTarget.questionId);
    });
    return () => cancelAnimationFrame(frame);
  }, [open, paper, randomTarget]);

  if (!open) return null;

  const selectedSummary = papers.find((item) => item.id === selectedPaperId);

  function updateFilter(name: keyof PaperFilters, value: string) {
    setFilters((current) => ({ ...current, [name]: value }));
  }

  function revealRandomQuestion(selection: RandomQuestionSelection) {
    setSelectedPaperId(selection.paper.id);
    setRandomTarget({ paperId: selection.paper.id, questionId: selection.question.id });
  }

  return (
    <div
      className="paper-picker-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="paper-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="paper-picker-title"
      >
        <header className="paper-picker-header">
          <div>
            <span>QUESTION BANK</span>
            <h2 id="paper-picker-title">从题库选择</h2>
            <p>选一份试卷，再选一道题。解析不会提前显示。</p>
          </div>
          <button ref={closeButtonRef} type="button" aria-label="关闭题库" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="paper-picker-filters" aria-label="筛选试卷">
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

        <RandomQuestionControl filters={filters} scope={scope} onDraw={revealRandomQuestion} />

        {hasError ? (
          <div className="paper-picker-state" role="alert">
            <strong>暂时无法读取题库</strong>
            <p>请确认本地服务和数据库已启动。</p>
            <button type="button" onClick={() => setReloadKey((value) => value + 1)}>重新加载</button>
          </div>
        ) : (
          <div className="paper-picker-body">
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
                        onClick={() => setSelectedPaperId(item.id)}
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
              ) : paper && selectedSummary ? (
                <>
                  <QuestionNavigator
                    questions={paper.questions}
                    targetPrefix="paper-picker"
                    highlightedQuestionId={
                      randomTarget?.paperId === paper.id ? randomTarget.questionId : null
                    }
                  />
                  <ol>
                    {paper.questions.map((question) => (
                      <li key={question.id}>
                        <QuestionCard
                          anchorId={questionAnchorId('paper-picker', question.id)}
                          question={question}
                          highlighted={
                            randomTarget?.paperId === paper.id
                            && randomTarget.questionId === question.id
                          }
                          footerNote={
                            randomTarget?.paperId === paper.id
                            && randomTarget.questionId === question.id
                              ? '从当前范围随机抽中，核对题面后再选择'
                              : undefined
                          }
                          onSelect={(selectedQuestion) => onSelect({
                            paper: selectedSummary,
                            question: selectedQuestion,
                          })}
                        />
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                <p className="paper-picker-empty">选择左侧试卷后，这里会显示题目。</p>
              )}
            </section>
          </div>
        )}
      </section>
    </div>
  );
}
