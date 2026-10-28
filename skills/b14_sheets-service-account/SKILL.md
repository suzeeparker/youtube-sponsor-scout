---
name: b14_sheets-service-account
description: >-
  Use before any Google Sheets write from a tool, or when the user asks to set
  up or check Google Sheets access: makes sure a working Google service account
  (GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY) and
  GOOGLE_SHEETS_SPREADSHEET_ID are in the calling tool's .env and can open the
  sheet, creating the service account and key with the gcloud CLI and walking
  the user through sharing the sheet.
---
# b14_sheets-service-account

Ensures a tool's `.env` has a Google service account that can open the user's Google Sheet. A service account is a separate robot identity; it can only open sheets shared with its email. It does NOT give access to the user's Gmail, Calendar, or Drive. Never print, quote, or log the private key. Never ask for the user's Google password, never sign in to Google in the bot's own browser, and never accept keys pasted in chat. Ask questions in plain text with numbered choices, not question cards (cards may not display on the user's phone).

If the user has no Google account or Cloud project yet, point them to [SETUP.md: Sheets service account](https://github.com/suzeeparker/youtube-sponsor-scout/blob/main/SETUP.md#4-sheets-service-account).

## Input
- `TOOL`: the folder of the tool that needs Sheets access (e.g. `/workspace/agent-tools/youtube-sponsor-scout`). Its `.env` is `TOOL/.env`.
- `SA_NAME`: a short service-account ID for the tool, 6-30 lowercase letters/digits/dashes (e.g. `sponsor-scout`).
- `SHEET_BY_CALLER` (optional): set when the calling skill creates or checks the sheet itself (b10 does this with b15_sponsor-sheet). Then this skill only makes sure the service account works: `auth: ok` with `NO_SHEET_ID` counts as done, and Steps 6 and 7 are skipped.

## Step 0: Write the check script
Write this once to `/tmp/b14-check.mjs`. It prints only status JSON (the service-account email is fine to show; the key never is):
```
cat > /tmp/b14-check.mjs <<'EOF'
import fs from "fs"; import path from "path"; import crypto from "crypto";
const TOOL = process.argv[2]; const env = {};
try { for (const l of fs.readFileSync(path.join(TOOL, ".env"), "utf8").split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (!m) continue;
  let v = m[2].trim(); if (/^(["']).*\1$/s.test(v)) v = v.slice(1, -1); env[m[1]] = v; } } catch {}
const out = (o) => { console.log(JSON.stringify(o)); process.exit(0); };
const sheet = env.GOOGLE_SHEETS_SPREADSHEET_ID;
let email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL, key = env.GOOGLE_PRIVATE_KEY, src = "EMAIL+PRIVATE_KEY";
const f = env.GOOGLE_APPLICATION_CREDENTIALS;
if ((!email || !key) && f) { try { const j = JSON.parse(fs.readFileSync(path.resolve(TOOL, f), "utf8")); email = j.client_email; key = j.private_key; src = "CREDENTIALS_FILE"; } catch { out({ ok: false, error: "credentials file unreadable: " + f }); } }
if (!email || !key) out({ ok: false, error: "NO_SERVICE_ACCOUNT" });
const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url"); const now = Math.floor(Date.now() / 1000);
const u = b({ alg: "RS256", typ: "JWT" }) + "." + b({ iss: email, scope: "https://www.googleapis.com/auth/spreadsheets", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 600 });
let jwt; try { jwt = u + "." + crypto.createSign("RSA-SHA256").update(u).sign(key.replace(/\\n/g, "\n"), "base64url"); } catch { out({ ok: false, email, error: "private key invalid" }); }
const t = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }) })).json();
if (!t.access_token) out({ ok: false, email, source: src, error: "auth failed: " + (t.error_description || t.error) });
if (!sheet) out({ ok: false, auth: "ok", email, source: src, error: "NO_SHEET_ID" });
const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheet)}?fields=properties.title,sheets.properties.title`, { headers: { Authorization: "Bearer " + t.access_token } });
const s = await r.json();
if (!r.ok) out({ ok: false, auth: "ok", email, source: src, sheetId: sheet, status: r.status, error: s.error?.message });
out({ ok: true, auth: "ok", email, source: src, sheetTitle: s.properties?.title, tabs: (s.sheets || []).map(x => x.properties.title) });
EOF
```

## Step 1: Check
`node /tmp/b14-check.mjs "$TOOL"`
- `ok: true`: say "Google Sheets access OK" with the sheet title and tabs, and stop.
- `NO_SERVICE_ACCOUNT`, `private key invalid`, or `auth failed`: go to Step 2.
- `auth: ok` but `NO_SHEET_ID`: if `SHEET_BY_CALLER` is set, say "Service account OK" with its email and stop; otherwise go to Step 6.
- `auth: ok` with status 403 or 404: the sheet isn't shared with the service account (or the ID is wrong); go to Step 7.
- `status` 403 with "API has not been used" / "disabled": enable `sheets.googleapis.com` in the service account's project (Step 5's enable line) and re-check.

## Step 2: Check for the gcloud CLI, install if missing
```
command -v gcloud >/dev/null && gcloud --version | head -1 || echo NO_GCLOUD
```
If `NO_GCLOUD`, first tell the user in one line: "The Google Cloud CLI (gcloud) isn't installed on my computer, so I'm installing it now. It takes about a minute." Then:
```
cd /workspace/agent-tools && curl -sSL https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-x86_64.tar.gz -o gcloud.tgz && tar -xzf gcloud.tgz && rm gcloud.tgz && ./google-cloud-sdk/install.sh -q --path-update=false --usage-reporting=false >/dev/null 2>&1
sudo ln -sf /workspace/agent-tools/google-cloud-sdk/bin/gcloud /usr/local/bin/gcloud
gcloud --version | head -1
```
Then `gcloud auth list --format='value(account,status)'`. If an account is active, skip to Step 4.

## Step 3: Sign in (user's own browser)
```
mkdir -p /workspace/_gauth && cd /workspace/_gauth && rm -f in out && mkfifo in
nohup bash -c 'sleep 3600 > in & gcloud auth login --no-launch-browser --brief < in > out 2>&1' >/dev/null 2>&1 &
sleep 4; cat out
```
Send the `https://accounts.google.com/o/oauth2/auth?...` link from `out` as a Markdown link: open it in your own browser, pick your Google account, allow access, copy the verification code. Then send a masked secret prompt (SendToUser type `secret-request`) named `GCLOUD_AUTH_CODE`, label "Google Cloud verification code". This ends the turn. When submitted:
```
cd /workspace/_gauth && printf '%s\n' "$GCLOUD_AUTH_CODE" > in; sleep 6; gcloud auth list --format='value(account,status)'
```
If login fails, restart Step 3 once with a fresh link.

