---
name: b10_youtube-sponsor-scout
description: >-
  Use when the user gives a YouTube URL or a topic and wants to find the videos'
  sponsors, look up sponsor decision-maker contacts on Hunter.io, draft
  3-sentence sponsor pitches, or log sponsors to their Google Sheet.
---
# b10_youtube-sponsor-scout

Finds the sponsors in YouTube videos, either for a single URL or for the top N videos on a topic. It then looks up a decision-maker contact on Hunter.io, drafts a 3-sentence outreach pitch, and appends every run's rows to the user's Google Sheet. Every API call goes through one CLI that prints JSON. Grok Bot reviews that JSON, checks the sponsor, and writes the pitch. Don't call the APIs any other way.

## Step 0: Update (every run)
Always do this first, on every run, before anything else: pull the cloned repo and recopy the tool files (never overwrite `.env` or `channel.json`):
```
cd /workspace/youtube-sponsor-scout && git pull --ff-only
mkdir -p /workspace/agent-tools/youtube-sponsor-scout
cp skills/b10_youtube-sponsor-scout/package.json /workspace/agent-tools/youtube-sponsor-scout/
cp -r skills/b10_youtube-sponsor-scout/scripts /workspace/agent-tools/youtube-sponsor-scout/
```
If any `skills/*/SKILL.md` changed, save it again as its skill (same name as its folder) and re-read this file. If the pull fails, report the error word for word and continue with the current copy.

