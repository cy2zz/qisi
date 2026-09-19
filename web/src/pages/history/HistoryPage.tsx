import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../../lib/api';
import { StudySidebar } from '../bank/StudySidebar';
import { MathMarkdown } from '../../shared/MathMarkdown';

type Verdict = 'correct' | 'incorrect' | 'unknown' | 'unanswered';
type OriginalStatus =
  | 'in_progress'
  | 'incomplete'
  | 'unknown'
  | 'completed_with_help'
  | 'completed_without_recorded_help';
type HelpMode = 'hint' | 'explain' | 'worked_solution';

interface HistoryEntry {
  assessment: {
    assistance_requested: boolean;
    execution: Verdict;
    help_exposed: boolean;
    independent_task_pass: boolean;
    limitations: string[];
    phase: string;
    planning: Verdict;
    relation: 'near_duplicate' | 'near_transfer';
  } | null;
  help: {
    exposed: boolean;
    modes: HelpMode[];
    requested: boolean;
  };
  latest_student_work_markdown: string | null;
  original_status: OriginalStatus;
  session_id: string;
  title: string;
  topic: string;
  updated_at: string;
}

interface HistoryResponse {
  entries: HistoryEntry[];
  retention: {
    delayed_evidence: 'not_evaluated';
    history_incomplete: boolean;
    session_days: number;
  };
}

const originalLabels: Record<OriginalStatus, string> = {
  completed_with_help: '原题作答有依据，使用过帮助',
  completed_without_recorded_help: '原题作答有依据，未记录帮助',
  incomplete: '原题结论仍需要修正',
  in_progress: '原题还在进行中',
  unknown: '原题证据仍不足',
};

const helpLabels: Record<HelpMode, string> = {
  explain: '局部解释',
  hint: '一点提示',
  worked_solution: '直接讲解',
};

function assessmentLabel(entry: HistoryEntry) {
  const attempt = entry.assessment;
  if (!attempt) return '尚未用新题检验';
  if (attempt.phase !== 'summary') return '独立检验进行中';
  if (attempt.independent_task_pass) return '新题独立完成';
  if (attempt.relation === 'near_duplicate') return '完成近重复练习，不算迁移证据';
  if (attempt.assistance_requested || attempt.help_exposed) return '本次检验使用过帮助';
  if (attempt.planning === 'correct' && attempt.execution === 'incorrect') {
    return '计划有依据，执行需要修正';
  }
  if (attempt.planning === 'correct' && attempt.execution === 'unknown') {
    return '计划有依据，执行证据不足';
  }
  if (attempt.planning === 'unanswered') return '首次计划未作答';
  return '尚未形成独立通过证据';
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '时间待确认'
    : new Intl.DateTimeFormat('zh-CN', {
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        month: 'long',
      }).format(date);
}

