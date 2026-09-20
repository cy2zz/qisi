import { apiFetch } from '../../lib/api';

export interface FormattedMathDraft {
  formatted: boolean;
  markdown: string;
}

export function formatMathDraft(text: string) {
  return apiFetch<FormattedMathDraft>('/api/speech/format-math', {
    body: JSON.stringify({ text }),
    method: 'POST',
  });
}
