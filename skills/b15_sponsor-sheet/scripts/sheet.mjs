// node /tmp/b15-sheet.mjs <check|create> <TOOL> [title]   prints status JSON only, never secrets
import fs from "fs"; import path from "path";
const [cmd, TOOL, TITLE = "YouTube Sponsor Scout"] = process.argv.slice(2); const envp = path.join(TOOL || ".", ".env");
const TAB = "Sponsors";
const HEADERS = ["Video URL", "Video Timestamp", "Brand Domain", "Sponsor Name", "Decision Maker Name", "Job Title", "Contact Email", "Extracted Quote", "Outreach Pitch", "Logged At", "Status"];
const out = (o) => { console.log(JSON.stringify(o)); process.exit(0); };
const read = () => { const e = {}; try { for (const l of fs.readFileSync(envp, "utf8").split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (!m) continue; let v = m[2].trim(); if (/^(["']).*\1$/s.test(v)) v = v.slice(1, -1); e[m[1]] = v; } } catch {} return e; };
const save = (kv) => { const keys = Object.keys(kv); const lines = fs.existsSync(envp) ? fs.readFileSync(envp, "utf8").split(/\r?\n/).filter(l => l && !keys.some(k => l.startsWith(k + "="))) : []; for (const k of keys) lines.push(`${k}=${kv[k]}`); fs.writeFileSync(envp + ".tmp", lines.join("\n") + "\n", { mode: 0o600 }); fs.renameSync(envp + ".tmp", envp); fs.chmodSync(envp, 0o600); };
const e = read();
if (!e.GOOGLE_OAUTH_CLIENT_ID || !e.GOOGLE_OAUTH_CLIENT_SECRET || !e.GOOGLE_OAUTH_REFRESH_TOKEN) out({ ok: false, error: "NO_GOOGLE_SIGNIN" });
const t = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: e.GOOGLE_OAUTH_CLIENT_ID, client_secret: e.GOOGLE_OAUTH_CLIENT_SECRET, refresh_token: e.GOOGLE_OAUTH_REFRESH_TOKEN, grant_type: "refresh_token" }) })).json();
if (!t.access_token) out({ ok: false, error: "GOOGLE_SIGNIN_INVALID: " + (t.error_description || t.error) });
const H = { Authorization: "Bearer " + t.access_token, "Content-Type": "application/json" };
const api = async (url, opt = {}) => { const r = await fetch(url, { headers: H, ...opt }); const j = await r.json().catch(() => ({})); return { ok: r.ok, status: r.status, j }; };
const S = "https://sheets.googleapis.com/v4/spreadsheets";
const share = async (id) => {
  const sa = e.GOOGLE_SERVICE_ACCOUNT_EMAIL; if (!sa) return "no GOOGLE_SERVICE_ACCOUNT_EMAIL in .env, not shared";
  const r = await api(`https://www.googleapis.com/drive/v3/files/${id}/permissions?sendNotificationEmail=false`, { method: "POST", body: JSON.stringify({ type: "user", role: "writer", emailAddress: sa }) });
  return r.ok ? "shared as Editor with " + sa : "share failed " + r.status + ": " + (r.j.error?.message || "");
};
const inspect = async (id) => {
  const r = await api(`${S}/${id}?fields=properties.title,sheets.properties.title`);
  if (!r.ok) return { ok: false, error: `SHEET_UNREADABLE ${r.status}: ${r.j.error?.message || ""}` };
  const tabs = r.j.sheets.map(s => s.properties.title); const res = { title: r.j.properties.title, tabs, url: `https://docs.google.com/spreadsheets/d/${id}/edit` };
  if (!tabs.includes(TAB)) return { ok: false, error: "NO_SPONSORS_TAB", ...res };
  const h = await api(`${S}/${id}/values/${encodeURIComponent(TAB + "!A1:K1")}`); const row = h.j.values?.[0] || [];
  return { ok: true, ...res, headers: row.length === 0 ? "empty (the scout writes them on first log)" : row.join(" | ") === HEADERS.join(" | ") ? "match" : "differ: " + row.join(" | ") };
};
if (cmd === "check") {
  if (!e.GOOGLE_SHEETS_SPREADSHEET_ID) out({ ok: false, error: "NO_SHEET_ID" });
  out(await inspect(e.GOOGLE_SHEETS_SPREADSHEET_ID));
}
if (cmd === "create") {
  if (e.GOOGLE_SHEETS_SPREADSHEET_ID) out({ ok: false, error: "SHEET_ID_ALREADY_SET: refusing to replace it" });
  const c = await api(S, { method: "POST", body: JSON.stringify({ properties: { title: TITLE }, sheets: [{ properties: { title: TAB, gridProperties: { frozenRowCount: 1 } } }] }) });
  if (!c.ok) out({ ok: false, error: `CREATE_FAILED ${c.status}: ${c.j.error?.message || ""}` });
  const id = c.j.spreadsheetId, gid = c.j.sheets[0].properties.sheetId;
  await api(`${S}/${id}/values/${encodeURIComponent(TAB + "!A1:K1")}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [HEADERS] }) });
  await api(`${S}/${id}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: [{ repeatCell: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: "userEnteredFormat.textFormat.bold" } }] }) });
  save({ GOOGLE_SHEETS_SPREADSHEET_ID: id });
  out({ created: true, shared: await share(id), ...(await inspect(id)) });
}
out({ ok: false, error: "usage: check|create <TOOL> [title]" });
