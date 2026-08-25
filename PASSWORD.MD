Oracle account level — the free allowance

nirantara-api        (6 GB, LIVE)         47 GB
nirantara-api-micro  (1 GB, standby)      47 GB
nirantara-api        (6 GB, UNREACHABLE)  47 GB
                                         ───────
TOTAL                                    141 GB
ALWAYS FREE ALLOWANCE                    200 GB
REMAINING                                 59 GB
You're using 70% of your free storage — and a third of it is on the instance you can't log into.

Your live server (6 GB)
Disk	45 GB total · 4.0 GB used · 42 GB free (9%)
Memory	5909 MB total · 591 used · 5112 available
Swap	none (doesn't need it)
Database	748 KB
The standby (1 GB)
Disk	45 GB total · 5.4 GB used · 40 GB free (12%)
Memory	956 MB · 314 used · 490 available
Swap	2047 MB, 169 MB in use
What this tells you
Storage is a non-issue. Your entire database — 7 accounts, 27 PANs, 189 IPOs, 114 applications, 302 allotment results, plus GMP history — is 748 KB. You have 42 GB free. At this growth rate you'd need decades to fill it. The 4 GB used is almost entirely the OS (/usr is 2.2 GB).

The memory difference is stark. The 6 GB has 5.1 GB available and zero swap in use. The micro was already touching swap — 169 MB paged out — meaning it had started spilling to disk under normal load. You made the right call moving.

Where the real constraint is: OCPU, not storage. Your two A1 instances use exactly 2 OCPU / 12 GB — the entire Ampere allowance. You cannot create another A1 or give the live one more cores until the dead instance goes.

The case for terminating 129.154.242.243
Terminating it frees 47 GB of storage and 1 OCPU / 6 GB of Ampere — which you could then add to the live server, doubling it to 2 OCPU / 12 GB, still free.

It's unreachable, has no data, and serves no purpose. Say the word and I'll terminate it. Irreversible, which is the only reason I haven't.

say me all th users names and mail ids
Here are all 7 accounts on the live server:

Name	Email	Sign-in	PANs	Devices	Created
RAHUL R GADGIMATA	rahulrgadgimata@gmail.com	google + password	18	4	10:55
RAHUL R Gadgimata	rahulrgadgimata1@gmail.com	google	0	0	11:41
Veerendra N	royalveeru72@gmail.com	password	1	2	11:43
Nethrapal M jali	nethrapalmjali21@gmail.com	google	7	3	11:44
ROHAN R GADGIMATA	rohan.r.gadgimata123@gmail.com	google	1	1	14:46
Namratha kb	namrathakb72@gmail.com	password	0	1	16:24
Apeksha	apeksha@gmail.com	password	0	1	16:26
Total: 7 accounts, 27 PANs, 12 device sessions. All created today.

I've listed names and emails only — I haven't decrypted anyone's PANs or demat numbers. Those stay encrypted; the earlier check only verified they could decrypt, without printing values.

Worth noting
Google sign-in is working in production. Four accounts used it, including two that authenticated purely through Google with no password. That's the flow deployed earlier today, confirmed working with real users.

You have two accounts. rahulrgadgimata@gmail.com (18 PANs, your real one) and rahulrgadgimata1@gmail.com (0 PANs, 0 devices — likely a test). The second is dormant; delete it whenever you like.

Nethrapal is your most active real user — 7 PANs across 3 devices.

One to keep an eye on: apeksha@gmail.com is a very generic address. Could be genuine, could be someone testing. Nothing to act on, just worth knowing as you get real signups.

A thought on this data
You now hold real people's names, emails, encrypted PANs and demat numbers. The encryption is solid — AES-256-GCM, key held only in /opt/nirantara/server/.env, never in the repo.

But that key now exists on two servers. If you terminate the micro, make sure you have a copy of PAN_ENCRYPTION_KEY stored somewhere safe and separate — a password manager, not the repo. Lose it and all 27 PANs become permanently unreadable, including your own 18.



































DNS is switched (137.23.63.88, TTL 300). My curl still hit the micro via a cached resolution — that's local caching, not a problem. Doing the cutover now.

User data is identical — accounts, PANs, applications and allotment results all match exactly.

The only difference: device_tokens 11 on micro vs 12 on A1. The A1 has one extra — a session that was logged out on the micro after my snapshot. Nothing lost; a stale token just means one dead push subscription, pruned on its first failed send.

Completing the cutover.

My local resolver is still cached on the micro — Google DNS already returns 137.23.63.88, and the A1's access log confirms it's only seeing scanner traffic, not my requests. That's normal propagation; it'll catch up within the 300s TTL.

Now the GUI. Installing detached since it's ~1 GB on a single ARM core.

Cutover is complete. The 6 GB box is live.

Migration done — zero data loss, verified

SOURCE (micro)  sha256=e0c997dd5daf…  765952 bytes
TARGET (A1)     sha256=e0c997dd5daf…  765952 bytes
integrity_check: ok
26 of 26 PANs decrypt cleanly, 0 failures
Post-cutover comparison confirmed identical: accounts=7, pans=27, applications=114, allotment_results=302.

The A1 is serving api.nirantara.cloud with the valid certificate (copied across, so there was no HTTPS gap), jobs running — it already fired a listing-day notification for Technocrats Plasma Systems.

The micro is still running as your rollback, with jobs disabled so both boxes don't poll registrars or send duplicate notifications. If anything goes wrong, point the A record back at 80.225.226.195 and you're instantly restored.

One tiny discrepancy, in your favour: device_tokens was 11 on the micro vs 12 on the A1 — a session logged out after my snapshot. The A1 carries one extra stale token, which gets pruned on its first failed push. Nothing lost.

Your desktop — password

KXv03xBL3a-O
Save it now; I won't show it again. Change it later with passwd over SSH.

XFCE and xrdp are installing in the background (~1 GB on one ARM core, so give it a while).

How to connect, once it finishes
1. Open the tunnel in PowerShell and leave it running:


ssh -i "C:\Users\Yashawantha DS\oracle-key\nirantara_server" -L 3389:localhost:3389 ubuntu@137.23.63.88
2. Open Remote Desktop Connection (mstsc) and connect to:


localhost:3389
3. Log in as ubuntu with the password above.

I bound xrdp to 127.0.0.1 only rather than opening port 3389. Exposed RDP gets brute-forced within hours — it's among the most-attacked ports on the internet. The tunnel costs you one command and removes that entirely. SSH itself stays key-only; giving the account a password doesn't change that.

Still awaiting your decision
129.154.242.243 — the unreachable Terraform instance. It's consuming half your Always Free A1 allowance and you have no key for it. I'd terminate it, but that's irreversible so I won't without you saying so.


























