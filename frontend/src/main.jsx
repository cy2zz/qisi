import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import './styles.css';

const introduction = `## 从一道题开始

启思 AI 不直接替学生完成题目，而是通过 **诊断 → 提示 → 回应 → 变式 → 复测**，帮助学生真正掌握知识点。

- 支持 Markdown 与 LaTeX 输入扩展
- 记录正确证据与错误证据
- 保留学生自主选择下一步的权利
`;

function App() {
  const [health, setHealth] = useState('检查中');

  useEffect(() => {
    fetch('/api/health')
      .then((response) => {
        if (!response.ok) throw new Error('请求失败');
        return response.json();
      })
      .then((data) => setHealth(data.status))
      .catch(() => setHealth('后端未启动'));
  }, []);

  return (
    <main className="page">
      <header>
        <span className="brand">启思 AI</span>
        <span className="status">后端状态：{health}</span>
      </header>
      <section className="hero">
        <p className="eyebrow">高中数学思维教练</p>
        <h1>让 AI 帮助学生<br />形成自己的思路。</h1>
        <div className="markdown"><ReactMarkdown>{introduction}</ReactMarkdown></div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
