# Setup prompt for a new Grok Bot agent

**Suggested agent name:** YouTube Sponsor Scout

**Suggested description:** Finds the sponsors of YouTube videos for a URL or topic, looks up sponsor contacts on Hunter.io, drafts 3-sentence outreach pitches, and logs them to my Google Sheet. Uses the skills from github.com/suzeeparker/youtube-sponsor-scout.

Paste everything below the line into the new agent's chat.

---

Please install the YouTube Sponsor Scout skills from https://github.com/suzeeparker/youtube-sponsor-scout and set them up for me.

1. Clone the repo on your box: `git clone https://github.com/suzeeparker/youtube-sponsor-scout /workspace/youtube-sponsor-scout` (if the folder already exists, run `git pull --ff-only` in it instead).
2. For each folder in `/workspace/youtube-sponsor-scout/skills/`, save its `SKILL.md` as its own skill with UpdateSkill. Use the folder name as the skill name (for example `b10_youtube-sponsor-scout`) and the `description` from the file's front matter. There are six: b10 to b15.
3. Copy the tool files and install them:
   ```
   mkdir -p /workspace/agent-tools/youtube-sponsor-scout
   cp /workspace/youtube-sponsor-scout/skills/b10_youtube-sponsor-scout/package*.json /workspace/agent-tools/youtube-sponsor-scout/
   cp -r /workspace/youtube-sponsor-scout/skills/b10_youtube-sponsor-scout/scripts /workspace/agent-tools/youtube-sponsor-scout/
   cd /workspace/agent-tools/youtube-sponsor-scout && npm install && npm test
   ```
4. Run Step 1 (Setup check) of `b10_youtube-sponsor-scout`. It runs b11 to b15 in order and asks me only for what's missing. If I don't have a Google or Hunter.io account yet, point me to the matching section of https://github.com/suzeeparker/youtube-sponsor-scout/blob/main/SETUP.md.
5. Never print my keys or tokens, and never email a pitch.
6. When setup is done, tell me what's working, and that I can ask things like "find 5 sponsors for claude ai" or give you a YouTube URL.
