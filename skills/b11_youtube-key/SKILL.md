---
name: b11_youtube-key
description: >-
  Use before any YouTube Data API call, or when the user asks to set up or check
  their YouTube API key: makes sure YOUTUBE_API_KEY is in the calling tool's
  .env and works, installing the gcloud CLI if needed, letting the user pick a
  Google Cloud project, and reusing an existing key or creating one after the
  user signs in to Google from their own browser.
---
# b11_youtube-key

Ensures a working YouTube Data API v3 key is saved in a tool's `.env`. Never print, quote, or log the key. Never ask for the user's Google password, never sign in to Google in the bot's own browser, and never accept a key or code pasted in chat. The user never has to visit the Cloud Credentials page: the bot gets the key with the `gcloud` CLI. YouTube Data API v3 needs no billing account (free daily quota).

If the user has no Google account or Cloud project yet, point them to [SETUP.md: Google account and Cloud project](https://github.com/suzeeparker/youtube-sponsor-scout/blob/main/SETUP.md#1-google-account-and-cloud-project).

## Input
- `TOOL`: the folder of the skill/tool that needs the key (e.g. `/workspace/agent-tools/youtube-sponsor-scout`). Its `.env` is `TOOL/.env`.

## Step 1: Check
Prints only a status, never the key. Uses `videos.list` on one public video (1 quota unit).
```
TOOL=<folder>
get() { grep -E "^$1=" "$TOOL/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'"' \r'; }
KEY=$(get YOUTUBE_API_KEY); SRC=YOUTUBE_API_KEY
[ -z "$KEY" ] && { KEY=$(get GEMINI_API_KEY); SRC=GEMINI_API_KEY; }
[ -z "$KEY" ] && { KEY=$(get GOOGLE_API_KEY); SRC=GOOGLE_API_KEY; }
[ -z "$KEY" ] && { KEY="$YOUTUBE_API_KEY"; SRC=env; }
if [ -z "$KEY" ]; then echo "NO_KEY"; else
  curl -s "https://www.googleapis.com/youtube/v3/videos?part=id&id=dQw4w9WgXcQ&key=$KEY" | jq -c --arg src "$SRC" '{ok:((.items|length)>0), source:$src, error:.error.message, reason:.error.errors[0].reason}'
fi
unset KEY
```
- `ok: true`: say "YouTube key OK" (and which variable it came from), and stop. Tools may also accept the key as `GEMINI_API_KEY` or `GOOGLE_API_KEY`.
- `NO_KEY` or `ok: false`: go to Step 2.

## Step 2: Check for the gcloud CLI, install if missing
First check:
```
command -v gcloud >/dev/null && gcloud --version | head -1 || echo NO_GCLOUD
```
- If it prints a version, gcloud is installed; go on to the sign-in check below.
- If it prints `NO_GCLOUD`, first tell the user in one line: "The Google Cloud CLI (gcloud) isn't installed on my computer, so I'm installing it now. It takes about a minute." Then install it:
```
cd /workspace/agent-tools && curl -sSL https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-x86_64.tar.gz -o gcloud.tgz && tar -xzf gcloud.tgz && rm gcloud.tgz && ./google-cloud-sdk/install.sh -q --path-update=false --usage-reporting=false >/dev/null 2>&1
sudo ln -sf /workspace/agent-tools/google-cloud-sdk/bin/gcloud /usr/local/bin/gcloud
gcloud --version | head -1
```
  If the version prints, say it's installed. If not, report the error word for word and stop.

Then check sign-in:
```
gcloud auth list --format='value(account,status)'
```
If an account is already active, skip to Step 4.

## Step 3: Sign in (user's own browser)
Start the login in the background, feeding stdin from a FIFO so the code can be sent later:
```
mkdir -p /workspace/_gauth && cd /workspace/_gauth && rm -f in out && mkfifo in
nohup bash -c 'sleep 3600 > in & gcloud auth login --no-launch-browser --brief < in > out 2>&1' >/dev/null 2>&1 &
sleep 4; cat out
```
Send the user the `https://accounts.google.com/o/oauth2/auth?...` link from `out` as a Markdown link, telling them to open it in their own phone/computer browser, pick their Google account, allow access, and copy the verification code. Then send a masked secret prompt (SendToUser type `secret-request`) named `GCLOUD_AUTH_CODE`, label "Google Cloud verification code". This ends the turn. When it's submitted:
```
cd /workspace/_gauth && printf '%s\n' "$GCLOUD_AUTH_CODE" > in; sleep 6; gcloud auth list --format='value(account,status)'
```
The code expires within minutes; if login fails, restart Step 3 once with a fresh link.

## Step 4: Let the user pick a project
List the user's projects:
```
gcloud projects list --sort-by=projectId --format='value(projectId,name)'
```
Always let the user choose; don't pick for them. Ask in a plain text message, not a question card (cards may not display on the user's phone):
- Send a numbered list, one project per line as `N. <Name>, <projectId>`, with the projects whose names best match the tool first, and a final line `N. None of these`. Ask them to reply with the number or a project ID. If there are many projects, list all of them.
- If the user picks a project, use it.
- If the user picks "None of these" (or has no projects), send one short message:
  1. Open [New Google Cloud project](https://console.cloud.google.com/projectcreate) and give it a name. The project ID under the name must be unique across all of Google Cloud; if it says the ID is taken, tap Edit and add something unique, like your initials or a number (e.g. `youtube-sponsor-scout-jd1`). No billing account is needed.
  2. If Google says you've hit your project limit, open [Manage resources](https://console.cloud.google.com/cloud-resource-manager), check the box next to a project you no longer need, tap Delete, and type its ID to confirm. Then create the new one.
  3. Tell me when it's created.
  Then re-run the list above and ask again.

Once a project is chosen:
```
P=<projectId>
gcloud services enable youtube.googleapis.com apikeys.googleapis.com --project=$P
```
If enabling fails with a permission error, tell the user they need Owner or Editor on that project and offer the list again.

## Step 5: Reuse an existing key, or create one, and save it
First try every existing key in the project that is unrestricted or allows YouTube; keep the first that passes a live check. Create a new key only if none works. Never print the key.
```
P=<projectId>; TOOL=<folder>
YOUTUBE_API_KEY=""
for N in $(gcloud services api-keys list --project=$P --format=json | jq -r '.[] | select((.restrictions.apiTargets // []) | length == 0 or any(.service=="youtube.googleapis.com")) | .name'); do
  K=$(gcloud services api-keys get-key-string "$N" --format='value(keyString)' 2>/dev/null)
  [ -n "$K" ] && [ "$(curl -s "https://www.googleapis.com/youtube/v3/videos?part=id&id=dQw4w9WgXcQ&key=$K" | jq '(.items|length)>0')" = true ] && { YOUTUBE_API_KEY=$K; echo "reusing ${N##*/}"; break; }
done; unset K
if [ -z "$YOUTUBE_API_KEY" ]; then
  gcloud services api-keys create --project=$P --display-name="<Tool name> YouTube key" --api-target=service=youtube.googleapis.com --format=json > /tmp/k.json 2>/tmp/k.err
  YOUTUBE_API_KEY=$(jq -r '.response.keyString // .keyString // empty' /tmp/k.json); rm -f /tmp/k.json
  [ -n "$YOUTUBE_API_KEY" ] && echo created || { sed -E 's/AIza[0-9A-Za-z_-]+/[KEY]/g' /tmp/k.err; exit 1; }
fi
touch "$TOOL/.env" && chmod 600 "$TOOL/.env"
grep -v '^YOUTUBE_API_KEY=' "$TOOL/.env" > "$TOOL/.env.tmp" || true
printf 'YOUTUBE_API_KEY=%s\n' "$YOUTUBE_API_KEY" >> "$TOOL/.env.tmp"
mv "$TOOL/.env.tmp" "$TOOL/.env" && chmod 600 "$TOOL/.env"; unset YOUTUBE_API_KEY; echo saved
```
New keys are restricted to YouTube Data API v3 only.

## Step 6: Verify
If a key was just created, wait about 20 seconds first. Re-run Step 1. Report "YouTube key saved and working", whether it was reused or created, and the project, or the error word for word. Retry at most once.
