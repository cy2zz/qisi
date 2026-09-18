// 教学页：/learn/:sessionId
//
// 契约来源 B03 write_scope（web/src/pages/learn/SessionPage.tsx）与 server-functions.json
// 的 submitTurn（input=TurnInput, output=StudentView）。
//
// 页面**只渲染 StudentView**：它不知道 Diagnosis、Strategy、Packet 或任何私有对象，
// 因为这些对象不会出现在响应里（contracts/README.md §2 的信任边界）。
// 这一条是结构性的——即便本页面代码写错，也拿不到私有数据可显示。
//
// 依赖（交接项）：初始视图需要 A 的 loadSession（features/session/session-query.service.ts）
// 暴露 `GET /api/session/:id`。该端点尚未交付，因此当前打开页面会显示明确的缺依赖提示，
// 而不是白屏或假装成功。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError, apiFetch } from '@/lib/api';
import { MathMarkdown } from '@/shared/MathMarkdown';

// 与 server/src/contracts/domain.schema.ts 的 StudentView 对齐。前端只读契约，
// 不从这里反推服务端实现。
type Phase = 'preparing' | 'study' | 'check_plan' | 'check_answer' | 'summary';

interface PublicMessage {
  id: string;
  role: 'student' | 'teacher' | 'system';
  text_md: string;
  created_at: string;
}

interface PublicGoal {
  goal_key: string;
  label: string;
  origin: 'student' | 'teacher' | 'coauthored';
  status: string;
}

interface StudentView {
  session_id: string;
  version: number;
  phase: Phase;
  problem: { id: string; source: string; is_official: boolean; statement_md: string; asset_ids: string[]; status: string; issues: string[] };
  active_task_prompt_md: string;
  messages: PublicMessage[];
  current_goal: PublicGoal | null;
  attempt: { id: string; task_id: string; plan_locked: boolean; assistance_requested: boolean; help_exposed: boolean; finished: boolean } | null;
  notice: string;
  allowed_actions: string[];
  run_status: string;
  can_start_check: boolean;
}

/** 服务端动作名到界面的映射。allowed_actions 由服务端按 phase 决定。 */
const ACTION_LABEL: Record<string, string> = {
  attempt: '提交我的这一步',
  hint: '给一点提示',
  explain: '解释这个地方',
  worked_solution: '直接讲完整解法',
  propose_route: '我走的是另一条路',
  skip_goal: '这段我会，跳过',
  finish_problem: '结束这道题',
  save_draft: '暂存',
  submit_plan: '锁定计划',
  finish: '提交最终答案',
  start_check: '开始独立检验',
  retry_preparation: '重试准备',
};

const PHASE_LABEL: Record<Phase, string> = {
  preparing: '准备中',
  study: '学习中',
  check_plan: '独立检验·写计划',
  check_answer: '独立检验·作答',
  summary: '本轮小结',
};

