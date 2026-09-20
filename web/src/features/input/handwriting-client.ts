import { apiFetch } from '../../lib/api';

export interface TranscriptLine {
  explicitly_confirmed: boolean;
  index: number;
  text: string;
  uncertain: boolean;
}

export interface TranscriptDraft {
  confirmed: boolean;
  id: string;
  lines: TranscriptLine[];
  media_id: string;
  revision: number;
}

export interface HandwritingResult {
  image: { height: number; mediaId: string; url: string; width: number };
  transcript: TranscriptDraft;
}

export function transcribeHandwriting(file: File, sessionId: string) {
  return apiFetch<HandwritingResult>(
    `/api/media/handwriting?sessionId=${encodeURIComponent(sessionId)}`,
    {
      body: file,
      headers: { 'Content-Type': file.type },
      method: 'POST',
    },
  );
}

export function confirmHandwriting(draft: TranscriptDraft) {
  return apiFetch<TranscriptDraft>(`/api/media/transcripts/${draft.id}/confirm`, {
    body: JSON.stringify({
      expected_revision: draft.revision,
      lines: draft.lines,
      request_id: crypto.randomUUID(),
      transcript_id: draft.id,
    }),
    method: 'PATCH',
  });
}

export function transcriptToMarkdown(lines: TranscriptLine[]) {
  return lines.map((line) => line.text.trim()).filter(Boolean).join('\n\n');
}