## Step 1: Setup check (every run)
```
cd /workspace/agent-tools/youtube-sponsor-scout
test -f .env || echo "MISSING .env"
test -d node_modules || npm install
```
- If `package.json` changed in Step 0, run `npm install` as well.
- Then make sure every key is in `.env` by running these setup skills in this order, each with `TOOL=/workspace/agent-tools/youtube-sponsor-scout`. Each one checks `.env` first and only asks the user for something when an entry is missing or broken. When everything is already set, this is five quick checks with no questions. A missing `.env` is fine, since the first skill that saves a value creates it (chmod 600).
  1. `b11_youtube-key`: `YOUTUBE_API_KEY` (the CLI falls back to `GEMINI_API_KEY` or `GOOGLE_API_KEY` when it's missing)
  2. `b12_hunter-key`: `HUNTER_API_KEY`
  3. `b13_gmail-workspace-account`: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN` (the user's own Google sign-in, used by b15 to create the sheet in their Drive)
  4. `b14_sheets-service-account` with `SA_NAME=sponsor-scout` and `SHEET_BY_CALLER` set: `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` (what the CLI uses to write rows)
  5. `b15_sponsor-sheet`: `GOOGLE_SHEETS_SPREADSHEET_ID` (creates the sheet with the Sponsors tab and headers, shared with the service account, or checks the existing one)

  If a setup skill can't finish, report what it said and stop the run. Items 3 to 5 only matter for logging to the sheet; if the user wants results without the sheet this time, skip them and Step 8.
- Never print, quote, or copy any `.env` value. The CLI loads `.env` from its own folder, so the cwd doesn't matter.

Below, `CLI` means `node /workspace/agent-tools/youtube-sponsor-scout/scripts/cli.mjs`. Every command prints JSON. On success, `search`, `detect`, and `enrich` print their result with no `ok` field, while `sheet-check` and `append` include `"ok": true`. On failure every command prints `{"ok": false, "error": ...}` and exits non-zero (exit 2 means bad arguments). If you get an error, report it word for word and stop that step. Don't retry with changed inputs.

## Step 2: Inputs (ask only for what's missing)
- Mode: a single `<url>`, or a `<topic>` with a count `N` (default 5, max 50) and an order (`relevance` by default; also `viewCount`, `date`, `rating`).
- For pitches: the user's channel name, saved in `/workspace/agent-tools/youtube-sponsor-scout/channel.json` as `{"channelName": "", "updatedAt": ""}`. Ask exactly once per run, as one plain chat line (no card, widget or form): `Channel name: <saved name>. Reply with a new name, or "ok" to keep it.` If none is saved, use `Channel name: (none yet). Reply with your channel name, or "ok" to leave it blank.` A reply of "ok" keeps the saved value; any other reply is the new name. Save it to `channel.json` (create it if missing) with `updatedAt` set to now in the user's time zone, and use it in sentence 2. `channel.json` is the user's own data: never copy it into the repo or commit it. Don't ask for niche or audience numbers: write sentence 2 about the channel and its audience in general terms, with no bracketed placeholders and no numbers; never make numbers up. If the name is blank, say "my channel".

## Step 3: Find N verified sponsors (topic mode)
Goal: end with exactly `N` verified sponsors, checking at most two batches of 50 videos. Never call Hunter or write to the Sheet in this step. Each search costs 100 YouTube quota units no matter how many videos it returns (the daily quota is 10,000), so never search one video at a time.

1. Batch 1: `CLI search "<topic>" --count 50 --order <order>`. Save the JSON and note its `nextPageToken`. Go down the list in order, one video at a time: `CLI detect "<url>"`, then verify (Step 4). Keep a set of seen `videoId`s. Stop as soon as you have `N` verified sponsors.
2. Batch 2, only if batch 1 ran out first and `nextPageToken` isn't null: `CLI search "<topic>" --count 50 --order <order> --page-token <nextPageToken>`. Skip any video already in `seen` (the pages can overlap a little), and continue one video at a time the same way, stopping as soon as you have `N`.
3. If both batches are used up, stop. Don't search a third time. Report how many verified sponsors you found out of `N` and how many videos you checked.
4. Don't enrich or pitch videos you rejected.

URL mode: skip the loop. Run `CLI detect "<url>"` once, verify, and if there is no verified sponsor, say so and stop.

Do **not** use `pipeline-topic` or `pipeline-url` for the main path; they can write to the Sheet or spend Hunter credits unless both `--no-sheet` and `--no-enrich` are set. Prefer `search` + `detect` so the batch loop is explicit. If you do call a pipeline, always pass both `--no-sheet` and `--no-enrich`.

## Step 4: Verify each sponsor (Grok Bot does this)
The CLI's sponsor detection is a heuristic and often gets it wrong. Check every `detect` result with `"hasSponsor": true` yourself against the returned `description`, `chapters`, `extractedQuote`, and `transcriptExcerpt`. Captions often come back empty, so the description is the main evidence.
- Keep a result only when there's an explicit paid integration, such as "sponsored by", "#sponsored", "thanks to X for sponsoring", or a sponsor chapter, together with that brand's link.
- Reject:
  - the creator's own products, courses, newsletters, or company links (for example, IBM Technology linking to ibm.biz);
  - plain affiliate or gear lists;
  - social links;
  - YouTube's programmatic pre-roll ads;
  - marketplace or platform domains that aren't the sponsor's own site (for example `wordpress.org` for a WordPress plugin, `chrome.google.com` for an extension). Use the sponsor's own domain if the description gives one; otherwise reject it with that reason.
- Fix the sponsor name (for example `Gohighlevel` becomes `GoHighLevel`) and the root domain: strip the protocol, `www.`, the path, and the query. If there's a sponsor chapter, use its time range; otherwise put `unknown`. Don't keep the CLI's default `00:00 - 01:30`.
- Record a one-line reason for every keep or reject.

## Step 5: Enrich (automatic, no approval)
For each verified sponsor domain, call `CLI enrich <domain>` once per domain per run. Never ask before enriching, whatever the number of domains. If Hunter says the plan or rate limit is reached (an HTTP 429 or a usage-limit error), stop enriching, mark the remaining sponsors "no contact found (Hunter limit reached)", finish the run, and tell the user in the chat summary.
- The CLI already ranks contacts, putting titles that mention partnerships, influencer, creator, brand, growth, or CMO first. Use `primaryDecisionMaker` (its `fullName`, `position`, `email`, `confidence`), which is the top-ranked contact. List up to four runners-up from `alternativeContacts` only in the chat reply, not in the Sheet.
- If `primaryDecisionMaker` is `null`, leave the contact fields empty and say "no contact found" in the chat reply.
- Never guess an email address from `emailPattern`.

## Step 6: Write the pitch (Grok Bot writes it; exactly 3 sentences)
Write one pitch per verified sponsor (so for a request of 5, write five pitches).
1. Acknowledge the recent integration, pointing to its specific quote or angle, and compliment how the brand positions itself.
2. Tie the product's value to the demographics and engagement of the user's channel.
3. End with an easy call to action: a 5-minute chat, or an offer to send the media kit.

Rules:
- No sales clichés and no filler adjectives.
- Use the contact's first name, or "Hi there" if there's none.
- Only use facts from the JSON or from the user.
- Write a subject line that names the sponsor, such as "A sponsorship idea for HeyGen". Never put the user's channel or any placeholder in it.
- Pitches are never emailed. Offer them as draft cards only if the user asks.

## Step 7: Present and save
1. Build `rows.json`, an array with one object per verified sponsor:
   - keys: `videoTitle`, `channelTitle`, `viewCount`, `videoUrl`, `sponsorName`, `brandDomain`, `timestamp`, `extractedQuote`, `contactName`, `contactEmail`, `contactTitle`, `pitch`;
   - optional key: `status` (defaults to `Scouted - Ready to Pitch`);
   - for missing values, use `""`.
2. Don't post the summary table or the pitches in the chat. They go on the Youtube Sponsor Scout page (Step 9). In the chat, keep it to a few short lines: how many sponsors were found out of N, how many videos were checked, the contact per sponsor (or "no contact found"), and up to four `alternativeContacts` runners-up.
3. Save working files only (no `sponsors.md`, no `sponsors.csv`):
   - Topic: `DIR=/workspace/youtube-sponsors/<topic_slug>_<yymmdd>/`
   - URL: `DIR=/workspace/youtube-sponsors/url_<videoId>_<yymmdd>/`
   - `topic_slug` is the topic in lowercase with each run of non-alphanumerics turned into a single `-`; `yymmdd` is today's date in America/New_York.
   - Write `rows.json` there. Do **not** run `CLI export`.

## Step 8: Google Sheet (every run, automatic)
Every run's rows go in the Sheet automatically; don't ask first. Rows are added after the rows already there; never clear, overwrite, or reorder existing rows.
1. Run `CLI sheet-check` (read-only). It must return `"auth": "ok"` and a `url`; if not, report the error and stop this step.
2. Append all rows in `rows.json` (every verified sponsor, with or without a contact): `CLI append --json $DIR/rows.json`.
3. Append once per run. Never append the same `rows.json` twice; after a successful append, write `$DIR/appended.txt` with the time and `updatedRange`, and skip the append if that file already exists.
4. Report `appended`, each `updatedRange`, and the Sheet link from `sheet-check` as a Markdown link labeled **Sponsors sheet** (use the `url` field). Never invent the link.
5. If the append fails, report the error word for word and stop; don't retry on your own.

## Step 9: Youtube Sponsor Scout page (every run, automatic)
The user wants a Page at the end of every run; don't ask first, and don't wait to be asked. Load the Cursor-managed `canvas` skill with Skill first, then:
1. Read `/workspace/agent-tools/youtube-sponsor-scout/scripts/results-page.canvas.tsx`. Copy it as is and replace **only** the block between `// ==== DATA (replace per run) ====` and `// ==== END DATA ====`. Never change the layout below it; if it needs a change, change the template file and test it.
   - `TITLE`: `Youtube Sponsor Scout: <topic>`, or `Youtube Sponsor Scout: <video title>` in URL mode.
   - `SUMMARY`: one sentence: how many verified sponsors, for which topic or video, and the date (America/New_York).
   - `SHEET_URL`: the `url` from `CLI sheet-check`, and `LOGGED_AT`: the append time with an EDT/EST label. Both `""` if Step 8 was skipped or failed.
   - `WHAT_HAPPENED`: 3 to 7 plain one-line bullets: the search and how many videos were checked, how many kept, the main reasons others were rejected, the Hunter results per sponsor, and the sheet rows appended (from `updatedRange`) or why the sheet was skipped. Only facts from this run.
   - `SPONSORS`: one object per row in `rows.json`, in the same order, plus `confidence` (Hunter's `confidence` as a string, `""` if no contact) and `sheetRow` (its row number from `updatedRange`, `""` if not logged). `viewCount` is a number. `pitch` is the full pitch starting `Subject: ...`, then a blank line, then the 3 sentences.
2. Call `WriteCanvas` with the full source and `title` set to the same `TITLE`. A new run makes a new Page; only overwrite an existing one (by `canvas_id`) when the user asks to redo that run's Page. If the write reports type errors, fix only the DATA block with `EditCanvas` on the draft id.
3. End the run with a message starting `Done:`, the short chat summary from Step 7, the **Sponsors sheet** link, and the Page as a Markdown link labeled with its title, using exactly the `url` that `WriteCanvas` returned.

The Page's Send button only opens the reader's own mail app with the pitch filled in (a `mailto:` link, the same as `scripts/send-pitch-template.html`); this skill never sends the pitch itself.

## Other commands
- `CLI search "<topic>" [--count N] [--order O] [--page-token T]`: lists videos only, with sponsor hints, and returns `nextPageToken` for the next batch.
- `CLI detect "<url>"`: full metadata for one video.
- `CLI enrich <domain>`, `CLI sheet-check`, `CLI append --json <file>`.
- `CLI export` exists but this skill must not use it.