export function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [view, setView] = useState<StudentView | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const requestSequence = useRef(0);

  const loadView = useCallback(
    async (signal: AbortSignal) => {
      if (!sessionId) return;
      try {
        const next = await apiFetch<StudentView>(`/api/session/${encodeURIComponent(sessionId)}`, {
          credentials: 'same-origin',
          signal,
        });
        setView(next);
        setStatus('ready');
      } catch (caught) {
        if (signal.aborted) return;
        setError(describeLoadFailure(caught));
        setStatus('error');
      }
    },
    [sessionId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadView(controller.signal);
    return () => controller.abort();
  }, [loadView]);

  const submit = useCallback(
    async (action: string) => {
      if (!view || !sessionId || pending) return;
      setPending(true);
      setError('');
      const sequence = (requestSequence.current += 1);
      try {
        const next = await apiFetch<StudentView>('/api/tutor/turn', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            expected_version: view.version,
            // request_id 由客户端生成以保证重试幂等：同一动作重发沿用同一 id，
            // 服务端据此回放原安全响应而不重复调用模型。
            request_id: `turn-${sessionId}-${view.version}-${sequence}`,
            action,
            text_md: draft,
            transcript_id: null,
            transcript_revision: null,
          }),
        });
        setView(next);
        setDraft('');
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 409) {
          // 版本冲突：服务端已推进，重新读取而不是盲目重试。
          setError('这一步已被其他操作更新，已为你重新加载最新状态。');
          await loadView(new AbortController().signal);
        } else {
          setError(caught instanceof Error ? caught.message : '提交失败，请重试');
        }
      } finally {
        setPending(false);
      }
    },
    [draft, loadView, pending, sessionId, view],
  );

  const actions = useMemo(() => view?.allowed_actions ?? [], [view]);
  const canType = actions.includes('attempt') || actions.includes('save_draft');

  if (status === 'loading') {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p className="text-slate-500">正在加载会话…</p>
      </main>
    );
  }

  if (status === 'error' || !view) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-lg font-semibold text-slate-800">无法打开这个学习会话</h1>
        <p className="mt-2 text-slate-600">{error}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-6 lg:flex-row">
      {/* 左侧：题目与已有对话。PC 端与演算区并行，H5 重排为单栏。 */}
      <section className="flex-1 space-y-4">
        <header className="flex flex-wrap items-center gap-3">
          <span className="rounded bg-slate-100 px-2 py-0.5 text-sm text-slate-600">{PHASE_LABEL[view.phase]}</span>
          <span className="text-sm text-slate-400">v{view.version}</span>
          {view.problem.is_official ? null : (
            <span className="rounded bg-amber-50 px-2 py-0.5 text-sm text-amber-700">自拟题，非高考真题</span>
          )}
        </header>

        <article className="rounded border border-slate-200 p-4">
          <MathMarkdown content={view.active_task_prompt_md} />
          {view.problem.issues.length > 0 ? (
            <ul className="mt-3 list-disc pl-5 text-sm text-amber-700">
              {view.problem.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </article>

        {view.notice ? (
          <p className="rounded bg-slate-50 p-3 text-sm text-slate-600">{view.notice}</p>
        ) : null}

        <ol className="space-y-3">
          {view.messages.map((message) => (
            <li
              key={message.id}
              className={
                message.role === 'student'
                  ? 'ml-8 rounded border border-slate-200 bg-slate-50 p-3'
                  : 'mr-8 rounded border border-slate-200 p-3'
              }
            >
              <div className="mb-1 text-xs text-slate-400">{message.role === 'student' ? '我' : '老师'}</div>
              <MathMarkdown content={message.text_md} />
            </li>
          ))}
        </ol>
      </section>

      {/* 右侧：当前目标与操作。目标只显示 label，不显示教学策略字段。 */}
      <aside className="w-full space-y-4 lg:w-80">
        {view.current_goal ? (
          <div className="rounded border border-slate-200 p-4">
            <h2 className="text-xs uppercase tracking-wide text-slate-400">当前目标</h2>
            <p className="mt-1 text-slate-800">{view.current_goal.label}</p>
            <p className="mt-1 text-xs text-slate-400">
              来源：{view.current_goal.origin === 'student' ? '我提出' : view.current_goal.origin === 'teacher' ? '老师建议' : '共同确定'}
            </p>
          </div>
        ) : null}

        {canType ? (
          <textarea
            className="h-32 w-full rounded border border-slate-300 p-3 text-sm"
            onChange={(event) => setDraft(event.target.value)}
            placeholder="写下你这一步的思路或计划。可以留空，直接选择下面的动作。"
            value={draft}
          />
        ) : null}

        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <button
              className="rounded border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
              disabled={pending}
              key={action}
              onClick={() => void submit(action)}
              type="button"
            >
              {ACTION_LABEL[action] ?? action}
            </button>
          ))}
        </div>

        {pending ? <p className="text-sm text-slate-500">老师正在看你的这一步…</p> : null}
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      </aside>
    </main>
  );
}

/**
 * 把加载失败翻译成可行动的说明。
 *
 * 404 在当前阶段是预期结果而非异常：loadSession 归 A，尚未交付。
 * 明确说出来，胜过让使用者对着白屏猜测。
 */
function describeLoadFailure(caught: unknown): string {
  if (caught instanceof ApiError && caught.status === 404) {
    return '服务端尚未提供会话读取接口（GET /api/session/:id，归 A 的 loadSession）。这是预期的未完成项，不是你的操作有误。';
  }
  if (caught instanceof ApiError && caught.status === 403) {
    return '当前来源或身份不被接受。请确认 WEB_ORIGIN 配置与访问地址一致，并已通过 /api/auth/login 建立 owner。';
  }
  if (caught instanceof Error) return caught.message;
  return '加载失败。';
}
