# Google Play submission — Nirantara IPO

Everything to paste into Play Console. Package: `com.niranthar.ipo` · Free · App · Category: Finance.

## 1. Build and upload

```
cd mobile
npx eas-cli login
npx eas-cli build --platform android --profile production
```

- Let EAS generate and keep the upload key when asked.
- `eas.json` uses `appVersionSource: "remote"`. On the first build EAS asks to initialise the
  versionCode — accept the value from app config (11). After that it increments on every
  production build by itself.
- The first `.aab` must be uploaded by hand in Play Console (Test and release → Testing →
  Closed testing → Create release). Later ones can go through `npx eas-cli submit`.

## 2. Google Sign-In after Play App Signing

Play re-signs the app with its own key, so the Play build has a different SHA-1 from EAS builds.

1. Play Console → Test and release → App integrity → App signing → copy **App signing key
   certificate SHA-1**.
2. Google Cloud Console (project 1063536050082) → APIs & Services → Credentials → create an
   **Android** OAuth client: package `com.niranthar.ipo`, that SHA-1. Keep the existing one for
   EAS/sideloaded builds.
3. Firebase → Project settings → Android app → Add fingerprint → same SHA-1.

Skip this and Google login fails only for Play Store installs.

## 3. Store listing

**App name:** Nirantara IPO

**Short description (≤80):**
Live IPO GMP, calendar & automatic allotment check for all your PANs

**Full description:**

Nirantara IPO keeps track of every mainboard and SME IPO so you don't have to.

• Live GMP — grey market premium for open and upcoming issues, with history
• IPO calendar — open, close, allotment and listing dates in one place
• Automatic allotment check — save the PANs you apply with (yours, family's) and we check every
  one of them with the registrar as soon as allotment is out
• Push alerts — when an IPO opens, the day it closes, when allotment lands, and your result
• Money tracker — record what you applied for and see what is blocked, refunded or invested
• Sync with the website — the same PAN book on your phone and nirantara.cloud

Your PANs are encrypted at rest (AES-256-GCM) and are only ever sent to the registrar handling
the issue. We never ask for your bank, demat or broker login.

Nirantara IPO is an information and tracking tool. It is not a stockbroker, is not registered
with SEBI, does not place IPO applications and does not give investment advice. GMP is unofficial
market data and is no indication of listing price.

**Graphics needed:** 512×512 icon (PNG, 32-bit), 1024×500 feature graphic, 2–8 phone
screenshots (e.g. Home, GMP, IPO detail, Allotment, Money).

**Contact email:** stack.nirantaraipo@gmail.com · **Website:** https://www.nirantara.cloud

## 4. App content (Policy → App content)

| Section | Answer |
|---|---|
| Privacy policy | https://www.nirantara.cloud/privacy |
| Ads | No ads (change if the app shows any) |
| App access | "All or some functionality is restricted" → give a demo email + password (register one on the live site first, add a sample PAN) |
| Content rating | Category: Utility/Productivity/Communication/Other. No violence, sexual content, gambling, user interaction or location sharing → rated Everyone/3+ |
| Target audience | 18 and over only |
| News app | No |
| Government app | No |
| Financial features | "My app doesn't provide any financial features" does NOT fit — choose the tracking/info option; state it does not trade, lend, hold funds or place applications |
| Health | No |
| Data safety | See below |
| Account deletion URL | https://www.nirantara.cloud/delete-account |

## 5. Data safety

- Collects or shares user data: **Yes**
- All data encrypted in transit: **Yes**
- Users can request deletion: **Yes** (in app: Accounts → Delete account; web URL above)

| Data type | Collected | Shared | Optional? | Purpose |
|---|---|---|---|---|
| Personal info → Email address | Yes | No | Required | Account management |
| Personal info → Name | Yes | No | Optional | Account management |
| Personal info → User IDs (Google account id) | Yes | No | Optional | Account management |
| Financial info → Other financial info (PAN, demat number) | Yes | **Yes** (to the IPO's registrar) | Optional | App functionality |
| App activity → Other user-generated content (applications, watchlist) | Yes | No | Optional | App functionality |
| Device or other IDs (push token) | Yes | No | Optional | App functionality |

Not collected: location, contacts, photos, bank details, broker credentials, crash/analytics.
Processed ephemerally: No for all of the above (they are stored).

## 6. Testing track

Personal developer accounts created after Nov 2023 need a **closed test with ≥12 testers
opted in for 14 consecutive days** before Production can be requested. Add testers by email
list, share the opt-in link, and keep them installed for the full 14 days.