export function HistoryPage({ username }: { username: string }) {
  const navigate = useNavigate();
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    apiFetch<HistoryResponse>('/api/history', { signal: controller.signal })
      .then(setHistory)
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
        setError('暂时无法读取学习历史。你的学习记录没有被修改，可以重新读取。');
      });
    return () => controller.abort();
  }, [reloadKey]);

  async function deleteEntry(sessionId: string) {
    setDeleteError('');
    setDeletingSessionId(sessionId);
    try {
      await apiFetch<{ deleted: true }>(`/api/history/sessions/${sessionId}`, {
        body: JSON.stringify({ confirm: true }),
        method: 'DELETE',
      });
      setHistory((current) => current
        ? { ...current, entries: current.entries.filter((entry) => entry.session_id !== sessionId) }
        : current);
      setDeleteTarget(null);
    } catch {
      setDeleteError('删除失败，这条记录没有被修改，可以重试。');
    } finally {
      setDeletingSessionId(null);
    }
  }

  return (
    <main className="study-chat-page history-shell">
      <StudySidebar
        active="history"
        open={sidebarOpen}
        username={username}
        onClose={() => setSidebarOpen(false)}
        onStartNew={() => navigate('/study')}
      />

      <section className="chat-main history-main" aria-label="学习历史">
        <header className="chat-topbar history-topbar">
          <button
            className="chat-mobile-menu"
            type="button"
            aria-label="打开导航"
            onClick={() => setSidebarOpen(true)}
          >
            ☰
          </button>
          <div>
            <strong>学习历史</strong>
            <span>按证据回看，不按分数排名</span>
          </div>
          <span className="history-retention">保存 7 天</span>
        </header>

        <div className="history-scroll">
          <section className="history-heading" aria-labelledby="history-page-title">
            <span>MY LEARNING TRACE / NOT A SCORE</span>
            <h1 id="history-page-title">学习证据时间线</h1>
            <p>回看你当时怎么想、实际看过什么帮助，以及后来能否在新题里独立完成。</p>
          </section>

          {!history && !error ? (
            <div className="history-state" role="status">
              <span aria-hidden="true" />
              正在整理学习记录…
            </div>
          ) : error ? (
            <div className="history-state history-state-error" role="alert">
              <strong>读取失败</strong>
              <p>{error}</p>
              <button type="button" onClick={() => setReloadKey((value) => value + 1)}>
                重新读取
              </button>
            </div>
          ) : history?.entries.length === 0 ? (
            <div className="history-empty">
              <span>EMPTY TRACE</span>
              <h2>还没有可回看的学习记录</h2>
              <p>完成第一次题目分析后，这里会按“思路—帮助—独立检验”保存证据。</p>
              <Link to="/study">开始一道题</Link>
            </div>
          ) : (
            <ol className="history-list" aria-label="学习记录">
              {history?.entries.map((entry, index) => (
                <li key={entry.session_id} className="history-entry">
                  <div className="history-entry-index" aria-hidden="true">
                    <span>{String(index + 1).padStart(2, '0')}</span>
                  </div>
                  <article>
                    <header className="history-entry-header">
                      <div>
                        <p>{formatDate(entry.updated_at)} · {entry.topic || '手动输入'}</p>
                        <h2>{entry.title}</h2>
                      </div>
                      <span data-status={entry.original_status}>{originalLabels[entry.original_status]}</span>
                    </header>

                    <div className="history-evidence-track">
                      <section>
                        <span>01 / STUDENT</span>
                        <h3>我当时怎么想</h3>
                        {entry.latest_student_work_markdown ? (
                          <MathMarkdown content={entry.latest_student_work_markdown} />
                        ) : (
                          <p className="history-neutral">还没有留下可回看的作答。</p>
                        )}
                      </section>
                      <section>
                        <span>02 / HELP</span>
                        <h3>收到的帮助</h3>
                        <p className={entry.help.exposed ? '' : 'history-neutral'}>
                          {entry.help.exposed
                            ? `看过：${entry.help.modes.map((mode) => helpLabels[mode]).join('、')}`
                            : entry.help.requested
                              ? '请求过帮助，但系统未记录实际展示。'
                              : '本系统未记录教学帮助。'}
                        </p>
                      </section>
                      <section>
                        <span>03 / CHECK</span>
                        <h3>后来独立做</h3>
                        <p>{assessmentLabel(entry)}</p>
                        <small>
                          {entry.assessment?.limitations[0]
                            ?? '长期保持情况尚未评估，不据此推断掌握百分比。'}
                        </small>
                      </section>
                    </div>

                    <footer>
                      <button
                        className="history-delete-trigger"
                        type="button"
                        aria-expanded={deleteTarget === entry.session_id}
                        onClick={() => {
                          setDeleteError('');
                          setDeleteTarget(entry.session_id);
                        }}
                      >
                        删除记录
                      </button>
                      <Link to={`/study?session=${entry.session_id}`}>继续原题</Link>
                      <Link to={`/learn/${entry.session_id}/report`}>查看证据报告</Link>
                      <Link className="primary" to={`/learn/${entry.session_id}/check`}>
                        {entry.assessment ? '继续独立检验' : '去独立检验'}
                      </Link>
                    </footer>
                    {deleteTarget === entry.session_id ? (
                      <section
                        className="history-delete-confirm"
                        role="alertdialog"
                        aria-labelledby={`delete-history-${entry.session_id}`}
                      >
                        <div>
                          <strong id={`delete-history-${entry.session_id}`}>删除这条学习记录？</strong>
                          <p>题目记录、作答、帮助和检验数据会一起删除，不能撤销；公开题库不受影响。</p>
                          {deleteError ? <small role="alert">{deleteError}</small> : null}
                        </div>
                        <div>
                          <button
                            type="button"
                            disabled={deletingSessionId === entry.session_id}
                            onClick={() => setDeleteTarget(null)}
                          >
                            保留记录
                          </button>
                          <button
                            className="danger"
                            type="button"
                            disabled={deletingSessionId === entry.session_id}
                            onClick={() => void deleteEntry(entry.session_id)}
                          >
                            {deletingSessionId === entry.session_id ? '正在删除…' : '确认删除'}
                          </button>
                        </div>
                      </section>
                    ) : null}
                  </article>
                </li>
              ))}
            </ol>
          )}

          <footer className="history-boundary">
            <strong>证据边界</strong>
            <p>{history?.retention.history_incomplete
              ? '你删除过记录或有记录已过保存期；现有历史不完整，之后的任务不会仅凭“系统未见过”认定为首次独立证据。'
              : '这里只显示当前账号与保存期限内的记录；外部搜题、其他设备帮助和延迟保持尚无法验证。'}</p>
          </footer>
        </div>
      </section>
    </main>
  );
}