## Step 4: Let the user pick a project
`gcloud projects list --sort-by=projectId --format='value(projectId,name)'`
Send a numbered list, one per line as `N. <Name>, <projectId>`, best matches for the tool first, last line `N. None of these`; ask them to reply with the number or a project ID. Never pick for them. If "None of these": send [New Google Cloud project](https://console.cloud.google.com/projectcreate) (the project ID must be unique across Google Cloud; tap Edit and add initials or a number if taken; no billing needed) and, if they hit the project limit, [Manage resources](https://console.cloud.google.com/cloud-resource-manager) to delete an unused project; when they say it's created, list again.

## Step 5: Find or create the service account, make a key, save it
Reuse the service account if it already exists. A private key can only be downloaded when it's created, so this always makes a new key (a service account can hold 10; if it's at 10, delete the oldest unused one first with `gcloud iam service-accounts keys list/delete`, after telling the user).
```
P=<projectId>; SA_NAME=<sa-name>; TOOL=<folder>
SA=$SA_NAME@$P.iam.gserviceaccount.com
gcloud services enable sheets.googleapis.com iam.googleapis.com --project=$P
gcloud iam service-accounts describe $SA --project=$P >/dev/null 2>&1 && echo "reusing $SA" || gcloud iam service-accounts create $SA_NAME --project=$P --display-name="$SA_NAME (Sheets)"
umask 077; gcloud iam service-accounts keys create /tmp/b14-sa.json --iam-account=$SA --project=$P 2>&1 | tail -1
node -e '
const fs=require("fs"),[,f,envp]=process.argv,j=JSON.parse(fs.readFileSync(f,"utf8"));
let lines=fs.existsSync(envp)?fs.readFileSync(envp,"utf8").split(/\r?\n/).filter(l=>l&&!/^(GOOGLE_SERVICE_ACCOUNT_EMAIL|GOOGLE_PRIVATE_KEY)=/.test(l)):[];
lines.push("GOOGLE_SERVICE_ACCOUNT_EMAIL="+j.client_email, "GOOGLE_PRIVATE_KEY=\""+j.private_key.replace(/\n/g,"\\n")+"\"");
fs.writeFileSync(envp+".tmp",lines.join("\n")+"\n",{mode:0o600});fs.renameSync(envp+".tmp",envp);fs.chmodSync(envp,0o600);console.log("saved",j.client_email)' /tmp/b14-sa.json "$TOOL/.env"
rm -f /tmp/b14-sa.json
```
If key creation fails with a policy error (`iam.disableServiceAccountKeyCreation`), report it word for word; the user's organization blocks keys and an admin must allow it.

## Step 6: Get the sheet ID (skip if `SHEET_BY_CALLER`)
If `GOOGLE_SHEETS_SPREADSHEET_ID` is missing, ask the user to paste the sheet's link (a sheet link is not a secret; plain chat is fine) or say they want a new one. The ID is the part between `/d/` and the next `/`. Save it, replacing only that line:
```
TOOL=<folder>; ID=<sheetId>
grep -v '^GOOGLE_SHEETS_SPREADSHEET_ID=' "$TOOL/.env" > "$TOOL/.env.tmp" || true
printf 'GOOGLE_SHEETS_SPREADSHEET_ID=%s\n' "$ID" >> "$TOOL/.env.tmp"; mv "$TOOL/.env.tmp" "$TOOL/.env"; chmod 600 "$TOOL/.env"
```
If they want a new sheet, tell them to create it at [Google Sheets](https://sheets.new) and send the link.

## Step 7: Have the user share the sheet (skip if `SHEET_BY_CALLER`)
Run Step 1. If it reports 403/404, send one short message: open the sheet (link `https://docs.google.com/spreadsheets/d/<ID>/edit`), tap Share, paste the service-account email (shown as a code span), set it to Editor, untick "Notify people", and tap Share/Send; then tell me when it's done. Only the user can do this, because the service account can't share a sheet with itself.

## Step 8: Verify
Re-run Step 1. With `SHEET_BY_CALLER`, report "Service account OK" with its email once auth is ok. Otherwise report "Google Sheets access saved and working" with the service-account email, sheet title, and tabs, or the error word for word. A brand-new key can take up to a minute to work; if `auth failed` right after creating it, wait 30 seconds and retry once. Don't loop more than once. The calling tool may also need specific tab names or headers; that belongs to the tool's own setup, not this skill.
