import { apiFetch } from '../../lib/api';

export interface QuestionImageRecognition {
  answerMarkdown: string | null;
  questionType: string | null;
  stemMarkdown: string;
  uncertain: string[];
}

export interface QuestionImageRecognitionResult {
  image: { height: number; width: number };
  recognition: QuestionImageRecognition;
}

export function recognizeQuestionImage(file: File) {
  return apiFetch<QuestionImageRecognitionResult>('/api/media/recognize-question', {
    body: file,
    headers: { 'Content-Type': file.type },
    method: 'POST',
  });
}

export function recognitionToMarkdown(recognition: QuestionImageRecognition) {
  return [
    recognition.questionType ? `**题型：** ${recognition.questionType}` : null,
    recognition.stemMarkdown,
    recognition.answerMarkdown
      ? `**图片中可见答案或解答：**\n\n${recognition.answerMarkdown}`
      : null,
  ].filter((part): part is string => Boolean(part)).join('\n\n');
}
