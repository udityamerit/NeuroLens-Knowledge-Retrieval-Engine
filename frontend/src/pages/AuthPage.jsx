import { useEffect, useState } from 'react';
import Logo from '../components/Logo';
import { api } from '../api';

const SSO_LABEL = { google: 'Google', github: 'GitHub', microsoft: 'Microsoft' };

export default function AuthPage({ onAuthed, notice, inviteToken }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const [error, setError] = useState(notice?.error || '');
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState([]);
  const [showPw, setShowPw] = useState(false);

  useEffect(() => {
    api.ssoProviders().then(setProviders).catch(() => setProviders([]));
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const payload = mode === 'register'
        ? { email: form.email, password: form.password, name: form.name }
        : { email: form.email, password: form.password };
      onAuthed(await (mode === 'register' ? api.register(payload) : api.login(payload)));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="glass-panel auth-card animate-fade-in" onSubmit={submit} noValidate>
        <Logo size={44} />
        <h1>{mode === 'login' ? 'Sign in to NeuroLens' : 'Create your account'}</h1>
        {inviteToken && <p className="muted">Sign in or register with the invited email address to join the organisation.</p>}
        {notice?.info && <p className="info-msg">{notice.info}</p>}
        {error && <p className="error-msg" role="alert">{error}</p>}

        {providers.length > 0 && (
          <>
            <div className="sso-row">
              {providers.map((p) => (
                <a key={p.id} className="btn btn-ghost" href={api.ssoUrl(p.id)}>
                  Continue with {SSO_LABEL[p.id] || p.name}
                </a>
              ))}
            </div>
            <div className="divider"><span>or use email</span></div>
          </>
        )}

        {mode === 'register' && (
          <label>Name
            <input value={form.name} onChange={set('name')} autoComplete="name" maxLength={120} />
          </label>
        )}
        <label>Email
          <input type="email" required value={form.email} onChange={set('email')} autoComplete="email" />
        </label>
        <label>Password
          <span className="pw-field">
            <input type={showPw ? 'text' : 'password'} required value={form.password} onChange={set('password')}
                   autoComplete={mode === 'login' ? 'current-password' : 'new-password'} spellCheck={false}
                   autoCapitalize="none" />
            <button type="button" className="pw-toggle" onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? 'Hide password' : 'Show password'} aria-pressed={showPw}>
              {showPw ? (
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </span>
        </label>
        {mode === 'register' && <p className="muted small">At least 10 characters using three of: lowercase, uppercase, digits, symbols. No common passwords.</p>}

        <button className="btn btn-primary" disabled={busy || !form.email || !form.password}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
        <button type="button" className="link-btn" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setShowPw(false); }}>
          {mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </button>
      </form>
    </div>
  );
}
