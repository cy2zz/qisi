import { Link } from 'react-router-dom';

export interface StudyRecord {
  content: string;
  id: string;
  problemMd?: string;
  questionId?: string;
  recognitionUncertain?: string[];
  title: string;
  topic: string;
  updatedAt?: string;
  version?: number;
}

interface StudySidebarProps {
  active: 'bank' | 'chat' | 'history';
  onClose: () => void;
  onSelectRecord?: (record: StudyRecord) => void;
  onStartNew: () => void;
  open: boolean;
  records?: StudyRecord[];
  username: string;
}

export function StudySidebar({
  active,
  onClose,
  onSelectRecord,
  onStartNew,
  open,
  records = [],
  username,
}: StudySidebarProps) {
  return (
    <>
      <button
        className="chat-sidebar-backdrop"
        type="button"
        aria-label="关闭导航遮罩"
        data-open={open}
        onClick={onClose}
      />

      <aside className="chat-sidebar" data-open={open}>
        <div className="chat-sidebar-top">
          <div className="chat-brand-row">
            <Link className="chat-brand" to="/study" aria-label="启思 AI 学习空间">
              <span aria-hidden="true">Q</span>
              <strong>启思 AI</strong>
            </Link>
            <button
              className="chat-sidebar-close"
              type="button"
              aria-label="关闭导航"
              onClick={onClose}
            >
              ×
            </button>
          </div>

          <button className="new-problem-button" type="button" onClick={onStartNew}>
            <span aria-hidden="true">＋</span>
            开始新题
          </button>

          <nav className="chat-nav" aria-label="学习导航">
            <Link
              className={`chat-nav-item${active === 'chat' ? ' is-active' : ''}`}
              to="/study"
              aria-current={active === 'chat' ? 'page' : undefined}
              onClick={onClose}
            >
              <span aria-hidden="true">◫</span>
              当前对话
            </Link>
            <Link
              className={`chat-nav-item${active === 'bank' ? ' is-active' : ''}`}
              to="/bank"
              aria-current={active === 'bank' ? 'page' : undefined}
              onClick={onClose}
            >
              <span aria-hidden="true">▤</span>
              题库
            </Link>
            <Link
              className={`chat-nav-item${active === 'history' ? ' is-active' : ''}`}
              to="/history"
              aria-current={active === 'history' ? 'page' : undefined}
              onClick={onClose}
            >
              <span aria-hidden="true">⌁</span>
              学习历史
            </Link>
          </nav>
        </div>

        <section className="chat-history" aria-labelledby="history-title">
          <div className="chat-history-heading">
            <h2 id="history-title">做题记录</h2>
            <span>{active === 'chat' ? '自动保存' : '学习历史'}</span>
          </div>
          {active === 'history' ? (
            <p className="chat-history-empty">
              记录保留学生思路、实际帮助和后续检验，不换算掌握百分比。
            </p>
          ) : records.length === 0 ? (
            <p className="chat-history-empty">
              {active === 'bank'
                ? '返回当前对话查看本页记录。'
                : '还没有记录。输入或选择一道题后会显示在这里。'}
            </p>
          ) : (
            <ul>
              {records.map((record) => (
                <li key={record.id}>
                  <button type="button" onClick={() => onSelectRecord?.(record)}>
                    <span>{record.title}</span>
                    <small>
                      {record.topic || '手动输入'} · {record.updatedAt ? '已保存' : '刚刚'}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="chat-profile" aria-label={`当前用户：${username}`}>
          <span aria-hidden="true">{username.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{username}</strong>
            <small>高三数学</small>
          </div>
        </div>
      </aside>
    </>
  );
}
