import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import { money, num } from '../format';
import type { ApplicationBoard, Ipo, RefundStatus } from '../types';
import { IconAlert, IconCheck, IconClock, IconWallet } from './Icons';

export const REFUND_LABEL: Record<RefundStatus, string> = {
  blocked: 'Funds blocked',
  refund_pending: 'Refund due',
  refund_received: 'Refund received',
  debited: 'Fully allotted',
};

export const REFUND_TONE: Record<RefundStatus, string> = {
  blocked: 'info',
  refund_pending: 'warn',
  refund_received: 'pos',
  debited: 'pos',
};

/** Stepper for lot counts — the unit people actually apply in. */
function LotStepper({
  lots,
  onChange,
  disabled,
}: {
  lots: number;
  onChange: (next: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="stepper">
      <button
        type="button"
        onClick={() => onChange(Math.max(0, lots - 1))}
        disabled={disabled || lots === 0}
        aria-label="One lot fewer"
      >
        &minus;
      </button>
      <span className="mono">{lots}</span>
      <button
        type="button"
        onClick={() => onChange(lots + 1)}
        disabled={disabled || lots >= 1000}
        aria-label="One lot more"
      >
        +
      </button>
    </div>
  );
}

function Totals({ board }: { board: ApplicationBoard }) {
  const applied = board.accounts.filter((a) => a.application);
  const blocked = applied.reduce((sum, a) => sum + (a.application?.amountBlocked ?? 0), 0);
  const lots = applied.reduce((sum, a) => sum + (a.application?.lots ?? 0), 0);
  const debited = applied.reduce((sum, a) => sum + (a.application?.amountDebited ?? 0), 0);
  const refund = applied.reduce((sum, a) => sum + (a.application?.refundAmount ?? 0), 0);
  const settled = applied.some((a) => a.application?.allottedShares !== null);

  if (applied.length === 0) return null;

  return (
    <div className="stat-grid" style={{ marginBottom: 14 }}>
      <div className="stat">
        <div className="stat-label">Accounts applied</div>
        <div className="stat-value mono">
          {applied.length}
          <span className="faint"> / {board.accounts.length}</span>
        </div>
      </div>
      <div className="stat">
        <div className="stat-label">Total lots</div>
        <div className="stat-value mono">{num(lots)}</div>
      </div>
      <div className="stat">
        <div className="stat-label">{settled ? 'Was blocked' : 'Money blocked'}</div>
        <div className="stat-value mono">{money(blocked)}</div>
      </div>
      {settled && (
        <>
          <div className="stat">
            <div className="stat-label">Invested</div>
            <div className="stat-value mono pos">{money(debited)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Coming back</div>
            <div className="stat-value mono">{money(refund)}</div>
          </div>
        </>
      )}
    </div>
  );
}

export function ApplyPanel({ ipo }: { ipo: Ipo }) {
  const queryClient = useQueryClient();

  const { data: board, isLoading } = useQuery({
    queryKey: ['applications', ipo.id],
    queryFn: () => api.applicationBoard(ipo.id),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['applications', ipo.id] });
    void queryClient.invalidateQueries({ queryKey: ['money-summary'] });
    void queryClient.invalidateQueries({ queryKey: ['money-by-ipo'] });
  };

  const save = useMutation({
    mutationFn: ({ panId, lots }: { panId: string; lots: number }) =>
      api.saveApplication(ipo.id, { panId, lots }),
    onSuccess: invalidate,
  });

  const applyAll = useMutation({
    mutationFn: (lots: number) => api.applyAll(ipo.id, lots),
    onSuccess: invalidate,
  });

  const refund = useMutation({
    mutationFn: ({ id, received }: { id: string; received: boolean }) => api.markRefund(id, received),
    onSuccess: invalidate,
  });

  if (isLoading) return <div className="skeleton" style={{ height: 200, marginBottom: 16 }} />;

  if (!board || board.accounts.length === 0) {
    return (
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h2 className="section-title" style={{ marginBottom: 8 }}>
          Your application
        </h2>
        <p className="dim" style={{ margin: '0 0 14px', fontSize: 13.5 }}>
          Add your PANs to record how much you applied for from each account.
        </p>
        <Link to="/accounts" className="btn primary block">
          Add a PAN
        </Link>
      </div>
    );
  }

  /**
   * Allotted accounts float to the top — once results are out that is the only row anyone is
   * looking for, and it would otherwise sit wherever the PAN happened to be added.
   */
  const accounts = [...board.accounts].sort((a, b) => {
    const rank = (x: typeof a) => {
      const app = x.application;
      if (app?.allottedShares && app.allottedShares > 0) return 0;
      if (app?.allottedShares === 0) return 1;
      if (app) return 2;
      return 3;
    };
    const diff = rank(a) - rank(b);
    return diff !== 0 ? diff : (b.application?.allottedShares ?? 0) - (a.application?.allottedShares ?? 0);
  });

  const anyApplied = board.accounts.some((a) => a.application);
  const anySettled = board.accounts.some((a) => a.application?.allottedShares !== null);
  const error = (save.error ?? applyAll.error ?? refund.error) as ApiError | null;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ padding: '16px 16px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 className="section-title">Your application</h2>
        {board.amountPerLot !== null && (
          <span className="faint" style={{ fontSize: 12 }}>
            {num(board.lotSize)} shares &middot; {money(board.amountPerLot)} per lot
          </span>
        )}
      </div>

      <div style={{ padding: '14px 16px 0' }}>
        <Totals board={board} />

        {!anyApplied && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <button
              className="btn primary sm"
              disabled={applyAll.isPending}
              onClick={() => applyAll.mutate(1)}
            >
              {applyAll.isPending && <span className="spinner" />}
              Applied 1 lot from all {board.accounts.length}
            </button>
            <button className="btn sm" disabled={applyAll.isPending} onClick={() => applyAll.mutate(2)}>
              2 lots each
            </button>
          </div>
        )}

        {error && (
          <div className="banner error">
            <IconAlert size={16} />
            <span>{error.message}</span>
          </div>
        )}
      </div>

      <div className="rows">
        {accounts.map((account) => {
          const app = account.application;
          const lots = app?.lots ?? 0;
          const settled = app?.allottedShares !== null && app?.allottedShares !== undefined;

          return (
            <div className="row" key={account.panId}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row-title">
                  {account.label}
                  <span className="faint mono" style={{ fontWeight: 400, marginLeft: 8, fontSize: 12.5 }}>
                    {account.panMasked}
                  </span>
                </div>
                <div className="row-sub">
                  {app ? (
                    settled ? (
                      <>
                        {app.allottedShares! > 0
                          ? `Allotted ${num(app.allottedShares)} shares · ${money(app.amountDebited)}`
                          : 'Not allotted'}
                        {app.refundAmount! > 0 && ` · ${money(app.refundAmount)} back`}
                      </>
                    ) : (
                      <>
                        {num(app.shares)} shares &middot; {money(app.amountBlocked)} blocked
                      </>
                    )
                  ) : (
                    'Not applied'
                  )}
                </div>
              </div>

              {settled && app ? (
                <RefundControl
                  status={app.refundStatus}
                  busy={refund.isPending}
                  onToggle={(received) => refund.mutate({ id: app.id, received })}
                />
              ) : (
                <LotStepper
                  lots={lots}
                  disabled={save.isPending}
                  onChange={(next) => save.mutate({ panId: account.panId, lots: next })}
                />
              )}
            </div>
          );
        })}
      </div>

      {anySettled && (
        <div style={{ padding: '0 16px 16px' }}>
          <p className="input-hint" style={{ marginTop: 12 }}>
            Amounts are calculated at the cut-off price. Mark a refund once the money is actually back
            in the bank account.
          </p>
        </div>
      )}
    </div>
  );
}

function RefundControl({
  status,
  busy,
  onToggle,
}: {
  status: RefundStatus;
  busy: boolean;
  onToggle: (received: boolean) => void;
}) {
  if (status === 'debited') {
    return (
      <span className="tag" style={{ background: 'var(--pos-subtle)', color: 'var(--pos)' }}>
        Fully allotted
      </span>
    );
  }

  if (status === 'refund_received') {
    return (
      <button className="btn ghost sm pos" disabled={busy} onClick={() => onToggle(false)} title="Undo">
        <IconCheck size={14} /> Refunded
      </button>
    );
  }

  if (status === 'refund_pending') {
    return (
      <button className="btn sm" disabled={busy} onClick={() => onToggle(true)}>
        {busy ? <span className="spinner" /> : <IconWallet size={14} />} Mark refunded
      </button>
    );
  }

  return (
    <span className="tag" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <IconClock size={11} /> Blocked
    </span>
  );
}
