import { useState } from 'react';

interface Props {
  symbol: string;
  url: string;
}

/**
 * Hands the user off to NSE's own bid/allotment verification page.
 *
 * NSE answers for an issue from T+1 until 10 days after it closes, and its form is guarded by
 * an invisible reCAPTCHA on every submit. So the check has to happen in the user's own browser
 * — we carry them to the page and tell them which symbol to pick, and they enter their PAN
 * there. Nothing about the challenge is touched or worked around.
 *
 * The symbol is worth copying because NSE's dropdown is a long unlabelled list of tickers, and
 * an issue's ticker is rarely the name people know it by.
 */
export function NseCheck({ symbol, url }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(symbol);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard is blocked in some browsers/contexts; the symbol is on screen regardless.
    }
  };

  return (
    <div className="nse-check">
      <span className="faint">Also on NSE — pick symbol</span>
      <button type="button" className="nse-symbol mono" onClick={copy} title="Copy symbol">
        {copied ? 'copied' : symbol}
      </button>
      <a href={url} target="_blank" rel="noopener noreferrer" className="nse-link">
        Open NSE ↗
      </a>
    </div>
  );
}

interface PanelProps {
  symbol: string | null;
  url: string | null;
  registrar: string | null;
}

/**
 * Stands in for the check button on issues whose registrar will not answer without a captcha.
 *
 * The user is never asked to do anything here. Those issues are swept by an operator, who
 * reads one challenge and spends it across every account's book, after which each applicant
 * gets their result by push and email like any other issue. That sweep talks to the registrar
 * directly, so it is not bound by NSE's window and stays available long after NSE stops
 * answering.
 *
 * NSE is offered alongside it purely as an impatience valve: someone who wants their answer
 * before the sweep runs can get it in their own browser, where the page's invisible reCAPTCHA
 * is solved by the person it was meant for.
 */
export function NsePanel({ symbol, url, registrar }: PanelProps) {
  const via = registrar ? `${registrar} needs` : 'This registrar needs';

  return (
    <div>
      <div className="banner info" style={{ marginBottom: symbol && url ? 12 : 0 }}>
        <span>
          {via} a code read by a person, so we solve it once for everyone and send your result the
          moment it lands. <strong>Nothing for you to do.</strong>
        </span>
      </div>

      {symbol && url && (
        <>
          <p className="dim" style={{ margin: '0 0 10px', fontSize: 13 }}>
            Don't want to wait? NSE carries the same allotment and asks only for your PAN — pick
            symbol <strong className="mono">{symbol}</strong>.
          </p>
          <a href={url} target="_blank" rel="noopener noreferrer" className="btn block">
            See it now on NSE ↗
          </a>
        </>
      )}
    </div>
  );
}
