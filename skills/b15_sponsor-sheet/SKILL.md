---
name: b15_sponsor-sheet
description: >-
  Use when the YouTube Sponsor Scout (b10) tool needs a Google Sheet to log
  sponsors, or the user asks to create or check the Sponsors sheet: makes sure
  GOOGLE_SHEETS_SPREADSHEET_ID in the tool's .env points to a sheet with a
  Sponsors tab and the scout's column headers, creating one in the user's Drive
  and sharing it with the service account if needed.
---
# b15_sponsor-sheet

Creates or checks the Google Sheet that the YouTube Sponsor Scout (b10) logs sponsors to, and saves its ID as `GOOGLE_SHEETS_SPREADSHEET_ID` in the tool's `.env`. It acts as the user through the Google sign-in from b13, so the sheet is created in the user's own Drive. Never print secrets from `.env`. Never replace an existing `GOOGLE_SHEETS_SPREADSHEET_ID`, and never clear or overwrite rows in an existing sheet. Ask questions in plain text with numbered choices, not question cards.

If the user has no Google account yet, point them to [SETUP.md: Sponsors sheet](https://github.com/suzeeparker/youtube-sponsor-scout/blob/main/SETUP.md#6-sponsors-sheet).

The helper script `sheet.mjs` is in this skill's `scripts/` folder in the cloned repo (`/workspace/youtube-sponsor-scout/skills/b15_sponsor-sheet/scripts/sheet.mjs`). Copy it to `/tmp/b15-sheet.mjs` at the start of every run. It prints status JSON only:
- `check <TOOL>`: opens the sheet in `.env` and reports its title, tabs, link, and whether row 1 of `Sponsors` matches the scout's headers
- `create <TOOL> [title]`: creates a new sheet (default title "YouTube Sponsor Scout") with a `Sponsors` tab, a bold, frozen header row, and the scout's 11 columns. It saves the ID to `.env` and, if `GOOGLE_SERVICE_ACCOUNT_EMAIL` is in `.env`, shares the sheet with that service account as Editor with no email notification. It refuses if an ID is already set.

The columns come from the scout's `logSponsorToSheet` (`scripts/server.mjs`): Video URL, Video Timestamp, Brand Domain, Sponsor Name, Decision Maker Name, Job Title, Contact Email, Extracted Quote, Outreach Pitch, Logged At, Status. If the scout's columns change, update `HEADERS` in `sheet.mjs` to match.

## Input
- `TOOL`: the scout's folder. Its `.env` is `TOOL/.env`.

## Step 1: Google sign-in
The script needs `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` and `GOOGLE_OAUTH_REFRESH_TOKEN` in `TOOL/.env`. If it reports `NO_GOOGLE_SIGNIN` or `GOOGLE_SIGNIN_INVALID`, run the b13_gmail-workspace-account skill for the same `TOOL` first. If the user already signed in for another tool, those three lines can be copied from that tool's `.env` without printing them.

## Step 2: Check
`node /tmp/b15-sheet.mjs check "$TOOL"`
- `ok: true` with `headers` of "match" or "empty": report the sheet title and link, and stop.
- `headers` "differ": report the existing row 1 to the user and stop. Don't change it.
- `NO_SPONSORS_TAB`: tell the user the sheet has no Sponsors tab and list its tabs. Ask whether to add one or create a new sheet. Don't add it without a yes.
- `SHEET_UNREADABLE`: report the error word for word. Offer to create a new sheet, which needs the old ID removed from `.env` first, so ask before removing it.
- `NO_SHEET_ID`: go to Step 3.

## Step 3: Create
Run `node /tmp/b15-sheet.mjs create "$TOOL"` (pass a title if the user gave one). Report the title, the link, and the `shared` result. If it wasn't shared because `.env` has no service account email, say so. The scout's service-account writes will fail until b14 has run, or until the user shares the sheet with the service account as Editor.

## Step 4: Verify
Re-run Step 2. If b14's check script is available, also run it, to confirm the service account can open the sheet.
