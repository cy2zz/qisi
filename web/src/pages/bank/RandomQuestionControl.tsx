import { useState } from 'react';
import { apiFetch } from '../../lib/api';
import type { BankQuestion } from './QuestionCard';

export interface BankScope {
  bankVersion: string;
  invalidCount: number;
  needsReviewCount: number;
  paperCount: number;
  readyCount: number;
  selectableCount: number;
  totalCount: number;
  unreadableCount: number;
  updatedAt: string | null;
}

export interface RandomPaperSummary {
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

export interface RandomQuestionSelection {
  paper: RandomPaperSummary;
  question: BankQuestion;
}

interface VisiblePaperFilters {
  keyword: string;
  region: string;
  track: string;
  year: string;
}

interface RandomQuestionResponse {
  requestId: string;
  scope: BankScope;
  selection: RandomQuestionSelection | null;
}

interface RandomQuestionControlProps {
  filters: VisiblePaperFilters;
  onDraw: (selection: RandomQuestionSelection) => void;
  scope: BankScope | null;
}

function scopeLabel(filters: VisiblePaperFilters) {
  const parts = [
    filters.year ? `${filters.year} 年` : '',
    filters.region,
    filters.track,
    filters.keyword.trim() ? `关键词“${filters.keyword.trim()}”` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : '全部试卷';
}

function scopePayload(filters: VisiblePaperFilters) {
  return {
    ...(filters.keyword.trim() ? { keyword: filters.keyword.trim() } : {}),
    ...(filters.region ? { region: filters.region } : {}),
    ...(filters.track ? { track: filters.track } : {}),
    ...(filters.year ? { year: Number(filters.year) } : {}),
  };
}

function versionLabel(scope: BankScope) {
  if (!scope.updatedAt) return '题库尚无可用版本';
  const date = new Date(scope.updatedAt);
  if (Number.isNaN(date.getTime())) return scope.bankVersion;
  return `题库更新 ${date.toLocaleDateString('zh-CN')}`;
}

export function RandomQuestionControl({ filters, onDraw, scope }: RandomQuestionControlProps) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function drawQuestion() {
    if (isDrawing || !scope?.selectableCount) return;
    setIsDrawing(true);
    setNotice(null);
    try {
      const response = await apiFetch<RandomQuestionResponse>('/api/bank/questions/random', {
        body: JSON.stringify({ filters: scopePayload(filters), requestId: crypto.randomUUID() }),
        method: 'POST',
      });
      if (!response.selection) {
        setNotice('当前范围没有可练习题，筛选条件没有改变。');
        return;
      }
      onDraw(response.selection);
      const number = response.selection.question.number === null
        ? '未编号题目'
        : `第 ${response.selection.question.number} 题`;
      setNotice(`已从当前 ${response.scope.selectableCount} 道可练习题中抽中${number}，请核对题面后选择。`);
    } catch {
      setNotice('随机抽题暂时失败，当前筛选条件已保留。');
    } finally {
      setIsDrawing(false);
    }
  }

  const unavailableCount = scope
    ? scope.needsReviewCount + scope.invalidCount + scope.unreadableCount
    : 0;

  return (
    <section className="paper-random-control" aria-label="当前抽题范围">
      <div className="paper-random-copy">
        <span>RANDOM PRACTICE</span>
        <strong>{scopeLabel(filters)}</strong>
        <small>
          {scope
            ? `${scope.selectableCount} 道可练习题 · ${scope.paperCount} 份试卷 · ${versionLabel(scope)}`
            : '正在核对当前题池…'}
        </small>
        {scope && unavailableCount > 0 ? (
          <small className="paper-random-caveat">
            另有 {unavailableCount} 道待核对或题面不完整，本次不参与随机。
          </small>
        ) : null}
      </div>
      <button
        type="button"
        disabled={isDrawing || !scope?.selectableCount}
        onClick={() => void drawQuestion()}
      >
        <span aria-hidden="true">↻</span>
        {isDrawing ? '正在抽取…' : scope?.selectableCount ? '随机抽一道' : '当前范围无可练习题'}
      </button>
      {notice ? <p className="paper-random-notice" role="status">{notice}</p> : null}
    </section>
  );
}
