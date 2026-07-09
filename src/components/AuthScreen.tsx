import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export function AuthScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
        <header className="setup-header">
          <h1>CityCanvas</h1>
          <p>登录后地图自动保存到云端</p>
        </header>

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
      </div>
    </div>
  );
}
