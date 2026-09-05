interface Props {
  registrar: string | null;
  /** Whether this issue already has stored results on screen above the notice. */
  hasResults: boolean;
}

/**
 * Stands in for the check button on issues whose registrar will not answer without a captcha.
 *
 * The applicant is never asked to read a code and is never sent elsewhere to find their own
 * answer — the app checks and tells them, the same as for every other registrar. These issues
 * are swept by an operator, who reads one challenge and spends it across every account's book,
 * after which each applicant gets their result by push and email like anyone else.
 *
 * Once results are stored there is nothing left to say: the outcome is printed directly above,
 * and a promise to deliver one that already arrived would only contradict it.
 */
export function OperatorNotice({ registrar, hasResults }: Props) {
  if (hasResults) return null;

  // The API carries the registrar's adapter key ('bigshare'), not a display name.
  const name = registrar ? registrar.charAt(0).toUpperCase() + registrar.slice(1) : null;

  return (
    <div className="banner info" style={{ marginBottom: 0 }}>
      <span>
        {name ?? 'This registrar'} needs a code read by a person, so we solve it once for everyone
        and send your result the moment it lands. <strong>Nothing for you to do.</strong>
      </span>
    </div>
  );
}
