import { useEffect, useRef, useState } from 'react';
import { adminApi, ApiError, type CaptchaChallenge, type SweepOutcome, type SweepTarget } from '../api';
import { shortDate } from '../format';
import { useSeo } from '../seo';

const TOKEN_KEY = 'niranthar.adminToken';

/**
 * Operator console for captcha-gated registrars.
 *
 * Deliberately unlinked — reachable only by typing /admin — but obscurity is not the control:
 * every call carries the shared ADMIN_TOKEN, and the API answers 404 without it. The page is
 * also marked noindex so a crawler that somehow finds the path never lists it.
 *
 * What it exists for: Bigshare answers nobody who has not read its challenge, so the automatic
 * watcher cannot finish those issues on its own. Rather than ask every user to solve a captcha
 * they will mostly never see, one person solves it here and the answer is spent across the
 * whole book — every applicant checked, everyone notified by push and email.
 */
export function Admin() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? '');
  const [tokenDraft, setTokenDraft] = useState('');
  const [targets, setTargets] = useState<SweepTarget[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [active, setActive] = useState<SweepTarget | null>(null);
  const [captcha, setCaptcha] = useState<CaptchaChallenge | null>(null);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<SweepOutcome[]>([]);

  const answerRef = useRef<HTMLInputElement>(null);

  /**
   * Unlinked is not the same as unindexed, so this says so explicitly.
   *
   * It has to go through useSeo rather than appending a tag of its own: index.html already
   * ships a static `robots` meta, and a second one does not override the first — a crawler
   * reads the original `index, follow` and lists the console. useSeo mutates the existing tag,
   * which is the only thing that actually changes the answer. No `path`, so no canonical is
   * published for a page that should not be discoverable in the first place.
   */
  useSeo({
    title: 'Operator console',
    description: 'Internal allotment sweep console.',
    noindex: true,
  });

  async function loadTargets(withToken = token) {
    if (!withToken) return;
    setError(null);
    try {
      setTargets(await adminApi.pending(withToken));
    } catch (err) {
      setTargets(null);
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  useEffect(() => {
    void loadTargets();
    // Re-reading the list is only meaningful when the token changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function start(target: SweepTarget) {
    setActive(target);
    setCaptcha(null);
    setAnswer('');
    setLog([]);
    setError(null);
    setBusy(true);
    try {
      const { captcha: challenge } = await adminApi.captcha(token, target.ipoId);
      setCaptcha(challenge);
      answerRef.current?.focus();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Sends one solved challenge. The server spends it on as many applicants as the registrar
   * allows, saves every answer as it lands, and hands back the next challenge if the token ran
   * out mid-book — so solving continues without a round trip and nothing is ever re-checked.
   */
  async function submit() {
    if (!active || !captcha || !answer.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await adminApi.sweep(token, active.ipoId, captcha.token, answer.trim());
      setLog((prev) => [...prev, outcome]);
      setAnswer('');

      if (outcome.done) {
        setCaptcha(null);
        setActive(null);
        await loadTargets();
      } else if (outcome.nextCaptcha) {
        setCaptcha(outcome.nextCaptcha);
        answerRef.current?.focus();
      } else {
        // No follow-up challenge came back; fetch one so the operator is not stranded.
        const { captcha: challenge } = await adminApi.captcha(token, active.ipoId);
        setCaptcha(challenge);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      // A refused answer spends the image, so pull a fresh one rather than leaving a dead PNG.
      try {
        const { captcha: challenge } = await adminApi.captcha(token, active.ipoId);
        setCaptcha(challenge);
        setAnswer('');
      } catch {
        /* leave the existing prompt in place if even that fails */
      }
    } finally {
      setBusy(false);
    }
  }

  const totals = log.reduce(
    (acc, o) => ({ checked: acc.checked + o.checked, notified: acc.notified + o.notified }),
    { checked: 0, notified: 0 },
  );

  if (!token) {
    return (
      <div style={{ maxWidth: 420, margin: '10vh auto', padding: 16 }}>
        <div className="card card-pad">
          <div className="section-title" style={{ marginBottom: 10 }}>
            Operator console
          </div>
          <div className="field">
            <label className="label" htmlFor="admin-token">
              Admin token
            </label>
            <input
              id="admin-token"
              className="input"
              type="password"
              autoComplete="off"
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && tokenDraft.trim()) {
                  localStorage.setItem(TOKEN_KEY, tokenDraft.trim());
                  setToken(tokenDraft.trim());
                }
              }}
            />
          </div>
          <button
            className="btn primary block"
            disabled={!tokenDraft.trim()}
            onClick={() => {
              localStorage.setItem(TOKEN_KEY, tokenDraft.trim());
              setToken(tokenDraft.trim());
            }}
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div className="section-title">Operator console</div>
        <button
          className="btn ghost sm"
          onClick={() => {
            localStorage.removeItem(TOKEN_KEY);
            setToken('');
            setTargets(null);
            setActive(null);
            setCaptcha(null);
          }}
        >
          Sign out
        </button>
      </div>

      {error && (
        <div className="card card-pad" style={{ marginBottom: 14, color: 'var(--danger, #d33)' }}>
          {error}
        </div>
      )}

      {active && captcha ? (
        <div className="card card-pad">
          <div className="section-title" style={{ marginBottom: 4 }}>
            {active.ipoName}
          </div>
          <p className="dim" style={{ margin: '0 0 14px', fontSize: 13 }}>
            {active.registrarName} needs a code before it will answer. One solve is spent on as
            many applicants as it allows — anyone already answered is skipped, so nothing is
            checked twice.
          </p>

          <img
            src={captcha.image}
            alt="Registrar captcha"
            style={{
              display: 'block',
              maxWidth: '100%',
              borderRadius: 8,
              marginBottom: 12,
              background: '#fff',
            }}
          />

          <div className="field">
            <label className="label" htmlFor="admin-captcha">
              Code
            </label>
            <input
              id="admin-captcha"
              ref={answerRef}
              className="input"
              autoComplete="off"
              autoCapitalize="characters"
              value={answer}
              disabled={busy}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn primary" disabled={busy || !answer.trim()} onClick={() => void submit()}>
              {busy ? 'Checking…' : 'Check applicants'}
            </button>
            <button
              className="btn ghost"
              disabled={busy}
              onClick={() => {
                setActive(null);
                setCaptcha(null);
                void loadTargets();
              }}
            >
              Stop
            </button>
          </div>

          {log.length > 0 && (
            <div style={{ marginTop: 16, fontSize: 13 }} className="dim">
              <div>
                {totals.checked} applicant{totals.checked === 1 ? '' : 's'} checked ·{' '}
                {totals.notified} account{totals.notified === 1 ? '' : 's'} notified ·{' '}
                {log[log.length - 1].remaining} still pending
              </div>
              {log[log.length - 1].tokenSpent && (
                <div style={{ marginTop: 4 }}>
                  The registrar spent that code after {log[log.length - 1].checked}. Next image is
                  ready — solving continues from where it stopped.
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          {targets === null && <div className="card empty">Loading…</div>}
          {targets?.length === 0 && (
            <div className="card empty">
              Nothing waiting. Captcha-free registrars are swept automatically.
            </div>
          )}
          {targets?.map((t) => (
            <div key={t.ipoId} className="card card-pad" style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{t.ipoName}</div>
                  <div className="dim" style={{ fontSize: 13, marginTop: 2 }}>
                    {t.registrarName}
                    {t.boaDate ? ` · allotment ${shortDate(t.boaDate)}` : ''}
                  </div>
                  <div className="dim" style={{ fontSize: 13, marginTop: 4 }}>
                    {t.pending} pending · {t.settled} already done
                  </div>
                </div>
                <button className="btn primary sm" disabled={busy} onClick={() => void start(t)}>
                  Solve
                </button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
