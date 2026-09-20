import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { recognizeQuestionImage, recognitionToMarkdown } from './image-question-client';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const supportedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

type ImageInputState = 'error' | 'idle' | 'loading' | 'review';

export interface ImageQuestionInputHandle {
  clear: () => void;
  openFilePicker: () => void;
  selectFile: (file: File) => void;
}

interface ImageQuestionInputProps {
  disabled?: boolean;
  onRecognized: (markdown: string, autoSubmit: boolean) => void;
}

export const ImageQuestionInput = forwardRef<ImageQuestionInputHandle, ImageQuestionInputProps>(
  function ImageQuestionInput({ disabled = false, onRecognized }, forwardedRef) {
    const inputRef = useRef<HTMLInputElement>(null);
    const requestRef = useRef(0);
    const [file, setFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [state, setState] = useState<ImageInputState>('idle');
    const [status, setStatus] = useState('');
    const [uncertainDetails, setUncertainDetails] = useState<string[]>([]);

    function clear() {
      requestRef.current += 1;
      setFile(null);
      setState('idle');
      setStatus('');
      setUncertainDetails([]);
      if (inputRef.current) inputRef.current.value = '';
    }

    function selectFile(nextFile: File) {
      requestRef.current += 1;
      if (!supportedTypes.has(nextFile.type) || nextFile.size > MAX_IMAGE_BYTES) {
        setFile(null);
        setState('error');
        setStatus('只支持 8MB 以内的 JPEG、PNG 或 WebP 图片');
        setUncertainDetails([]);
        return;
      }
      setFile(nextFile);
      setState('idle');
      setStatus('图片已加入，点击识别后会提取题干并开始分析');
      setUncertainDetails([]);
    }

    useEffect(() => {
      if (!file || typeof URL.createObjectURL !== 'function') {
        setPreviewUrl(null);
        return;
      }
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }, [file]);

    useImperativeHandle(forwardedRef, () => ({
      clear,
      openFilePicker() {
        if (!disabled) inputRef.current?.click();
      },
      selectFile,
    }));

    async function handleRecognize() {
      if (!file || disabled || state === 'loading') return;
      const requestNumber = ++requestRef.current;
      setState('loading');
      setStatus('正在识别题型、题干和图片中可见答案…');
      try {
        const result = await recognizeQuestionImage(file);
        if (requestRef.current !== requestNumber) return;
        const requiresReview = result.recognition.uncertain.length > 0;
        onRecognized(recognitionToMarkdown(result.recognition), !requiresReview);
        if (requiresReview) {
          setState('review');
          setStatus(`有 ${result.recognition.uncertain.length} 处内容不确定，已放入输入框，请核对后发送`);
          setUncertainDetails(result.recognition.uncertain);
        } else {
          clear();
        }
      } catch {
        if (requestRef.current !== requestNumber) return;
        setState('error');
        setStatus('图片识别失败，原图仍在，可以重试');
        setUncertainDetails([]);
      }
    }

    return (
      <div className="image-question-input" data-state={state}>
        <input
          ref={inputRef}
          hidden
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-label="选择题目图片"
          onChange={(event) => {
            const nextFile = event.target.files?.[0];
            if (nextFile) selectFile(nextFile);
          }}
        />
        {file && (
          <div className="image-question-card">
            {previewUrl && <img src={previewUrl} alt="待识别题目图片预览" />}
            <div>
              <strong>{file.name || '粘贴的题目图片'}</strong>
              <span>{Math.max(1, Math.round(file.size / 1024))} KB · 原图仅用于本次识别</span>
              <p role="status">{status}</p>
              {uncertainDetails.length > 0 && (
                <ul aria-label="待确认内容">
                  {uncertainDetails.map((detail) => <li key={detail}>{detail}</li>)}
                </ul>
              )}
            </div>
            <div>
              <button type="button" disabled={disabled || state === 'loading' || state === 'review'} onClick={() => void handleRecognize()}>
                {state === 'loading' ? '识别中…' : state === 'error' ? '重新识别' : '识别并开始分析'}
              </button>
              <button type="button" disabled={state === 'loading'} onClick={clear}>移除</button>
            </div>
          </div>
        )}
        {!file && status && <p className="image-question-error" role="alert">{status}</p>}
      </div>
    );
  },
);
