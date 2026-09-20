import { lazy, Suspense, type FormEvent, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { ApiError, apiFetch } from './lib/api';

const BankPage = lazy(async () => ({
  default: (await import('./pages/bank/BankFlow')).BankPage,
}));
// B03 的教学页：走四角色受控链路（Diagnosis → Strategy → PolicyGate → Renderer → Guard），
// 只渲染 StudentView 白名单投影。取代此前的占位组件 FixtureLearningPage
// （其输入框与提交按钮均为 disabled，页面自述「提交功能尚未接入」）。
const SessionPage = lazy(async () => ({
  default: (await import('./pages/learn/SessionPage')).SessionPage,
}));
const PreparePage = lazy(async () => ({
  default: (await import('./pages/bank/BankFlow')).PreparePage,
}));
const PaperBankPage = lazy(async () => ({
  default: (await import('./pages/bank/PaperBankPage')).PaperBankPage,
}));
const HistoryPage = lazy(async () => ({
  default: (await import('./pages/history/HistoryPage')).HistoryPage,
}));
const AssessmentCheckPage = lazy(async () => ({
  default: (await import('./pages/learn/check/AssessmentCheckPage')).AssessmentCheckPage,
}));
const ReportPage = lazy(async () => ({
  default: (await import('./pages/learn/report/ReportPage')).ReportPage,
}));

interface User {
  id: string;
  username: string;
}

interface AuthResponse {
  user: User;
}

type AuthState =
  | { status: 'checking' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: User };

export function App() {
  const navigate = useNavigate();
  const [auth, setAuth] = useState<AuthState>({ status: 'checking' });
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    apiFetch<AuthResponse>('/api/auth/me', { signal: controller.signal })
      .then(({ user }) => setAuth({ status: 'authenticated', user }))
      .catch((requestError: unknown) => {
        if (!(requestError instanceof DOMException && requestError.name === 'AbortError')) {
          setAuth({ status: 'anonymous' });
        }
      });

    return () => controller.abort();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const result = await apiFetch<AuthResponse>('/api/auth/login', {
        body: JSON.stringify({ username }),
        method: 'POST',
      });
      setAuth({ status: 'authenticated', user: result.user });
      navigate('/study', { replace: true });
    } catch (requestError) {
      setError(
        requestError instanceof ApiError && requestError.status === 400
          ? '用户名可使用中文、字母、数字、下划线或连字符，最多 32 个字符。'
          : '暂时无法登录，请检查网络后再试。',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (auth.status === 'checking') {
    return <LoginPage authStatus="checking" />;
  }

  if (auth.status === 'anonymous') {
    return (
      <Routes>
        <Route
          path="/"
          element={
            <LoginPage
              authStatus="anonymous"
              error={error}
              isSubmitting={isSubmitting}
              onSubmit={handleSubmit}
              onUsernameChange={setUsername}
              username={username}
            />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route path="/" element={<Navigate to="/study" replace />} />
        <Route path="/bank" element={<PaperBankPage username={auth.user.username} />} />
        <Route
          path="/bank/papers/:paperId/questions/:questionId"
          element={<PaperBankPage username={auth.user.username} />}
        />
        <Route path="/study" element={<BankPage username={auth.user.username} />} />
        <Route path="/history" element={<HistoryPage username={auth.user.username} />} />
        <Route
          path="/bank/prepare/:problemId"
          element={<PreparePage username={auth.user.username} />}
        />
        <Route
          path="/learn/:sessionId"
          element={<SessionPage />}
        />
        <Route
          path="/learn/:sessionId/check"
          element={<AssessmentCheckPage username={auth.user.username} />}
        />
        <Route
          path="/learn/:sessionId/report"
          element={<ReportPage username={auth.user.username} />}
        />
        <Route path="*" element={<Navigate to="/study" replace />} />
      </Routes>
    </Suspense>
  );
}

function RouteLoading() {
  return (
    <main className="route-loading" aria-busy="true">
      <div className="auth-loading" role="status">
        <span className="loading-mark" aria-hidden="true" />
        正在打开学习空间…
      </div>
    </main>
  );
}

interface LoginPageProps {
  authStatus: 'anonymous' | 'checking';
  error?: string;
  isSubmitting?: boolean;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  onUsernameChange?: (username: string) => void;
  username?: string;
}

function LoginPage({
  authStatus,
  error = '',
  isSubmitting = false,
  onSubmit,
  onUsernameChange,
  username = '',
}: LoginPageProps) {
  return (
    <main className="login-page">
      <header className="topbar">
        <Link className="wordmark" to="/" aria-label="启思 AI 首页">
          <span className="wordmark-mark" aria-hidden="true">
            Q
          </span>
          <span>启思 AI</span>
        </Link>
        <span className="topbar-note">高三数学 · 思路训练</span>
      </header>

      <div className="login-layout">
        <section className="login-intro" aria-labelledby="login-title">
          <p className="section-code">QISI / STUDY SPACE</p>
          <h1 id="login-title">
            把今天的思路，
            <span>留在这里。</span>
          </h1>
          <p className="intro-copy">
            启思记录的不只是答案对错，还有你如何开始、哪一步遇到困难，以及没有提示时能否独立完成。
          </p>

          <div className="thought-track" aria-hidden="true">
            <span className="track-line" />
            <div className="track-item track-item-active">
              <span>01</span>
              <p>先写自己的想法</p>
            </div>
            <div className="track-item">
              <span>02</span>
              <p>只处理真正的卡点</p>
            </div>
            <div className="track-item">
              <span>03</span>
              <p>换一道题独立验证</p>
            </div>
          </div>

          <figure className="math-field">
            <figcaption className="math-field-copy">
              <span className="math-field-index">今日数学坐标</span>
              <strong>先观察，再推导</strong>
              <p>从图像、变化与关键点开始，让每一笔都有依据。</p>
              <div className="math-equation" role="img" aria-label="f 撇 x 零等于零">
                <span aria-hidden="true">f′(x₀) = 0</span>
              </div>
            </figcaption>

            <svg
              className="function-sketch"
              viewBox="0 0 300 160"
              role="img"
              aria-label="函数图像与切线示意"
            >
              <g className="graph-grid" aria-hidden="true">
                <path d="M30 12V148M70 12V148M110 12V148M150 12V148M190 12V148M230 12V148M270 12V148" />
                <path d="M12 28H288M12 62H288M12 96H288M12 130H288" />
              </g>
              <g className="graph-axis" aria-hidden="true">
                <path d="M18 124H288" />
                <path d="M43 148V14" />
                <path d="m283 120 5 4-5 4M39 19l4-5 4 5" />
              </g>
              <path
                className="graph-curve"
                d="M22 116C46 112 59 98 76 70C96 37 119 30 141 55C159 76 168 102 190 106C215 111 235 86 249 58C259 38 271 29 286 28"
                aria-hidden="true"
              />
              <path className="graph-tangent" d="M70 42H151" aria-hidden="true" />
              <g className="graph-focus" aria-hidden="true">
                <circle cx="110" cy="42" r="5" />
                <path d="M110 42V124" />
              </g>
              <g className="graph-labels" aria-hidden="true">
                <text x="253" y="47">f(x)</text>
                <text x="116" y="142">x₀</text>
                <text x="126" y="35">切线</text>
              </g>
            </svg>
          </figure>
        </section>

        <section className="login-paper" aria-label="学生登录">
          <div className="paper-index">
            <span>01</span>
            <span>身份确认</span>
          </div>

          {authStatus === 'checking' ? (
            <div className="auth-loading" role="status">
              <span className="loading-mark" aria-hidden="true" />
              正在确认你的学习身份…
            </div>
          ) : (
            <form onSubmit={onSubmit} noValidate>
              <p className="form-kicker">继续上次的学习</p>
              <h2>进入你的学习空间</h2>
              <p className="form-description">输入你约定的用户名即可，不需要密码。</p>

              <label htmlFor="username">用户名</label>
              <div className="input-wrap">
                <Input
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  autoFocus
                  maxLength={32}
                  value={username}
                  onChange={(event) => onUsernameChange?.(event.target.value)}
                  aria-describedby={error ? 'login-error' : 'username-help'}
                  aria-invalid={Boolean(error)}
                  placeholder="请输入用户名"
                />
                <span>{username.length}/32</span>
              </div>
              <p id="username-help" className="field-help">
                可以使用昵称，不必填写真实姓名。
              </p>

              {error ? (
                <p id="login-error" className="form-error" role="alert">
                  {error}
                </p>
              ) : null}

              <Button type="submit" disabled={!username.trim() || isSubmitting}>
                <span>{isSubmitting ? '正在进入…' : '进入学习空间'}</span>
                <span aria-hidden="true">→</span>
              </Button>

              <p className="privacy-note">
                <span aria-hidden="true">◇</span>
                除非你清除浏览器数据，否则这里会保持登录。请不要在公共设备上使用私人用户名。
              </p>
            </form>
          )}
        </section>
      </div>

      <footer className="page-footer">
        <span>启思 · 让每一步推导都算数</span>
        <span>2026 / 高考数学</span>
      </footer>
    </main>
  );
}
