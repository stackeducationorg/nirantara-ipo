/**
 * Exercises the captcha handshake for registrars that need one.
 *
 *   npm run captchatest -w server
 *
 * Talks to the live registrar, so this is a health check rather than a unit test: a failure
 * usually means the registrar changed its challenge, not that the code regressed.
 */
import { registrars } from '../registrars/index.js';
import { CaptchaRequiredError } from '../registrars/types.js';

const DUMMY_PAN = 'AAAPZ1234C';

let failures = 0;
const pass = (m: string) => console.log(`  PASS  ${m}`);
const fail = (m: string, d?: unknown) => {
  failures += 1;
  console.log(`  FAIL  ${m}`);
  if (d !== undefined) console.log(`        ${String(d).slice(0, 200)}`);
};

const targets = [...registrars.values()].filter((a) => a.needsCaptcha);
console.log(`Testing ${targets.length} registrar(s) that require a captcha\n`);

for (const adapter of targets) {
  console.log(`${adapter.key}  (${adapter.name})`);

  const companies = await adapter.listCompanies().catch((err) => {
    fail('listCompanies', (err as Error).message);
    return [];
  });
  if (companies.length === 0) {
    fail('no issues open, cannot exercise the lookup');
    continue;
  }
  pass(`listCompanies -> ${companies.length} issues`);

  // 1. A lookup with no captcha must hand back a challenge, not an opaque failure.
  let first: CaptchaRequiredError | null = null;
  try {
    await adapter.check({ companyCode: companies[0].code, pan: DUMMY_PAN });
    fail('check without a captcha was answered — the challenge is not being enforced');
  } catch (err) {
    if (err instanceof CaptchaRequiredError) {
      first = err;
      const looksLikeImage = err.challenge.image.startsWith('data:image/');
      pass('check without a captcha -> CaptchaRequiredError');
      if (looksLikeImage && err.challenge.token) {
        pass(`challenge carries a token and a ${err.challenge.image.length}-char data: image`);
      } else {
        fail('challenge is malformed', JSON.stringify(err.challenge).slice(0, 120));
      }
    } else {
      fail('check without a captcha threw the wrong error', (err as Error).message);
    }
  }

  // 2. A wrong answer must be reported as such, with a *new* challenge — the spent token
  //    cannot be retried, so handing the same one back would loop forever.
  if (first) {
    try {
      await adapter.check({
        companyCode: companies[0].code,
        pan: DUMMY_PAN,
        captcha: { token: first.challenge.token, answer: 'WRONG1' },
      });
      fail('a deliberately wrong captcha answer was accepted');
    } catch (err) {
      if (err instanceof CaptchaRequiredError) {
        pass(`wrong answer rejected: ${err.message}`);
        if (err.challenge.token !== first.challenge.token) {
          pass('a fresh challenge was issued rather than reusing the spent one');
        } else {
          fail('the spent token was handed back — a retry would fail again');
        }
      } else {
        fail('wrong answer threw the wrong error', (err as Error).message);
      }
    }
  }
  console.log();
}

console.log(failures === 0 ? 'Captcha handshake behaving correctly.\n' : `${failures} check(s) failed.\n`);
process.exitCode = failures === 0 ? 0 : 1;
