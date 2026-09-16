import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';

const introduction = `## 从一道题开始

启思 AI 面向高三学生，通过 **诊断 → 提示 → 回应 → 变式 → 复测** 帮助学生形成自己的解题思路。

- 支持文字、公式与后续拍照输入
- 记录正确证据与错误证据
- 允许选择最小提示或直接讲解

示例公式：$a^2+b^2\\ge 2ab$。
`;

interface HealthResponse {
  status: string;
}

export function App() {
  const [health, setHealth] = useState('检查中');

  useEffect(() => {
    const controller = new AbortController();
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '';

    fetch(`${apiBaseUrl}/api/health`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error('Health check failed');
        }
        return response.json() as Promise<HealthResponse>;
      })
      .then((data) => setHealth(data.status))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setHealth('后端未启动');
        }
      });

    return () => controller.abort();
  }, []);

  return (
    <main className="page">
      <header>
        <span className="brand">启思 AI</span>
        <span className="status">后端状态：{health}</span>
      </header>
      <section className="hero">
        <p className="eyebrow">高三数学思维教练</p>
        <h1>
          看见卡点，
          <br />
          形成自己的思路。
        </h1>
        <div className="markdown">
          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
            {introduction}
          </ReactMarkdown>
        </div>
      </section>
    </main>
  );
}
