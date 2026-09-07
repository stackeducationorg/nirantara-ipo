export type AllotmentStatus =
  | 'allotted'      // shares were allotted
  | 'not_allotted'  // applied, but got nothing
  | 'not_applied'   // registrar has no record for this PAN
  | 'pending'       // allotment not published yet
  | 'error';        // lookup failed (network, bot wall, bad company code)

export interface RegistrarCompany {
  /** The registrar's own identifier for the issue — needed for every lookup. */
  code: string;
  name: string;
}

export type Depository = 'NSDL' | 'CDSL';

/**
 * A demat account, stored in the form the registrars expect:
 *   NSDL — "IN" followed by 14 digits
 *   CDSL — 16 digits
 * Registrars that split it (Bigshare wants DP ID and Client ID separately) slice it themselves.
 */
export interface DematAccount {
  depository: Depository;
  id: string;
}

export type SearchBy = 'pan' | 'demat' | 'application';

/** A captcha challenge a registrar issued, to be shown to the user and answered by them. */
export interface CaptchaChallenge {
  /** Opaque handle the registrar uses to tie the answer back to the image it issued. */
  token: string;
  /** data: URI of the challenge image, safe to render directly in an <img>. */
  image: string;
  /**
   * Present when the challenge was already solved automatically (e.g. by the OCR hook),
   * so the answer can travel back with the token on a retry. Absent on a freshly issued
   * challenge that still has to be read by a human.
   */
  answer?: string;
}

export interface CaptchaAnswer {
  token: string;
  answer: string;
}

/**
 * Thrown when a registrar will not answer without a solved captcha. Carries the challenge so
 * the caller can put it in front of the user rather than simply failing.
 */
export class CaptchaRequiredError extends Error {
  constructor(
    readonly challenge: CaptchaChallenge,
    message = 'This registrar requires a captcha',
  ) {
    super(message);
    this.name = 'CaptchaRequiredError';
  }
}

export interface AllotmentQuery {
  companyCode: string;
  pan: string;
  /** Application number, for lookups by application rather than PAN (some registrars accept one). */
  applicationNo?: string;
  /** Supplied on a retry, after the user has read the challenge image. */
  captcha?: CaptchaAnswer | null;
  /** Set when the saved applicant also has a demat account on file. */
  demat?: DematAccount | null;
  /** Which identifier to look up by. Defaults to `pan`. */
  by?: SearchBy;
}

export interface AllotmentLookup {
  status: AllotmentStatus;
  appliedQty?: number | null;
  allottedQty?: number | null;
  nameOnRecord?: string | null;
  applicationNo?: string | null;
  message?: string | null;
  raw?: unknown;
}

export interface RegistrarAdapter {
  /** Stable key stored on the ipos row. */
  key: string;
  /** Display name shown in the UI. */
  name: string;
  /** `http` adapters are cheap; `browser` adapters drive Playwright and are rate-limited. */
  driver: 'http' | 'browser';
  /** Hostname fragments that identify this registrar on an IPO detail page. */
  match: string[];
  /**
   * Identifier kinds this registrar can search by. Every registrar accepts a PAN; only some
   * accept a demat account, so this is what stops a demat lookup being sent somewhere that
   * would silently answer "not applied" instead of admitting it cannot search that way.
   */
  searchBy: SearchBy[];
  /**
   * The order in which identifiers should be tried when more than one is available
   * (e.g. a saved entry with both a PAN and a demat account). Falls back to the order
   * declared in `searchBy` when unset. A registrar whose demat lookup sidesteps its captcha
   * gate lists `demat` first so automated checks avoid the gated path whenever a demat
   * account is on file.
   *
   * Read through `searchRoutes()`, which re-sorts this so ungated routes come first —
   * this only decides the order *within* the open group and within the gated one.
   */
  searchOrder?: SearchBy[];
  /**
   * True when lookups need a captcha the user must read. Callers should expect
   * CaptchaRequiredError from check() and be ready to prompt.
   *
   * This is the registrar-wide default. Where a registrar leaves some of its lookup paths
   * open, list those in `captchaFreeSearchBy` — the gate is then decided per query rather
   * than per registrar.
   */
  needsCaptcha?: boolean;
  /**
   * Identifier kinds this registrar answers with no captcha, even when `needsCaptcha` is set.
   *
   * A registrar may gate only the identifier a stranger could guess at — a PAN — and leave
   * open the ones that already demonstrate you hold the application: the application number
   * printed on your own acknowledgement, or the demat account the shares would settle into.
   * Listing the open paths here lets a lookup take the registrar's own ungated route rather
   * than putting a challenge in front of someone who never needed to see one.
   *
   * Unset means the gate covers every path.
   */
  captchaFreeSearchBy?: SearchBy[];
  /**
   * The registrar can be identified and mapped from its company list, but its allotment
   * lookup is not supported — check() will throw. The watcher marks such issues 'unsupported'
   * rather than announcing a check it cannot deliver. Resolution still works, so these issues
   * are still counted and named.
   */
  resolveOnly?: boolean;
  /** Fetches a fresh challenge to show the user. Only defined when needsCaptcha. */
  newCaptcha?(): Promise<CaptchaChallenge>;
  /** The issues this registrar currently has open for allotment lookup. */
  listCompanies(): Promise<RegistrarCompany[]>;
  check(query: AllotmentQuery): Promise<AllotmentLookup>;
}

export class RegistrarError extends Error {
  constructor(
    message: string,
    readonly retryable = true,
  ) {
    super(message);
    this.name = 'RegistrarError';
  }
}
