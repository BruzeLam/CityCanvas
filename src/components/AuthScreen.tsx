import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { hasLocalSession } from '../io/localStore';

type Props = {
  onContinueLocal: () => void;
  /** 从编辑页进入登录时，可返回地图 */
  onBack?: () => void;
};

export function AuthScreen({ onContinueLocal, onBack }: Props) {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const hasDraft = hasLocalSession();

  useEffect(() => {
    if (!onBack) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(email, password, displayName || undefined);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="setup-overlay">
      <div className="setup-card auth-card">
        <header className="setup-header setup-header-row">
          <div>
            <h1>CityCanvas</h1>
            <p>本地自动续档 · 登录后可同步云端</p>
          </div>
          {onBack && (
            <button type="button" className="link-btn overlay-back" onClick={onBack}>
              ← 返回地图
            </button>
          )}
        </header>

        <button type="button" className="primary auth-submit local-continue" onClick={onContinueLocal}>
          {hasDraft ? '继续本地存档' : '本地模式开始'}
        </button>
        <p className="auth-divider">或登录账号</p>

        <div className="auth-tabs">
          <button
            type="button"
            className={mode === 'login' ? 'active' : ''}
            onClick={() => setMode('login')}
          >
            登录
          </button>
          <button
            type="button"
            className={mode === 'register' ? 'active' : ''}
            onClick={() => setMode('register')}
          >
            注册
          </button>
        </div>

        <form className="setup-body auth-form" onSubmit={handleSubmit}>
          {mode === 'register' && (
            <label className="setup-field">
              <span>昵称（可选）</span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="显示名称"
              />
            </label>
          )}

          <label className="setup-field">
            <span>邮箱</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </label>

          <label className="setup-field">
            <span>密码</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'register' ? '至少 6 位' : '密码'}
              required
              minLength={mode === 'register' ? 6 : undefined}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="primary auth-submit" disabled={submitting}>
            {submitting ? '请稍候…' : mode === 'login' ? '登录' : '注册并进入'}
          </button>
        </form>

        {onBack && (
          <footer className="setup-footer auth-footer">
            <button type="button" className="secondary" onClick={onBack}>
              取消，返回地图
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
