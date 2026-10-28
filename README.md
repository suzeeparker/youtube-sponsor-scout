# YouTube Sponsor Scout

A set of Grok Bot skills that finds who sponsors YouTube videos, looks up a decision-maker contact at each sponsor on Hunter.io, drafts a short 3-sentence outreach pitch, and logs everything to a Google Sheet.

Give your agent a YouTube URL, or a topic and a number ("find 5 sponsors for *claude ai*"). It searches YouTube, checks each video's description and chapters for a real paid sponsorship, keeps only verified sponsors, enriches them, writes the pitches, and appends one row per sponsor to your **Sponsors** sheet.

Ground rules built into the skills:
- New rows are always appended below existing rows; existing rows are never cleared or overwritten.
- API keys and tokens are never printed.
- Pitches are never emailed. You review and send them yourself.

## The skills

| Skill | What it does |
|---|---|
| `b10_youtube-sponsor-scout` | The main skill: search, verify sponsors, enrich, write pitches, and log to the sheet. Includes the Node.js CLI in `scripts/`. |
| `b11_youtube-key` | Makes sure a working YouTube Data API v3 key is saved, creating one with the gcloud CLI if needed. |
| `b12_hunter-key` | Makes sure a working Hunter.io API key is saved, asking you to paste it into a masked field. |
| `b13_gmail-workspace-account` | One-time Google sign-in (OAuth) so the tool can create the sheet in your own Drive. |
| `b14_sheets-service-account` | Creates a Google service account the CLI uses to write rows to the sheet. |
| `b15_sponsor-sheet` | Creates or checks the Sponsors sheet with the right tab and column headers. |

## Install in Grok Bot

1. In Grok Bot, create a new agent. A suggested name and description are at the top of [SETUP-PROMPT.md](SETUP-PROMPT.md).
2. Paste the prompt from [SETUP-PROMPT.md](SETUP-PROMPT.md) into the new agent's chat.
3. The agent clones this repo, saves each skill, installs the tool, and runs the setup checks. It walks you through anything that's missing.
4. If you don't have the accounts yet, follow [SETUP.md](SETUP.md) first, or as the agent asks.

To update later, ask the agent to run Step 0 of `b10_youtube-sponsor-scout` (git pull and recopy the tool files).

## Requirements

- Node.js 18 or newer (the Grok Bot box already has it).
- A free Google account with a Google Cloud project (no billing account needed).
- A free Hunter.io account.
- The Google Cloud CLI (`gcloud`); the setup skills install it if it's missing.

Free tiers have limits: YouTube's daily API quota and Hunter's monthly free credits. See [SETUP.md](SETUP.md).

## Repo layout

```
skills/
  b10_youtube-sponsor-scout/   SKILL.md, package.json, scripts/ (cli.mjs, server.mjs, tests, send-pitch-template.html)
  b11_youtube-key/             SKILL.md
  b12_hunter-key/              SKILL.md
  b13_gmail-workspace-account/ SKILL.md, scripts/gws.mjs
  b14_sheets-service-account/  SKILL.md
  b15_sponsor-sheet/           SKILL.md, scripts/sheet.mjs
```

Your keys live only in `/workspace/agent-tools/youtube-sponsor-scout/.env` on your agent's box, which is never committed.

## License

MIT. See [LICENSE](LICENSE).
