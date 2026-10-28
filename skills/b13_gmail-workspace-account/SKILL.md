---
name: b13_gmail-workspace-account
description: >-
  Use when a tool needs access to the user's own Google account (Gmail,
  Calendar, Drive, Sheets, Docs, Slides), or the user asks to set up or check
  that access: makes sure an OAuth client and refresh token are in the tool's
  .env and work, walking the user through creating the OAuth client and signing
  in from their own browser.
---
# b13_gmail-workspace-account

Gives a tool access to the user's own Google account (Gmail, Calendar, Drive, Sheets, Docs, Slides) through a one-time sign-in. Unlike a service account, this acts as the user and can read and send their mail, so it is powerful: only set it up when the user asks. Never print, quote, or log the client secret, the refresh token, or access tokens. Never ask for the user's Google password, and never sign in to Google in the bot's own browser. Ask questions in plain text with numbered choices, not question cards.

If the user has no Google account or Cloud project yet, or wants written steps for the OAuth client, point them to [SETUP.md: Google sign-in (OAuth) client](https://github.com/suzeeparker/youtube-sponsor-scout/blob/main/SETUP.md#3-google-sign-in-oauth-client).

The helper script `gws.mjs` is in this skill's `scripts/` folder in the cloned repo (`/workspace/youtube-sponsor-scout/skills/b13_gmail-workspace-account/scripts/gws.mjs`). Copy it to `/tmp/b13-gws.mjs` at the start of every run, because /tmp can be cleared between turns. It prints status JSON only:
- `check <TOOL>`: refreshes the token and probes each service
- `url <TOOL>`: prints the sign-in link
- `exchange <TOOL>`: reads `$GOOGLE_OAUTH_REDIRECT_URL`, saves `GOOGLE_OAUTH_REFRESH_TOKEN`
- `save-client <TOOL>`: saves `$GOOGLE_OAUTH_CLIENT_ID` and/or `$GOOGLE_OAUTH_CLIENT_SECRET`

It writes only its own lines in `TOOL/.env` and keeps the file at mode 600. When `exchange` prints its result, strip the `scopes` field.

## Input
- `TOOL`: the folder of the tool that needs access. Its `.env` is `TOOL/.env`.

## Step 1: Check
`node /tmp/b13-gws.mjs check "$TOOL"`
- `ok: true`: report each service as OK with the Gmail address, and stop.
- `NO_CLIENT`: go to Step 2.
- `NO_TOKEN` or `TOKEN_INVALID`: go to Step 5. A token from an app still in Testing expires after 7 days; if that's the cause, mention publishing (Step 3, item 2) once.
- Some services `ERROR 403 ... has not been used / is disabled`: run Step 2's enable line for the client's project, then re-check.

## Step 2: gcloud, project, APIs
Check for gcloud: `command -v gcloud >/dev/null && gcloud --version | head -1 || echo NO_GCLOUD`. If it's missing, tell the user in one line that you're installing the Google Cloud CLI (about a minute), then install it:
```
cd /workspace/agent-tools && curl -sSL https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-x86_64.tar.gz -o gcloud.tgz && tar -xzf gcloud.tgz && rm gcloud.tgz && ./google-cloud-sdk/install.sh -q --path-update=false --usage-reporting=false >/dev/null 2>&1
sudo ln -sf /workspace/agent-tools/google-cloud-sdk/bin/gcloud /usr/local/bin/gcloud
```
If `gcloud auth list` shows no active account, sign in the same way as b11/b14 Step 3.

List projects with `gcloud projects list --sort-by=projectId --format='value(projectId,name)'`. Send a numbered list (`N. <Name>, <projectId>`, best matches first, last line `N. None of these`) and let the user choose. For "None of these", give [New Google Cloud project](https://console.cloud.google.com/projectcreate) (the ID must be unique; no billing needed). If the user already has a branded OAuth app with a Desktop client in some project, that project and client can be reused.

Then enable the APIs:
```
P=<projectId>
gcloud services enable gmail.googleapis.com calendar-json.googleapis.com drive.googleapis.com sheets.googleapis.com docs.googleapis.com slides.googleapis.com --project=$P
```

## Step 3: User creates the OAuth client (their browser)
gcloud can't create this, so the user does it. Send one short message with these links, `<P>` filled in. Users on a phone switch back and forth between the chat and the console, so keep each item self-contained:
1. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview?project=<P>). If it says "not configured yet", tap Get started. Enter an app name and your email as the support email. Pick **External** (Internal exists only for paid Workspace business accounts), enter your email as contact, agree, and tap Create. If it later asks for Branding: keep the name and email, add **no logo** (a logo forces Google review), leave the domains empty, put your email under Developer contact, and Save.
2. Open [Audience](https://console.cloud.google.com/auth/audience?project=<P>). Under **Test users**, tap Add users, add your own Gmail address (it saves on its own, with no Save button). Optionally tap **Publish app** so the sign-in doesn't expire after 7 days; that button is sometimes grayed out, and the test user alone is enough to finish. Without one of these, sign-in fails with "Access blocked ... has not completed the Google verification process, Error 403: access_denied".
3. Open [Create client](https://console.cloud.google.com/auth/clients/create?project=<P>). Pick Application type **Desktop app**, name it, and tap Create.
4. Keep that window open. It shows a Client ID and a Client secret (starts `GOCSPX-`).

## Step 4: Collect the client ID and secret
The client ID isn't secret: let the user paste it in chat and run `GOOGLE_OAUTH_CLIENT_ID='<id>' node /tmp/b13-gws.mjs save-client "$TOOL"`. For the secret, send a secret prompt (SendToUser type `secret-request`, never with content) named `GOOGLE_OAUTH_CLIENT_SECRET`, label "Google OAuth client secret", then run save-client. Secret prompts may not display on the user's phone. If the user says they can't see it, explain once that Google doesn't treat a Desktop client's secret as truly confidential, and offer to have them paste it in chat. If they do, save it with save-client and never repeat it.

## Step 5: Sign in (user's own browser)
Run `node /tmp/b13-gws.mjs url "$TOOL"` and send the `url` as a Markdown link labeled "Sign in to Google" with these steps:
1. Open it and pick your Google account.
2. If it says "Google hasn't verified this app", tap **Advanced**, then **Go to <app name> (unsafe)**. It's your own app.
3. Tick **every** box (Gmail, Calendar, Drive, Sheets, Docs, Slides) and tap Continue.
4. Your browser then shows "This site can't be reached" for localhost. That's expected. Tap the address bar, copy the **whole address** (it starts `http://localhost/?iss=` and contains `code=`), and paste it here soon.

The address holds a one-time code that expires in minutes and is useless without the client secret, so the user may paste it in chat. Run `GOOGLE_OAUTH_REDIRECT_URL='<address>' node /tmp/b13-gws.mjs exchange "$TOOL"`. On `invalid_grant`, send a fresh link once.

## Step 6: Verify
Re-run Step 1 and report each service (Gmail with the address, Calendar, Drive, Sheets, Docs, Slides) as OK or with its error word for word. If a service shows 403 "insufficient scopes", the user missed a box in Step 5; redo Step 5 once. Remind the user they can revoke this access any time at [Google third-party access](https://myaccount.google.com/connections).
