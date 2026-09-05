import * as cheerio from 'cheerio';
import { getJson, getText, postJson } from '../util/http.js';
import { toInt } from '../util/parse.js';
import type {
  AllotmentLookup,
  AllotmentQuery,
  CaptchaAnswer,
  CaptchaChallenge,
  RegistrarAdapter,
  RegistrarCompany,
} from './types.js';
import { CaptchaRequiredError, RegistrarError } from './types.js';

// ---------------------------------------------------------------------------
// Configuration (env-overridable so one build serves all three hosts)
// ---------------------------------------------------------------------------
const DEFAULT_HOST = 'https://ipo1.bigshareonline.com';
const HOST = (process.env.BIGSHARE_HOST ?? DEFAULT_HOST).replace(/\/+$/, '');

const STATUS_PAGE = `${HOST}/ipo_status.html`;
const API = `${HOST}/Data.aspx/FetchIpodetails`;
const CAPTCHA_API = `${HOST}/Captcha.ashx`;

/** ddddocr sidecar endpoint (see ocr_sidecar.py). */
const OCR_URL = process.env.BIGSHARE_OCR_URL ?? 'http://127.0.0.1:8701/ocr';

/** Mirrors the headers the site's own XHRs attach. */
const PAGE_HEADERS = {
  Referer: STATUS_PAGE,
  Origin: HOST,
};

/** PAN format: 5 letters + 4 digits + 1 letter. */
const PAN_RE = /^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/;

/** How many fresh captchas to auto-solve (via OCR) before surfacing a challenge. */
const MAX_CAPTCHA_ATTEMPTS = Number(process.env.BIGSHARE_MAX_CAPTCHA_ATTEMPTS ?? 3);

/** Minimum spacing between any two Bigshare HTTP calls (per process). */
const REQUEST_DELAY_MS = Number(process.env.BIGSHARE_REQUEST_DELAY_MS ?? 1200);

// ---------------------------------------------------------------------------
// Types (mirror the JSON the ASP.NET PageMethod returns)
// ---------------------------------------------------------------------------
interface CaptchaResponse {
  token?: string;
  image?: string;
  Token?: string;
  Image?: string;
}

interface BigshareRecord {
  APPLICATION_NO?: string;
  DPID?: string;
  Name?: string;
  APPLIED?: string;
  ALLOTED?: string;
}

interface BigshareData extends BigshareRecord {
  /** Observed values: OK | NOTFOUND | CAPTCHA | RATELIMIT | WARMING */
  Status?: string;
  Message?: string;
  MatchCount?: number;
  Records?: BigshareRecord[];
  ResultToken?: string | null;
}

interface BigshareResponse {
  d?: BigshareData;
}

