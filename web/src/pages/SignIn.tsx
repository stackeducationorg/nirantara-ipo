import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api';
import { useAuth } from '../auth';
import { IconAlert, IconArrowLeft } from '../components/Icons';

type Mode = 'signin' | 'signup' | 'pair';

export function SignIn() {
  const { login, register, pair } = useAuth();

  const [params] = useSearchParams();
  const [mode, setMode] = useState<Mode>(params.get('mode') === 'signup' ? 'signup' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [syncKey, setSyncKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'signin') await login(email, password);
      else if (mode === 'signup') await register(email, password, name.trim() || undefined);
      else await pair(syncKey);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const heading =
    mode === 'signin'
      ? { title: 'Sign in', sub: 'Track allotments across all your accounts.' }
      : mode === 'signup'
        ? { title: 'Create your account', sub: 'Free. Takes about ten seconds.' }
        : { title: 'Link a device', sub: 'Enter the sync key from your other device.' };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-head">
          <Link to="/">
            <img className="auth-logo" src="/logo-mark.png" alt="Nirantara IPO" />
          </Link>
          <h1 className="auth-title">{heading.title}</h1>
          <p className="auth-sub">{heading.sub}</p>
        </div>

        <form className="card card-pad" onSubmit={submit}>
          {error && (
            <div className="banner error">
              <IconAlert size={16} />
              <span>{error}</span>
            </div>
          )}

          {mode === 'pair' ? (
            <div className="field">
              <label className="label" htmlFor="syncKey">
                Sync key
              </label>
              <input
                id="syncKey"
                className="input mono"
                placeholder="NRTH-XXXX-XXXX-XXXX"
                autoComplete="off"
                value={syncKey}
                onChange={(e) => setSyncKey(e.target.value.toUpperCase())}
                required
              />
              <p className="input-hint">Find this under Accounts on a device you are already signed in on.</p>
            </div>
          ) : (
            <>
              {mode === 'signup' && (
                <div className="field">
                  <label className="label" htmlFor="name">
                    Name <span className="faint">(optional)</span>
                  </label>
                  <input
                    id="name"
                    className="input"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
              )}

              <div className="field">
                <label className="label" htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  className="input"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="field">
                <label className="label" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  className="input"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                {mode === 'signup' && <p className="input-hint">At least 8 characters.</p>}
              </div>
            </>
          )}

          <button className="btn primary block" disabled={busy} style={{ marginTop: 4 }}>
            {busy ? <span className="spinner" /> : null}
            {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Link device'}
          </button>
        </form>

        <div className="auth-switch">
          {mode === 'signin' && (
            <>
              <div>
                New here? <button onClick={() => setMode('signup')}>Create an account</button>
              </div>
              <div style={{ marginTop: 6 }}>
                <button onClick={() => setMode('pair')}>Use a sync key instead</button>
              </div>
            </>
          )}
          {mode === 'signup' && (
            <div>
              Already have an account? <button onClick={() => setMode('signin')}>Sign in</button>
            </div>
          )}
          {mode === 'pair' && (
            <div>
              <button onClick={() => setMode('signin')}>Back to sign in</button>
            </div>
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: 18 }}>
          <Link to="/" className="btn ghost sm">
            <IconArrowLeft size={13} /> Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
