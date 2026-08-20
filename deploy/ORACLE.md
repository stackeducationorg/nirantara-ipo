# Deploying the API on Oracle Cloud (Always Free)

Oracle's Always Free tier is the most generous of the free options: an Ampere ARM instance with
up to **4 cores and 24 GB of RAM**, always on, with a real disk. Free indefinitely, not a trial.

That headroom matters here — Chromium for the KFin issue list runs comfortably, where a 1 GB
machine would need swap and careful memory caps.

---

## 1. Create the instance

**Compute → Instances → Create instance**

| Setting | Value | Why |
|---|---|---|
| Image | **Ubuntu 22.04** | The setup script targets Debian/Ubuntu |
| Shape | **VM.Standard.A1.Flex** | The ARM shape is the generous one |
| OCPUs / Memory | **4 OCPU, 24 GB** | The full Always Free ARM allowance |
| Boot volume | 50 GB | Well inside the 200 GB free total |
| SSH keys | Upload or generate | You need these to log in |

Save the private key when it offers it — there is no second chance.

> **If you see "Out of host capacity"** — this is common for the free ARM shape and is not
> your fault. Either retry in a different availability domain, or try again later; capacity
> frees up in waves. Falling back to `VM.Standard.E2.1.Micro` (1 GB) also works, but then set
> `ENABLE_BROWSER_REGISTRARS=false` in `.env` afterwards, since Chromium will not fit.

## 2. Open the cloud firewall

**Networking → Virtual Cloud Networks → your VCN → Subnets → your subnet → Security Lists →
Default Security List → Add Ingress Rules**

Add two rules:

| Source CIDR | Protocol | Destination port |
|---|---|---|
| `0.0.0.0/0` | TCP | 80 |
| `0.0.0.0/0` | TCP | 443 |

## 3. Point your domain

Copy the instance's **public IP** from the console, then add an A record at your registrar:

```
api.yourdomain.com   A   <public IP>
```

Confirm it resolves before the next step — certbot verifies over the public internet:

```bash
dig +short api.yourdomain.com
```

## 4. Run the setup script

SSH in (Ubuntu images use the `ubuntu` user):

```bash
ssh -i /path/to/your-key.key ubuntu@<public IP>
```

Then:

```bash
curl -fsSL https://raw.githubusercontent.com/stackeducationorg/nirantara-ipo/main/deploy/setup.sh \
  | sudo bash -s -- api.yourdomain.com you@example.com
```

This installs Node 22, builds the server, installs Chromium, **opens the host firewall**,
configures nginx and issues a Let's Encrypt certificate. Safe to re-run.

Check it:

```bash
curl https://api.yourdomain.com/api/health
```

## 5. Seed the IPO data

```bash
cd /opt/nirantara/server && sudo -u nirantara npx tsx src/cli/sync.ts
```

## 6. Connect the frontend

Two halves, both required.

On your PC:

```bash
cd web
npx vercel env add VITE_API_BASE production    # https://api.yourdomain.com/api
npx vercel deploy --prod
```

On the server, add your Vercel URL to the allowed origins:

```bash
sudo nano /opt/nirantara/server/.env          # CORS_ORIGINS=https://your-vercel-url
sudo systemctl restart nirantara-api
```

---

## The Oracle-specific trap

**Oracle has two firewalls.** Opening the Security List in the console is only half of it —
Ubuntu images on Oracle also ship local `iptables` rules that drop everything except SSH.

This is the number one reason an Oracle deployment looks completely dead on ports 80 and 443
even though the console shows the ports open.

The setup script handles the host side for you. To verify by hand:

```bash
sudo iptables -L INPUT -n --line-numbers | grep -E "80|443"
```

If port 80 is closed at this layer, certbot cannot complete its challenge and TLS will fail
with a confusing timeout rather than a clear error.

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

Everything — accounts, PANs, the money ledger, GMP history — is one SQLite file:

```bash
sudo -u nirantara sqlite3 /opt/nirantara/server/data/niranthar.db \
  ".backup '/tmp/niranthar-$(date +%F).db'"
```

Keep a copy of `PAN_ENCRYPTION_KEY` from `.env` somewhere separate. Without it the stored PANs
cannot be decrypted, even with the database file in hand.

## Staying free

The Always Free ARM allowance is 4 OCPU and 24 GB across all your instances — one instance at
that size uses it entirely, which is what you want here.

Oracle reclaims **idle** Always Free compute instances. This server runs cron jobs continuously,
so it will not read as idle, but it is worth knowing the policy exists.

Egress is 10 TB/month, so unlike the 1 GB cap on Google's free tier, bandwidth is not a concern.