interface Payload {
  Applicationno: string;
  Company: string;
  SelectionType: 'AP' | 'PN' | 'BN';
  PanNo: string;
  txtcsdl: string;
  txtDPID: string;
  txtClId: string;
  ddlType: string;
  lang: string;
  CaptchaToken: string;
  CaptchaAnswer: string;
  ResultToken: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let lastRequestAt = 0;

/** Keep a polite minimum gap between requests (Bigshare throttles bursts). */
async function politeDelay(): Promise<void> {
  const wait = lastRequestAt + REQUEST_DELAY_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
}

function isValidPan(pan: string): boolean {
  return PAN_RE.test(pan);
}

function toNum(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0;
  const n = toInt(value);
  if (n === null) return 0;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Bigshare issues a signed token (expiry + nonce + HMAC, recomputed server-side)
 * alongside a base64 PNG. The token is opaque to us — it only has to travel back
 * with whatever the user typed.
 */
async function newCaptcha(): Promise<CaptchaChallenge> {
  await politeDelay();
  const json = await getJson<CaptchaResponse>(CAPTCHA_API, {
    headers: { ...PAGE_HEADERS, Accept: 'application/json' },
    timeoutMs: 20_000,
  });
  // The site's own script accepts either casing, so a cached page or a proxy that
  // rewrites JSON does not silently break the flow.
  const token = json.token ?? json.Token;
  const image = json.image ?? json.Image;
  if (!token || !image) throw new RegistrarError('Bigshare did not return a captcha');
  return { token, image };
}

/**
 * OCR hook — POSTs the captcha PNG (base64, without the data: URL prefix) to a
 * ddddocr sidecar and returns the recognised characters. Swap in any solver.
 */
async function ocrCaptcha(imageBase64: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(OCR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_b64: imageBase64 }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new RegistrarError(
      `OCR service unreachable at ${OCR_URL}. Start ocr_sidecar.py, or pass a human-solved captcha.`,
    );
  }
  if (!res.ok) throw new RegistrarError(`OCR service returned HTTP ${res.status}`);
  const data = (await res.json()) as { text?: string; error?: string };
  const text = (data.text ?? '').trim();
  if (!text) throw new RegistrarError(data.error ?? 'OCR service returned no text');
  return text;
}

/** Fetch a fresh challenge and solve it immediately with OCR. */
async function solveFreshCaptcha(): Promise<CaptchaChallenge> {
  const challenge = await newCaptcha();
  const imageBase64 = (challenge.image ?? '').replace(/^data:image\/png;base64,/, '');
  if (!imageBase64) throw new RegistrarError('Captcha image missing from challenge');
  const answer = await ocrCaptcha(imageBase64);
  if (!answer) throw new RegistrarError('OCR returned an empty captcha answer');
  return { token: challenge.token, answer, image: challenge.image };
}

/**
 * Bigshare renders the company dropdown straight into the status page and comments
 * out issues whose lookup window has closed. cheerio parses those commented blocks
 * as comment nodes, so selecting `option` elements naturally yields only the live
 * issues.
 */
async function listCompanies(): Promise<RegistrarCompany[]> {
  await politeDelay();
  const html = await getText(STATUS_PAGE, { headers: PAGE_HEADERS });
  const $ = cheerio.load(html);

  return $('#ddlCompany option')
    .toArray()
    .flatMap((el) => {
      const code = ($(el).attr('value') ?? '').trim();
      const name = $(el).text().trim();
      if (!code || !name || name.startsWith('--')) return [];
      return [{ code, name }];
    });
}

/**
 * Shared request builder; identical shape to the site's own XHR.
 */
function buildPayload(query: AllotmentQuery, captcha: CaptchaChallenge | CaptchaAnswer | undefined): Payload {
  const { companyCode, by } = query;
  const useApplication = by === 'application';
  const usePan = by === 'pan';
  const useDemat = by === 'demat';

  // Bigshare keeps CDSL in one field but splits NSDL into the 8-character DP ID
  // and the 8-digit client id, so a stored "IN..." value is cut in half here.
  const nsdl = useDemat && query.demat!.depository === 'NSDL';
  const cdsl = useDemat && query.demat!.depository === 'CDSL';

  return {
    Applicationno: useApplication ? (query.applicationNo ?? '').trim() : '',
    Company: companyCode,
    SelectionType: useApplication ? 'AP' : usePan ? 'PN' : 'BN',
    PanNo: usePan ? (query.pan ?? '').trim().toUpperCase() : '',
    txtcsdl: cdsl ? query.demat!.id : '',
    txtDPID: nsdl ? query.demat!.id.slice(0, 8) : '',
    txtClId: nsdl ? query.demat!.id.slice(8) : '',
    ddlType: useDemat ? query.demat!.depository : '0',
    lang: 'en',
    CaptchaToken: captcha?.token ?? '',
    CaptchaAnswer: captcha?.answer ?? '',
    // Re-reads a record the user already solved a captcha for. Unused here: every
    // lookup this adapter makes is a fresh search.
    ResultToken: '',
  };
}

async function postLookup(payload: Payload): Promise<BigshareData> {
  await politeDelay();
  const json = await postJson<BigshareResponse>(API, payload, {
    headers: { ...PAGE_HEADERS, Accept: 'application/json' },
    timeoutMs: 25_000,
  });
  const d = json.d;
  if (!d) throw new RegistrarError('Bigshare returned an empty response');
  return d;
}

/**
 * Maps a response row to the common lookup shape.
 */
function rowToLookup(rec: BigshareRecord, raw: unknown): AllotmentLookup {
  const applied = toNum(rec.APPLIED);
  const allotted = toNum(rec.ALLOTED);

  return {
    status: allotted > 0 ? 'allotted' : 'not_allotted',
    appliedQty: applied,
    allottedQty: allotted,
    nameOnRecord: (rec.Name ?? '').trim() || null,
    applicationNo: (rec.APPLICATION_NO ?? '').trim() || null,
    raw,
  };
}

function handleResponse(d: BigshareData): AllotmentLookup {
  switch (d.Status) {
    case 'CAPTCHA':
      throw new RegistrarError(d.Message ?? 'Invalid captcha code');
    case 'RATELIMIT':
      throw new RegistrarError(d.Message ?? 'Bigshare throttled this connection. Slow down and retry.');
    case 'WARMING':
      // Allotment data not published yet for this issue. Caller should retry on a
      // schedule instead of treating the applicant as "not applied".
      return { status: 'pending', message: d.Message ?? 'Allotment data is still loading', raw: d };
    case 'NOTFOUND':
      return { status: 'not_applied', message: 'No application found', raw: d };
  }

  // Server-side validation messages for some invalid inputs travel inside DPID.
  const dpid = (d.DPID ?? '').trim();
  if (/^please enter valid/i.test(dpid)) throw new RegistrarError(dpid);

  if (!dpid && !(d.Records?.length)) {
    return { status: 'not_applied', message: 'No application found', raw: d };
  }

  // A PAN/demat search can match several applications under one holder. The first
  // row mirrors the table the website shows; the rest stays in raw for consumers
  // that want the full list (MatchCount + Records are returned by the server).
  const primary =
    d.Records?.length && !dpid && !d.APPLICATION_NO ? d.Records[0] : (d as BigshareRecord);

  return rowToLookup(primary, d);
}

/**
 * Loop that guarantees every attempt carries a valid single-use token:
 *  - attempt 0 may reuse a caller-supplied human answer;
 *  - any later attempt (or a spent token) mints + OCR-solves a fresh captcha;
 *  - after `attempts` failures it surfaces a fresh challenge for a human.
 */
async function attemptWithCaptcha(query: AllotmentQuery, attempts: number): Promise<AllotmentLookup> {
  for (let i = 0; i < attempts; i++) {
    const challenge = query.captcha?.answer && i === 0 ? query.captcha! : await solveFreshCaptcha();
    const d = await postLookup(buildPayload(query, challenge));
    if (d.Status === 'CAPTCHA') continue; // token is spent; next iteration re-solves
    return handleResponse(d);
  }
  throw new CaptchaRequiredError(await newCaptcha(), 'Captcha could not be solved automatically. Please enter the code shown.');
}

async function check(query: AllotmentQuery): Promise<AllotmentLookup> {
  const { by } = query;

  // --- input validation (mirrors the page's own checks) -----------------------
  if (by === 'application') {
    const appNo = (query.applicationNo ?? '').trim();
    if (!appNo) throw new RegistrarError('No application number supplied for this lookup');
  }
  if (by === 'pan') {
    const pan = (query.pan ?? '').trim();
    if (!isValidPan(pan)) throw new RegistrarError(`Invalid PAN number: ${pan}`);
  }
  if (by === 'demat' && !query.demat) {
    throw new RegistrarError('No demat account on file for this applicant');
  }

  /**
   * Hardening recap, verified against the live site (ipo/ipo1/ipo2 hosts):
   *   - PN (PAN): gated server-side. Empty captcha fields -> Status "CAPTCHA",
   *     rejected before the data lookup.
   *   - AP (application no) and BN (demat): NOT gated. Requests with empty
   *     CaptchaToken/CaptchaAnswer pass straight through to the data layer.
   *
   * So AP/BN run captcha-free. PAN runs the auto-solve loop (human answer first
   * if one was supplied, otherwise OCR). If Bigshare ever extends the gate to
   * AP/BN, the server answers Status "CAPTCHA" and we fall into the same loop.
   */

  // ----- AP / BN: direct, captcha-free ---------------------------------------
  if (by === 'application' || by === 'demat') {
    const d = await postLookup(buildPayload(query, undefined));
    if (d.Status === 'CAPTCHA') {
      // Gate extended to this identifier type — transparently auto-solve.
      return attemptWithCaptcha(query, MAX_CAPTCHA_ATTEMPTS);
    }
    return handleResponse(d);
  }

  // ----- PN (PAN): captcha-backed --------------------------------------------
  // Caller-supplied answer counts as one attempt; otherwise OCR, up to N tries.
  return attemptWithCaptcha(query, query.captcha?.answer ? 1 : MAX_CAPTCHA_ATTEMPTS);
}

export const bigshare: RegistrarAdapter = {
  key: 'bigshare',
  name: 'Bigshare Services',
  driver: 'http',
  match: ['bigshare'],
  searchBy: ['application', 'pan', 'demat'],
  /**
   * Not a blanket "needs captcha": AP/BN are ungated today and PAN is automated
   * through the OCR hook. `check` only throws CaptchaRequiredError (with a fresh
   * challenge to show the user) when OCR is unconfigured or exhausted.
   */
  needsCaptcha: false,
  newCaptcha,
  listCompanies,
  check,
};

export { ocrCaptcha };