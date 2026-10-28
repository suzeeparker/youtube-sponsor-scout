---
name: b12_hunter-key
description: >-
  Use before any Hunter.io call, or when the user asks to set up or check their
  Hunter key: makes sure HUNTER_API_KEY is in the calling tool's .env and works,
  prompting the user to paste it into a masked secret field if it's missing.
---
# b12_hunter-key

Ensures a working Hunter.io API key is saved in a tool's `.env`. Never print, quote, or log the key. Never ask for the user's Hunter password, never sign in to Hunter in the bot's own browser, and never accept the key pasted in chat.

If the user has no Hunter.io account yet, point them to [SETUP.md: Hunter.io account and API key](https://github.com/suzeeparker/youtube-sponsor-scout/blob/main/SETUP.md#5-hunterio-account-and-api-key).

## Input
- `TOOL`: the folder of the skill/tool that needs the key (e.g. `/workspace/agent-tools/youtube-sponsor-scout`). Its `.env` is `TOOL/.env`.

## Step 1: Check
Run this test (prints only status, plan and remaining searches, never the key):
```
TOOL=<folder>
KEY=$(grep -E '^HUNTER_API_KEY=' "$TOOL/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'"' \r')
[ -z "$KEY" ] && KEY="$HUNTER_API_KEY"
if [ -z "$KEY" ]; then echo "NO_KEY"; else
  curl -s "https://api.hunter.io/v2/account?api_key=$KEY" | jq -c '{ok:(.data!=null), plan:.data.plan_name, searches:.data.requests.searches, error:.errors[0].details}'
fi
unset KEY
```
- `ok: true`: say "Hunter key OK" with the plan and searches used/available, and stop.
- `NO_KEY` or `ok: false`: go to Step 2.

The account endpoint is free; it doesn't use search credits.

## Step 2: Ask the user (in their own browser)
The user gets the key in their own browser, where it usually remembers their Hunter login. Don't open Hunter on the bot's desktop or hand over the bot's screen for this. Send these steps as one short message:
1. Open [Hunter API keys](https://hunter.io/api-keys), on a computer if you can, and log in (your browser can fill in your saved login; sign up free if you don't have an account).
2. If Hunter sends you to its domain search page after logging in, open the same link again.
3. On a phone, Hunter covers the keys page with "Need a larger screen". Don't tap "Switch to mobile version"; that goes to domain search, which has no keys. Switch the browser to its desktop site (Chrome: ⋮ menu, scroll down, Desktop site; Safari: aA, Request Desktop Website), turn the phone sideways, or use a computer.
4. Copy the key with the copy icon next to it (every account has a default key; if none is listed, use the button on that page to create one), then paste it into the prompt below.

Then show a masked secret prompt (SendToUser type `secret-request`) with name `HUNTER_API_KEY` and label "Hunter.io API key". The value arrives as `process.env.HUNTER_API_KEY`, never in chat. This ends the turn; resume at Step 3 when it's submitted. If the user already says they have the key copied, skip the steps and just send the prompt.

## Step 3: Save to .env
Write or replace only the `HUNTER_API_KEY=` line, keeping every other line, without echoing the value:
```
TOOL=<folder>
[ -n "$HUNTER_API_KEY" ] || { echo "HUNTER_API_KEY not set in env"; exit 1; }
touch "$TOOL/.env" && chmod 600 "$TOOL/.env"
grep -v '^HUNTER_API_KEY=' "$TOOL/.env" > "$TOOL/.env.tmp" || true
printf 'HUNTER_API_KEY=%s\n' "$HUNTER_API_KEY" >> "$TOOL/.env.tmp"
mv "$TOOL/.env.tmp" "$TOOL/.env" && chmod 600 "$TOOL/.env"
echo saved
```

## Step 4: Verify
Re-run Step 1. Report "Hunter key saved and working" with plan and searches, or the error word for word. If it still fails, say so and ask the user to check they copied the whole key; don't loop more than once.
