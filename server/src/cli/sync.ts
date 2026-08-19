/**
 * Maintenance CLI.
 *
 *   npm run sync -w server                 # pull IPOs + GMP once
 *   npm run sync -w server -- watch        # run the allotment watcher once
 *   npm run sync -w server -- list         # show what is in the database
 *   npm run sync -w server -- resolve "Skyways Air"   # which registrar handles an issue
 *   npm run sync -w server -- probe kfintech          # open a registrar page for selector work
 */
import { config } from '../config.js';
import { db } from '../db/index.js';
import { watchAllotments } from '../jobs/allotmentWatcher.js';
import { withPage, closeBrowser } from '../registrars/browser.js';
import { registrars, resolveRegistrar } from '../registrars/index.js';
import { browserProfiles } from '../registrars/profiles.js';
import { refreshStatuses, syncIpos, syncSubscriptions, listIpos } from '../services/ipoStore.js';

const [command = 'sync', ...args] = process.argv.slice(2);

async function main() {
  switch (command) {
    case 'sync': {
      const { total, gmpChanges } = await syncIpos();
      refreshStatuses();
      await syncSubscriptions().catch(() => 0);
      console.log(`\nSynced ${total} IPOs. ${gmpChanges.length} GMP moves recorded.`);
      break;
    }

    case 'watch': {
      await watchAllotments();
      console.log('\nAllotment watcher finished a pass.');
      break;
    }

    case 'list': {
      const rows = listIpos();
      console.table(
        rows.slice(0, 40).map((r) => ({
          name: r.name.slice(0, 32),
          cat: r.category,
          status: r.status,
          open: r.open_date,
          boa: r.boa_date,
          registrar: r.registrar_key ?? '-',
        })),
      );
      console.log(`${rows.length} IPOs in the database.`);
      break;
    }

    case 'resolve': {
      const name = args.join(' ');
      if (!name) throw new Error('Usage: resolve "<company name>"');
      const match = await resolveRegistrar(name);
      console.log(match ? match : `No registrar currently lists an issue matching "${name}"`);
      break;
    }

    case 'companies': {
      const key = args[0];
      const adapter = registrars.get(key ?? '');
      if (!adapter) throw new Error(`Unknown registrar. Known: ${[...registrars.keys()].join(', ')}`);
      const companies = await adapter.listCompanies();
      console.table(companies);
      console.log(`${companies.length} issues open at ${adapter.name}.`);
      break;
    }

    /**
     * Opens a registrar's page in a visible browser and prints the selects/inputs it finds, so
     * the selector profile can be corrected against the real markup.
     */
    case 'probe': {
      const key = args[0];
      const profile = browserProfiles().find((p) => p.key === key);
      if (!profile) throw new Error(`Unknown profile. Known: ${browserProfiles().map((p) => p.key).join(', ')}`);

      process.env.BROWSER_HEADLESS = 'false';
      await withPage(async (page) => {
        await page.goto(profile.url, { waitUntil: 'networkidle' }).catch(() => {});
        const fields = await page.$$eval('select, input, button', (els) =>
          els.slice(0, 60).map((el) => ({
            tag: el.tagName.toLowerCase(),
            id: (el as HTMLElement).id || null,
            name: (el as HTMLInputElement).name || null,
            type: (el as HTMLInputElement).type || null,
            options: el.tagName === 'SELECT' ? (el as HTMLSelectElement).options.length : null,
          })),
        );
        console.log(`\nFields found on ${profile.url}:`);
        console.table(fields);
        console.log('\nCurrent profile:', profile);
        console.log(`\nPut corrections in ${config.dataDir}/registrar-profiles.json under "${key}".`);
        await page.waitForTimeout(20_000);
      });
      break;
    }

    default:
      console.log('Commands: sync | watch | list | resolve <name> | companies <key> | probe <key>');
  }
}

main()
  .catch((err) => {
    console.error(`\n${err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeBrowser();
    db.close();
  });
