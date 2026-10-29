// b10 results Page template. Step 9 of b10_youtube-sponsor-scout copies this file,
// replaces ONLY the DATA block below with the run's values, and sends it with WriteCanvas.
// Everything below the DATA block stays as is.
import { Page, Section, Table, BulletList, Select, Input, Properties, Callout, LinkCards, useState, useGrokTheme, ChangeEvent } from "grok/canvas";

type Sponsor = { videoTitle: string; channelTitle: string; viewCount: number; videoUrl: string; sponsorName: string; brandDomain: string; timestamp: string; extractedQuote: string; contactName: string; contactEmail: string; contactTitle: string; confidence: string; sheetRow: string; pitch: string };

// ==== DATA (replace per run) ====
const TITLE = "Youtube Sponsor Scout: <topic, or the video title in URL mode>";
const SUMMARY = "<N> verified sponsors found in <the top YouTube videos for TOPIC | VIDEO TITLE> on <Mon D, YYYY>, with contacts, pitches, and the rows logged to the Sponsors sheet.";
const SHEET_URL = ""; // the `url` from `CLI sheet-check`; "" when the sheet was skipped
const LOGGED_AT = ""; // e.g. "2026-10-28 2:59 PM EDT"; "" when the sheet was skipped
const STATUS = "Scouted - Ready to Pitch";
const WHAT_HAPPENED: string[] = [
  "<one plain sentence per bullet: what was searched, how many videos checked, how many kept, why others were rejected, Hunter results, sheet rows appended>"
];
const SPONSORS: Sponsor[] = [
  // one object per verified sponsor, from rows.json plus confidence ("" if none) and sheetRow ("" if not logged)
];
// ==== END DATA ====

const orNone = (v: string): string => (v ? v : "none found");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const isEmail = (v: string): boolean => EMAIL_RE.test(v.trim());
const mailto = (to: string, pitch: string): string => {
  const lines = pitch.split("\n");
  const hasSubject = lines[0].startsWith("Subject:");
  const subject = hasSubject ? lines[0].slice(8).trim() : "";
  const body = (hasSubject ? lines.slice(1) : lines).join("\n").trim();
  return "mailto:" + encodeURIComponent(to.trim()) + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
};

export default function App() {
  const theme = useGrokTheme();
  const [selected, setSelected] = useState<string>("0"); // row index as a string, so two rows with the same sponsor stay separate
  const [pitches, setPitches] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    SPONSORS.forEach((s: Sponsor, i: number) => { m[String(i)] = s.pitch; });
    return m;
  });
  const [emails, setEmails] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    SPONSORS.forEach((s: Sponsor, i: number) => { m[String(i)] = s.contactEmail; });
    return m;
  });
  const cur = SPONSORS[Number(selected)] ?? SPONSORS[0];
  const curKey = SPONSORS[Number(selected)] ? selected : "0";
  const to = cur ? emails[curKey] ?? "" : "";
  const canSend = isEmail(to);
  const link = { color: theme.text.accent, textDecoration: "underline" };
  const btn = { display: "inline-block", padding: "8px 20px", borderRadius: theme.radius.md, fontFamily: theme.font.family, fontSize: theme.font.body1.fontSize, fontWeight: theme.weight.medium, textDecoration: "none" };
  const props = cur ? [
    { label: "Video URL", value: cur.videoUrl },
    { label: "Video title", value: cur.videoTitle },
    { label: "Channel", value: cur.channelTitle },
    { label: "Views", value: cur.viewCount.toLocaleString("en-US") },
    { label: "Video timestamp", value: cur.timestamp },
    { label: "Brand domain", value: cur.brandDomain },
    { label: "Sponsor name", value: cur.sponsorName },
    { label: "Decision maker name", value: orNone(cur.contactName) },
    { label: "Job title", value: orNone(cur.contactTitle) },
    { label: "Contact email", value: orNone(cur.contactEmail) },
    { label: "Hunter confidence", value: cur.confidence ? cur.confidence + "%" : "none" },
    { label: "Extracted quote", value: cur.extractedQuote },
    ...(LOGGED_AT ? [{ label: "Logged at", value: LOGGED_AT }] : []),
    { label: "Status", value: STATUS },
    ...(cur.sheetRow ? [{ label: "Sheet row", value: cur.sheetRow }] : [])
  ] : [];

  return (
    <Page title={TITLE} summary={SUMMARY} width="wide">
      {SPONSORS.length > 0 && (
        <Section heading="Sponsors found">
          <Table
            columns={["YouTube URL", "Views", "Sponsor", "Contact Email"]}
            align={["start", "end", "start", "start"]}
            rows={SPONSORS.map((s: Sponsor, i: number) => [
              <a key="u" href={s.videoUrl} target="_blank" rel="noopener" style={link}>{s.videoUrl}</a>,
              s.viewCount.toLocaleString("en-US"),
              s.sponsorName,
              s.contactEmail ? <a key="e" href={mailto(emails[String(i)] || s.contactEmail, pitches[String(i)] ?? s.pitch)} target="_blank" rel="noopener" style={link}>{s.contactEmail}</a> : "none found"
            ])}
          />
        </Section>
      )}

      {WHAT_HAPPENED.length > 0 && (
        <Section heading="What happened">
          <BulletList items={WHAT_HAPPENED} />
        </Section>
      )}

      {cur && (
        <Section heading="Sponsor details">
          <Select
            label="Sponsor"
            options={SPONSORS.map((s: Sponsor, i: number) => ({ value: String(i), label: (i + 1) + ". " + s.sponsorName + " (" + s.channelTitle + ")" }))}
            value={selected}
            onChange={(v: string) => setSelected(v)}
          />
          <Properties items={props} />
          <textarea
            aria-label="Outreach pitch"
            value={pitches[curKey]}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => { const v = e.target.value; setPitches((p: Record<string, string>) => ({ ...p, [curKey]: v })); }}
            rows={9}
            style={{ width: "100%", boxSizing: "border-box", padding: 12, borderRadius: theme.radius.md, border: "1px solid " + theme.border.default, background: theme.bg.base, color: theme.text.primary, fontFamily: theme.font.family, fontSize: theme.font.body1.fontSize, lineHeight: theme.font.body1.lineHeight, resize: "vertical" }}
          />
          <Callout tone="info">Outreach pitch edits stay on this page while it's open and aren't saved to the sheet. Send opens your own mail app with the pitch filled in.</Callout>
          <Input label="Send To:" value={to} placeholder="name@company.com" onChange={(v: string) => setEmails((m: Record<string, string>) => ({ ...m, [curKey]: v }))} />
          <div>
            {canSend ? (
              <a href={mailto(to, pitches[curKey])} target="_blank" rel="noopener" style={{ ...btn, background: theme.fill.primary, color: theme.text.onPrimary, cursor: "pointer" }}>Send</a>
            ) : (
              <span aria-disabled="true" style={{ ...btn, background: theme.fill.secondary, color: theme.text.tertiary, cursor: "not-allowed" }}>Send</span>
            )}
          </div>
        </Section>
      )}

      {SHEET_URL && (
        <Section heading="Google Sheet">
          <LinkCards links={[{ title: "Sponsors sheet", site: "Google Sheets", href: SHEET_URL }]} />
        </Section>
      )}
    </Page>
  );
}
