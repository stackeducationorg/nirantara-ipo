# Nirantara IPO

IPO tracker for the Indian market — live GMP and issue details, a saved PAN book, and
**automatic allotment checking across every saved account** with push notifications.

A React website and a React Native (Expo) app share one Node/SQLite backend.

## The gap this closes

Existing trackers make you open the app, pick an IPO, type a PAN, solve a captcha, and repeat
for every family account. They also stay quiet when results land.

Here the backend does that work:

- **Auto-check after allotment.** Once an IPO reaches its basis-of-allotment date, a watcher
  polls the registrar. The moment results go live it sweeps **every saved PAN** by itself.
- **Aggregate result, pushed.** You get one notification that says how many accounts were
  allotted, not a per-PAN scavenger hunt:
  `3 of 7 accounts allotted • 300 shares • ₹41,400`
- **Full IPO lifecycle alerts.** Issue opens, closing tomorrow, last day, allotment out,
  listing day, and sharp GMP moves — each with a per-account on/off switch and a GMP threshold.
- **PAN book.** Save each account once with a label (Self, Spouse, Father). The registrar's
  name-on-record is adopted automatically the first time it is seen.


## Money tracking

Allotment tells you *whether* you got shares. This tells you where the money went.

Open any IPO and every saved PAN is listed with a lot stepper. Mark how many lots each
account applied for — or tap **Applied 1 lot from all** — and the app computes the amount
blocked per account at the cut-off price, plus the total across the family.

Once allotment is published, the ledger settles itself from the registrar results:

| Outcome | What the ledger records |
|---|---|
| Fully allotted | whole block converted to shares, nothing owed back |
| Partly allotted | debited for the allotted shares, remainder marked refund due |
| Not allotted | full amount marked refund due |

Each refund can then be confirmed with **Mark refunded** once the money is actually back in
the bank. Re-checking allotment never resets a refund you already confirmed.

The **Money** tab rolls it all up: currently blocked, refund due, refunded, and total
invested — with a per-IPO breakdown.

Amounts use the cut-off (upper band) price, which is what ASBA actually blocks.

## Layout

```
server/    Express + SQLite + registrar adapters + cron jobs + push fan-out
web/       React + Vite + TanStack Query
mobile/    Expo (React Native) — same API, same palette
```

## Running it

```bash
npm install                    # installs server + web
cd mobile && npm install       # the app has its own dependency tree

cp server/.env.example server/.env    # optional for local dev

npm run dev                    # API on :4000, website on :5173
npm run dev:mobile             # Expo dev server
```

On first boot the server pulls the IPO universe and starts its schedulers. To seed manually:

```bash
npm run sync -w server              # pull IPOs + GMP now
npm run sync -w server -- list      # show what is stored
npm run sync -w server -- watch     # run one allotment-watcher pass
npm run selftest -w server          # end-to-end check of the allotment path
npm run moneytest -w server         # money ledger settlement maths
npm run kfintest -w server          # KFin response parser
```

Create an account with an email and password on first run. The phone app can either sign in with
the same credentials or link instantly using the sync key shown under **Accounts**.

## Data sources

**IPO details, GMP, subscription** come from InvestorGain's JSON reports (report ids `331` GMP,
`394` calendar, `333` subscription). GMP is sampled only when it actually changes, so the
history chart stays meaningful.

**Allotment** goes to the registrar handling each issue. The registrar and its internal company
code are discovered by matching the IPO name against each registrar's own dropdown — that
matching is what makes a lookup possible at all, since every registrar keys on its own code.

| Registrar | How it is reached | Status |
|---|---|---|
| **KFin Technologies** | Direct JSON API (`ipostatus.kfintech.com`) | **Verified** — no captcha, no token |
| **Bigshare** | Direct JSON API | **Verified end to end** |
| Skyline, Maashitla, Purva, Cameo | Playwright form driver | Selectors need confirming against the live page |
| MUFG (Link Intime) | Playwright form driver | Behind Akamai; selectors unverified |

### How KFin works, and why it is not actually walled

KFin moved its allotment lookup to `ipostatus.kfintech.com` — a React app backed by an
unauthenticated AWS API Gateway lambda. The old `kosmic.kfintech.com` WebForms page now just
prints a "we have moved" notice, which is what makes KFin look impenetrable if you probe the
old host. The live call is:

```
GET https://0uz601ms56.execute-api.ap-south-1.amazonaws.com/prod/api/query?type=pan
    reqparam: <PAN>          client_id: <issue's client id>
```

No captcha, no cookie, no token — the PAN and issue id travel as request *headers*. So every
per-PAN lookup is plain HTTP. Only the issue dropdown is rendered client-side, so that one list
is read with a headless browser and cached for 30 minutes; the actual N-PANs-by-M-IPOs sweep
never opens a browser.

The remaining selector profiles in `server/src/registrars/profiles.ts` are documented starting
points, not verified truth. Confirm and correct them without editing code:

```bash
npm run sync -w server -- probe kfintech      # opens the page, prints the real fields
npm run sync -w server -- companies bigshare  # what a registrar currently lists
```

then drop overrides into `server/data/registrar-profiles.json`:

```json
{ "kfintech": { "companySelect": "#realId", "panInput": "#realPan" } }
```

## Accounts and security

Sign-in is email + password. Passwords are hashed with **scrypt** (`N=16384`, per-password salt,
constant-time verification) — memory-hard and built into Node, so there is no native build step.
Sign-in and sign-up are rate limited per IP, and a wrong email and a wrong password return the
same message so neither can be probed.

A session is a bearer token stored per device. Changing a password revokes every other device.
Each account also gets a sync key (`NRTH-XXXX-XXXX-XXXX`) for linking the phone app without
retyping credentials.

- PANs are encrypted at rest with AES-256-GCM (`PAN_ENCRYPTION_KEY`) and are only ever sent to
  the official registrar. The API returns them masked (`AAA••••34C`); the plaintext leaves the
  database only for a lookup.
- A separate HMAC is stored purely so a duplicate PAN can be detected without decrypting.
- `helmet`, `compression` and a CORS allowlist are on by default; `trust proxy` is set so the
  rate limiter sees real client IPs behind a load balancer.
- `/api/admin/*` job triggers require `ADMIN_TOKEN` and 404 when it is unset.
- The logo proxy (`/api/media/logo`) is restricted to an explicit host allowlist so it cannot be
  used as an open proxy.

## Design

One design system across both builds: a light and dark palette driven by CSS custom properties
on the web and a matching token object in the app. The theme control cycles light → dark →
system, is remembered per device, and follows the OS while set to system. The theme is applied
before first paint so there is no flash of the wrong palette.

The interface uses a stroke-based inline SVG icon set — there are no emoji anywhere in the
product surface.

## Notes and limits

- GMP is an unofficial grey-market signal. It is surfaced with that disclaimer in the UI and is
  not investment advice.
- The allotment watcher polls every 10 minutes during an allotment window and stops as soon as
  every account has been notified for that IPO.
- Amounts are computed at the cut-off (upper band) price, which is how allotments are priced.
- SQLite is intentional for a single-node deployment. The schema is plain SQL in
  `server/src/db/index.ts` and ports to Postgres without much work.
- Expo push needs a real device (not a simulator) and an EAS project id for a standalone build.
  On a physical phone the app resolves the API host from the Expo bundle host automatically.
