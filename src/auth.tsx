import { FormEvent, useState } from 'react';
import './auth.css';

export const beforeLogoutEvent = 'gamecreator:before-logout';
export type UserRole = 'admin' | 'user';
type Session = { username: string; role: UserRole };

const SESSION_KEY = 'gamecreator.auth.session';
const ACCOUNTS: Record<string, { password: string; role: UserRole; label: string }> = {
  admin: { password: 'admin123', role: 'admin', label: '管理员' },
  user: { password: 'user123', role: 'user', label: '用户' },
};

function readSession(): Session | null {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');
    return value?.username && value?.role ? value : null;
  } catch { return null; }
}

export function AuthGate({ children }: { children: (session: Session) => React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(readSession);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');

  const login = (event: FormEvent) => {
    event.preventDefault();
    const account = ACCOUNTS[username.trim().toLowerCase()];
    if (!account || account.password !== password) { setError('账号或密码错误'); return; }
    const next = { username: username.trim().toLowerCase(), role: account.role };
    localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    setSession(next); setError('');
  };

  if (!session) return <main className="auth-page"><form className="auth-card" onSubmit={login}>
    <div className="auth-logo">✦</div><span className="section-kicker">GAMECREATOR LOCAL</span>
    <h1>登录工作区</h1><p>使用本地账号进入项目客户端。</p>
    <label>账号<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" /></label>
    <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>
    {error && <div className="auth-error">{error}</div>}
    <button className="primary auth-submit" type="submit">登录</button>
    <small className="auth-hint">演示账号：admin / admin123；用户：user / user123</small>
  </form></main>;

  const logout = () => {
    if (!window.dispatchEvent(new Event(beforeLogoutEvent, { cancelable: true }))) return;
    localStorage.removeItem(SESSION_KEY); setSession(null);
  };
  return <div className={`authenticated-shell role-${session.role}`}>
    <div className="auth-toolbar"><span>本机账号：<b>{session.username}</b><em>{ACCOUNTS[session.username]?.label}</em></span><button className="auth-logout" onClick={logout}>退出登录</button></div>
    {children(session)}
  </div>;
}
