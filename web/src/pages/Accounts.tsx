import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { Section } from '../components/IpoCard';
import { IconAlert, IconCheck, IconCopy, IconLock, IconPlus, IconTrash, IconWallet } from '../components/Icons';
import { shortDate } from '../format';

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

function AddPan({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [pan, setPan] = useState('');
  const [label, setLabel] = useState('');
  const [demat, setDemat] = useState('');

  const add = useMutation({
    mutationFn: () =>
      api.addPan({
        pan: pan.trim() ? pan.toUpperCase() : undefined,
        label: label.trim() || 'Account',
        demat: demat.trim() ? demat.trim().toUpperCase() : undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pans'] });
      onDone();
    },
  });

  // NSDL numbers are "IN" plus 14 digits; CDSL numbers are 16 digits. The depository is
  // inferred from the shape, so there is nothing for the user to choose.
  const dematClean = demat.replace(/[\s-]/g, '').toUpperCase();
  const dematValid = dematClean === '' || /^IN[0-9]{14}$/.test(dematClean) || /^[0-9]{16}$/.test(dematClean);
  const depository = /^IN[0-9]{14}$/.test(dematClean) ? 'NSDL' : /^[0-9]{16}$/.test(dematClean) ? 'CDSL' : null;

  // Either identifier is enough on its own, so each is only validated when filled in — but
  // at least one has to be there or there is nothing to look an allotment up by.
  const panFilled = pan.trim() !== '';
  const panValid = !panFilled || PAN_RE.test(pan.toUpperCase());
  const valid = panValid && dematValid && (panFilled || dematClean !== '');

  return (
    <form
      className="card card-pad"
      style={{ marginBottom: 18 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) add.mutate();
      }}
    >
      <div className="field">
        <label className="label" htmlFor="pan">
          PAN number <span className="faint">(or use a demat number below)</span>
        </label>
        <input
          id="pan"
          className="input mono"
          placeholder="ABCDE1234F"
          maxLength={10}
          autoComplete="off"
          spellCheck={false}
          value={pan}
          onChange={(e) => setPan(e.target.value.toUpperCase())}
          style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}
        />
      </div>

      <div className="field">
        <label className="label" htmlFor="demat">
          Demat number <span className="faint">(optional)</span>
        </label>
        <input
          id="demat"
          className="input mono"
          placeholder="IN30012345678901 or 1234567890123456"
          maxLength={20}
          autoComplete="off"
          spellCheck={false}
          value={demat}
          onChange={(e) => setDemat(e.target.value.toUpperCase())}
          style={{ textTransform: 'uppercase', letterSpacing: '0.03em' }}
        />
        <p className="input-hint">
          {dematClean === ''
            ? 'Either a PAN or a demat number is enough. Adding both catches applications filed against either one.'
            : depository
              ? `Recognised as ${depository}.`
              : 'Must be 16 digits (CDSL) or IN followed by 14 digits (NSDL).'}
        </p>
      </div>

      <div className="field">
        <label className="label" htmlFor="label">
          Label
        </label>
        <input
          id="label"
          className="input"
          placeholder="Self, Spouse, Father"
          maxLength={40}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>

      {add.isError && (
        <div className="banner error">
          <IconAlert size={16} />
          <span>{(add.error as ApiError).message}</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn primary" disabled={!valid || add.isPending} style={{ flex: 1 }}>
          {add.isPending && <span className="spinner" />}
          Save PAN
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
      </div>

      <p className="input-hint" style={{ textAlign: 'center', marginTop: 12 }}>
        PANs are encrypted before storage and are only ever sent to the official registrar.
      </p>
    </form>
  );
}

function SyncKey() {
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: api.me });
  const [copied, setCopied] = useState(false);

  return (
    <div className="card card-pad">
      <h3 style={{ margin: '0 0 5px', fontSize: 14.5, fontWeight: 600 }}>Link another device</h3>
      <p className="dim" style={{ margin: '0 0 14px', fontSize: 13 }}>
        Enter this key on your phone to share the same PAN book and alerts.
      </p>

      <div style={{ display: 'flex', gap: 8 }}>
        <code className="input mono" style={{ letterSpacing: '0.06em', fontWeight: 560 }}>
          {me?.syncKey ?? '—'}
        </code>
        <button
          type="button"
          className="btn"
          onClick={() => {
            if (!me?.syncKey) return;
            void navigator.clipboard.writeText(me.syncKey);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
        >
          {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');

  const change = useMutation({
    mutationFn: () => api.changePassword(current, next),
    onSuccess: () => {
      setCurrent('');
      setNext('');
    },
  });

  return (
    <form
      className="card card-pad"
      onSubmit={(e) => {
        e.preventDefault();
        change.mutate();
      }}
    >
      <h3 style={{ margin: '0 0 14px', fontSize: 14.5, fontWeight: 600 }}>Change password</h3>

      <div className="field">
        <label className="label" htmlFor="current">
          Current password
        </label>
        <input
          id="current"
          type="password"
          className="input"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="next">
          New password
        </label>
        <input
          id="next"
          type="password"
          className="input"
          autoComplete="new-password"
          minLength={8}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
        />
        <p className="input-hint">Other signed-in devices will be signed out.</p>
      </div>

      {change.isError && (
        <div className="banner error">
          <IconAlert size={16} />
          <span>{(change.error as ApiError).message}</span>
        </div>
      )}
      {change.isSuccess && (
        <div className="banner success">
          <IconCheck size={16} />
          <span>Password updated.</span>
        </div>
      )}

      <button className="btn" disabled={change.isPending || !current || next.length < 8}>
        <IconLock size={14} /> Update password
      </button>
    </form>
  );
}

export function Accounts() {
  const queryClient = useQueryClient();
  const { account } = useAuth();
  const [adding, setAdding] = useState(false);

  const { data: pans, isLoading } = useQuery({ queryKey: ['pans'], queryFn: api.pans });

  const remove = useMutation({
    mutationFn: (id: string) => api.deletePan(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pans'] }),
  });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.updatePan(id, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pans'] }),
  });

  return (
    <div>
      <h1 className="page-title">Accounts</h1>
      <p className="page-sub">
        Signed in as {account?.email}. Every PAN here is checked on every IPO allotment.
      </p>

      <Section title="PAN book" count={pans?.length}>
        {adding ? (
          <AddPan onDone={() => setAdding(false)} />
        ) : (
          <button className="btn primary" style={{ marginBottom: 14 }} onClick={() => setAdding(true)}>
            <IconPlus size={15} /> Add PAN
          </button>
        )}

        {isLoading ? (
          <div className="skeleton" style={{ height: 120 }} />
        ) : (pans ?? []).length === 0 ? (
          <div className="card empty">
            <IconWallet size={26} />
            <div>No PANs saved yet.</div>
          </div>
        ) : (
          <div className="card rows">
            {pans!.map((pan) => (
              <div className="row" key={pan.id}>
                <button
                  className={`switch ${pan.isActive ? 'on' : ''}`}
                  title={pan.isActive ? 'Included in checks' : 'Skipped'}
                  aria-label={pan.isActive ? 'Included in checks' : 'Skipped'}
                  onClick={() => toggle.mutate({ id: pan.id, isActive: !pan.isActive })}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row-title">{pan.label}</div>
                  <div className="row-sub mono">
                    {pan.pan ?? ''}
                    {pan.demat ? `${pan.pan ? ' · ' : ''}${pan.depository} ${pan.demat}` : ''}
                    {pan.holderName ? ` · ${pan.holderName}` : ''} · added {shortDate(pan.createdAt.slice(0, 10))}
                  </div>
                </div>
                <button
                  className="btn danger sm"
                  onClick={() => {
                    if (confirm(`Remove ${pan.label} (${pan.pan ?? pan.demat})?`)) remove.mutate(pan.id);
                  }}
                >
                  <IconTrash size={14} /> Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Security">
        <div style={{ display: 'grid', gap: 16 }}>
          <ChangePassword />
          <SyncKey />
        </div>
      </Section>
    </div>
  );
}
