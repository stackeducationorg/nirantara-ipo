# Deploying the API on Google Cloud (Always Free)

The frontend is already on Vercel. This puts the API on a `e2-micro` VM, which is part of
Google Cloud's Always Free tier — free indefinitely, not a 12-month trial.

**A card is required to activate the free tier.** It is not charged inside the limits, but
Google will not create the account without one.

---

## 1. Create the VM

In the Cloud Console → **Compute Engine → VM instances → Create instance**:

| Setting | Value | Why |
|---|---|---|
| Region | `us-west1`, `us-central1` or `us-east1` | Only these three qualify for Always Free |
| Machine type | `e2-micro` | Any larger type is billed |
| Boot disk | Debian 12, **30 GB standard** | 30 GB standard is the free allowance; balanced/SSD is billed |
| Firewall | Allow HTTP **and** HTTPS | Otherwise nothing reaches nginx |

Getting the region or machine type wrong is the usual reason people see a bill.

Then reserve the address: **VPC network → IP addresses → the instance's external IP →
Reserve**. An ephemeral IP changes on restart and breaks your DNS record.

## 2. Point your domain at it

Add an **A record** for the API hostname:

```
api.yourdomain.com   A   <the reserved external IP>
```

Wait until it resolves before step 3 — certbot verifies over the public internet and will
fail otherwise:

```bash
dig +short api.yourdomain.com
```

## 3. Run the setup script

SSH into the VM from the console, then:

```bash
curl -fsSL https://raw.githubusercontent.com/stackeducationorg/nirantara-ipo/main/deploy/setup.sh \
  | sudo bash -s -- api.yourdomain.com you@example.com
```

It provisions swap, Node 22, the service user, the build, Chromium, nginx, and a Let's
Encrypt certificate. It is safe to re-run.

Check it:

```bash
curl https://api.yourdomain.com/api/health
```

## 4. Seed the IPO data

The schedulers start on boot, but the first sync is worth running by hand so the database
is populated immediately:

```bash
cd /opt/nirantara/server && sudo -u nirantara npx tsx src/cli/sync.ts
```

## 5. Connect the frontend

Set the API URL on Vercel and redeploy:

```bash
cd web
npx vercel env add VITE_API_BASE production    # https://api.yourdomain.com/api
npx vercel deploy --prod
```

Then add that same frontend origin to `CORS_ORIGINS` in `/opt/nirantara/server/.env` and
restart:

```bash
sudo nano /opt/nirantara/server/.env
sudo systemctl restart nirantara-api
```

Both halves are required: Vercel needs to know where the API is, and the API needs to
accept the browser's origin.

---

## Day-to-day

```bash
sudo systemctl status nirantara-api      # is it running
sudo journalctl -u nirantara-api -f      # live logs
sudo systemctl restart nirantara-api     # restart
```

Deploy a new version:

```bash
cd /opt/nirantara && sudo git pull
cd server && sudo -u nirantara npx tsc -p tsconfig.json
sudo systemctl restart nirantara-api
```

## Back up the database

Everything — accounts, PANs, the money ledger, GMP history — is one SQLite file.

```bash
sudo -u nirantara sqlite3 /opt/nirantara/server/data/niranthar.db \
  ".backup '/tmp/niranthar-$(date +%F).db'"
```

Keep a copy of `PAN_ENCRYPTION_KEY` from `.env` somewhere safe and separate. Without it the
stored PANs cannot be decrypted, even with the database file.

---

## Staying inside the free limits

The allowance that actually bites is **1 GB/month of network egress from North America**.
JSON responses are small, but logo images are proxied through the API, which is why nginx
caches `/api/media/` for 30 days and the app sets a long `Cache-Control`.

To watch it: **Billing → Reports**, filtered to Compute Engine. Set a **budget alert at
$1** so you hear about a mistake immediately rather than at the end of the month.

If egress becomes a problem, the fix is to stop proxying logos through the API and let the
frontend load them from Vercel instead.

## Memory

An `e2-micro` has 1 GB. Chromium is the only heavy component, and it runs at most twice an
hour to read KFin's issue list. Two guards are in place:

- 2 GB swap, so a spike does not trigger the OOM killer
- `MemoryMax=820M` on the unit, so systemd restarts the API rather than the kernel killing
  something unpredictable

If it still proves unstable, set `ENABLE_BROWSER_REGISTRARS=false` in `.env`. Every
per-PAN KFin and Bigshare lookup keeps working — only the KFin issue list stops refreshing
on its own.
