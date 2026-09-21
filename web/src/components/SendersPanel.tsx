import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { money, relativeTime } from '../format';
import { IconCheck, IconTrash, IconUser } from './Icons';
import { Section } from './IpoCard';
import type { OneTimeSender } from '../types';

/**
 * The one-time side of the money page.
 *
 * Someone who sends the amount for a single application is not running a PAN book across ten
 * issues, so asking them to pick lots, an IPO and an account is all friction for a record
 * that only ever answers one question: has their money gone back yet? Hence a name, an
 * amount, and one button.
 */
export function SendersPanel() {
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');

  const { data, isLoading } = useQuery({ queryKey: ['senders'], queryFn: api.senders });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['senders'] });

  const add = useMutation({
    mutationFn: () => api.addSender({ name: name.trim(), amount: Number(amount) || 0 }),
    onSuccess: () => {
      setName('');
      setAmount('');
      void invalidate();
    },
  });
  const mark = useMutation({
    mutationFn: ({ id, returned }: { id: string; returned: boolean }) => api.markSenderReturned(id, returned),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: api.deleteSender, onSuccess: invalidate });

  const canAdd = name.trim() !== '' && Number(amount) > 0;
  const error = (add.error ?? mark.error ?? remove.error) as Error | null;
  const summary = data?.summary;
  const senders = data?.senders ?? [];

  const confirmRemove = (sender: OneTimeSender) => {
    if (confirm(`Remove ${sender.name}?\n\nThis deletes the entry entirely. It cannot be undone.`)) {
      remove.mutate(sender.id);
    }
  };

  return (
    <div>
      <form
        className="card card-pad"
        style={{ marginBottom: 18 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (canAdd) add.mutate();
        }}
      >
        <h2 className="section-title" style={{ marginBottom: 10 }}>
          Add a one-time sender
        </h2>

        <div className="field">
          <label className="label" htmlFor="sender-name">
            Name
          </label>
          <input
            id="sender-name"
            className="input"
            placeholder="Who sent the money"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label className="label" htmlFor="sender-amount">
            Amount sent
          </label>
          <input
            id="sender-amount"
            className="input"
            placeholder="14750"
            inputMode="decimal"
            maxLength={12}
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
          />
        </div>

        <button className="btn primary" type="submit" disabled={!canAdd || add.isPending} style={{ marginTop: 14 }}>
          {add.isPending && <span className="spinner" />}
          Add sender
        </button>

        {error && (
          <div className="banner error" style={{ marginTop: 12 }}>
            <span>{error.message}</span>
          </div>
        )}
      </form>

      {isLoading ? (
        <div className="skeleton" style={{ height: 120 }} />
      ) : senders.length === 0 ? (
        <div className="card empty">
          <IconUser size={26} />
          <div style={{ marginBottom: 6 }}>No one-time senders yet.</div>
          <div className="faint" style={{ fontSize: 12.5, maxWidth: 340, margin: '0 auto' }}>
            Add a name and the amount they sent, then mark it once the money goes back to them.
          </div>
        </div>
      ) : (
        <>
          <div className="stat-grid" style={{ marginBottom: 22 }}>
            <div className="stat">
              <div className="stat-label">With me</div>
              <div
                className="stat-value mono"
                style={{ fontSize: 19, color: (summary?.holding ?? 0) > 0 ? 'var(--warn)' : undefined }}
              >
                {money(summary?.holding ?? 0)}
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Returned</div>
              <div className="stat-value mono" style={{ fontSize: 19 }}>
                {money(summary?.returned ?? 0)}
              </div>
            </div>
          </div>

          <Section title="Senders" count={summary?.senderCount}>
            <div className="ipo-list">
              {senders.map((sender) => {
                const held = sender.status === 'holding';
                return (
                  <div className="ipo-row" key={sender.id}>
                    <div className="ipo-main">
                      <div className="ipo-name">
                        {sender.name}
                        {!held && <span className="tag open">Returned</span>}
                      </div>
                      <div className="ipo-meta">
                        <span className="mono">{money(sender.amount)}</span>
                        <span className="faint">·</span>
                        <span>
                          {held
                            ? `sent ${relativeTime(sender.receivedAt)}`
                            : `returned ${relativeTime(sender.returnedAt)}`}
                        </span>
                      </div>
                    </div>
                    <div className="ipo-right">
                      {held ? (
                        <button
                          className="btn sm"
                          disabled={mark.isPending}
                          onClick={() => mark.mutate({ id: sender.id, returned: true })}
                        >
                          {mark.isPending && <span className="spinner" />}
                          Got it back
                        </button>
                      ) : (
                        // Undoable: marking the wrong row is the only mistake possible here.
                        <button
                          className="btn sm ghost"
                          disabled={mark.isPending}
                          onClick={() => mark.mutate({ id: sender.id, returned: false })}
                        >
                          <IconCheck size={14} />
                          Undo
                        </button>
                      )}
                      <button
                        className="btn sm ghost"
                        style={{ marginTop: 6 }}
                        disabled={remove.isPending}
                        onClick={() => confirmRemove(sender)}
                      >
                        <IconTrash size={14} />
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
