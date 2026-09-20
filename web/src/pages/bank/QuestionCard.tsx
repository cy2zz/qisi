import { type CSSProperties, useState } from 'react';
import { MathMarkdown } from '../../shared/MathMarkdown';

export interface BankQuestion {
  id: string;
  imageHeight: number | null;
  imageWidth: number | null;
  number: number | null;
  questionCode: string | null;
  questionImageUrl: string | null;
  statementMarkdown: string | null;
  status: string;
}

type StemState = 'error' | 'fallback' | 'loading' | 'missing' | 'ready';

interface QuestionCardProps {
  footerNote?: string;
  highlighted?: boolean;
  onSelect: (question: BankQuestion) => void;
  question: BankQuestion;
  selected?: boolean;
}

export function bankStatusLabel(status: string) {
  if (status === 'ready') return '可练习';
  if (status === 'invalid') return '资料异常';
  return '待核对';
}

export function questionLabel(question: BankQuestion) {
  return question.number === null ? '未编号题目' : `第 ${question.number} 题`;
}

function initialStemState(question: BankQuestion): StemState {
  if (question.questionImageUrl) return 'loading';
  if (question.statementMarkdown?.trim()) return 'ready';
  return 'missing';
}

function isWideQuestionImage(question: BankQuestion) {
  return Boolean(
    question.imageWidth
    && question.imageHeight
    && question.imageWidth / question.imageHeight >= 2,
  );
}

function shouldStartZoomed(question: BankQuestion) {
  return typeof window !== 'undefined'
    && window.innerWidth <= 760
    && isWideQuestionImage(question);
}

function readableImageWidth(question: BankQuestion) {
  if (!question.imageWidth || !question.imageHeight) return 820;
  return Math.min(1200, Math.max(720, Math.round((question.imageWidth / question.imageHeight) * 140)));
}

const stateLabels: Record<StemState, string> = {
  error: '题面需重试',
  fallback: '题面文本可读',
  loading: '题面读取中',
  missing: '题面暂不可用',
  ready: '题面可读',
};

export function QuestionCard({
  footerNote,
  highlighted = false,
  onSelect,
  question,
  selected = false,
}: QuestionCardProps) {
  const [stemState, setStemState] = useState<StemState>(() => initialStemState(question));
  const [retryVersion, setRetryVersion] = useState(0);
  const [zoomed, setZoomed] = useState(() => shouldStartZoomed(question));
  const label = questionLabel(question);
  const hasMarkdown = Boolean(question.statementMarkdown?.trim());
  const selectable = question.status !== 'invalid'
    && (stemState === 'ready' || stemState === 'fallback');
  const effectiveFooterNote = footerNote ?? (
    question.status === 'invalid'
      ? '这道题的题库资料异常，保留可见但不会进入作答'
      : question.status === 'ready'
        ? '仅展示题目，解析未提前显示'
        : '题解依据待核对，选择后会保留这道题而不暗换题'
  );

  function retryImage() {
    setZoomed(shouldStartZoomed(question));
    setStemState('loading');
    setRetryVersion((value) => value + 1);
  }

  return (
    <article
      aria-label={label}
      data-bank-status={question.status}
      data-random-target={highlighted || undefined}
      data-selected={selected || undefined}
      data-stem-state={stemState}
    >
      <header>
        <span className="paper-picker-question-number">{question.number ?? '—'}</span>
        <strong>{label}</strong>
        <span className="paper-bank-question-status" aria-live="polite">
          {selected
            ? '已选择'
            : highlighted
              ? '随机抽中'
              : question.status === 'ready'
                ? stateLabels[stemState]
                : bankStatusLabel(question.status)}
        </span>
      </header>

      <div className="paper-picker-question-content">
        {question.questionImageUrl && stemState !== 'error' && stemState !== 'fallback' ? (
          <figure className="question-stem-figure" data-state={stemState}>
            <div
              className="question-stem-image-scroll"
              data-zoomed={zoomed || undefined}
              data-testid="question-image-scroll"
              style={{
                '--question-readable-width': `${readableImageWidth(question)}px`,
              } as CSSProperties}
            >
              {stemState === 'loading' ? (
                <div className="question-stem-loading" role="status">
                  <span aria-hidden="true" />
                  正在读取题图…
                </div>
              ) : null}
              <img
                key={`${question.questionImageUrl}:${retryVersion}`}
                src={question.questionImageUrl}
                alt={`${label}题目`}
                width={question.imageWidth ?? undefined}
                height={question.imageHeight ?? undefined}
                loading="lazy"
                onLoad={() => setStemState('ready')}
                onError={() => setStemState(hasMarkdown ? 'fallback' : 'error')}
              />
            </div>
            {stemState === 'ready' ? (
              <figcaption>
                <span>
                  {zoomed
                    ? '题面已放大，可左右滑动；需要全貌可切回适合宽度。'
                    : '题面较宽时，可放大后横向滑动阅读。'}
                </span>
                <button
                  type="button"
                  aria-label={`${zoomed ? '适合宽度显示' : '放大阅读'}${label}`}
                  aria-pressed={zoomed}
                  onClick={() => setZoomed((value) => !value)}
                >
                  {zoomed ? '适合宽度' : '放大阅读'}
                </button>
              </figcaption>
            ) : null}
          </figure>
        ) : stemState === 'fallback' && question.statementMarkdown ? (
          <div className="question-stem-fallback">
            <p role="status">原题图暂未加载，已显示可读题干。</p>
            <MathMarkdown content={question.statementMarkdown} />
            <button type="button" onClick={retryImage}>重试原题图</button>
          </div>
        ) : stemState === 'error' ? (
          <div className="question-stem-error" role="alert">
            <strong>题图没有加载成功</strong>
            <p>网络恢复后可原地重试；题面可读前不会进入作答。</p>
            <button type="button" aria-label={`重新加载${label}题图`} onClick={retryImage}>
              重新加载题图
            </button>
          </div>
        ) : question.statementMarkdown ? (
          <MathMarkdown content={question.statementMarkdown} />
        ) : (
          <div className="question-stem-missing" role="status">
            <strong>题面暂不可用</strong>
            <p>这道题没有可读题干或题图，暂时不能选择。</p>
          </div>
        )}
      </div>

      <footer>
        <span>{selected ? '选择已保存到当前链接，刷新后仍会回到这道题' : effectiveFooterNote}</span>
        <button
          type="button"
          disabled={selected || !selectable}
          aria-label={`${selected ? '已选择' : question.status === 'invalid' ? '暂不可选' : '选择'}${label}`}
          onClick={() => onSelect(question)}
        >
          {selected
            ? '已选择'
            : question.status === 'invalid'
              ? '资料异常'
              : stemState === 'loading'
                ? '读取中'
                : '选择'}
        </button>
      </footer>
    </article>
  );
}
