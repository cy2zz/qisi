import { useEffect, useState } from 'react';
import { type BankQuestion, questionLabel } from './QuestionCard';

interface QuestionNavigatorProps {
  highlightedQuestionId?: string | null;
  questions: BankQuestion[];
  targetPrefix: string;
}

export function questionAnchorId(targetPrefix: string, questionId: string) {
  return `${targetPrefix}-question-${questionId}`;
}

export function focusQuestionAnchor(targetPrefix: string, questionId: string) {
  const target = document.getElementById(questionAnchorId(targetPrefix, questionId));
  if (!target) return;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  target.scrollIntoView?.({
    behavior: reducedMotion ? 'auto' : 'smooth',
    block: 'start',
  });
  target.focus({ preventScroll: true });
}

export function QuestionNavigator({
  highlightedQuestionId,
  questions,
  targetPrefix,
}: QuestionNavigatorProps) {
  const [currentQuestionId, setCurrentQuestionId] = useState<string | null>(
    highlightedQuestionId ?? null,
  );

  useEffect(() => {
    setCurrentQuestionId(highlightedQuestionId ?? null);
  }, [highlightedQuestionId, questions, targetPrefix]);

  if (questions.length <= 1) return null;

  return (
    <nav className="paper-question-navigator" aria-label="题号导航">
      <span>快速定位</span>
      <div>
        {questions.map((question) => {
          const label = questionLabel(question);
          return (
            <button
              type="button"
              key={question.id}
              aria-current={currentQuestionId === question.id ? 'location' : undefined}
              aria-label={`跳到${label}`}
              data-status={question.status}
              onClick={() => {
                setCurrentQuestionId(question.id);
                focusQuestionAnchor(targetPrefix, question.id);
              }}
            >
              {question.number ?? '—'}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
