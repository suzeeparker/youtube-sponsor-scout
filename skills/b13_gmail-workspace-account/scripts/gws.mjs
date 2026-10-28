// node /tmp/b13-gws.mjs <check|url|exchange|save-client> <TOOL>   prints status only, never secrets
import fs from "fs"; import path from "path";
const [cmd, TOOL] = process.argv.slice(2); const envp = path.join(TOOL, ".env");
const read = () => { const e = {}; try { for (const l of fs.readFileSync(envp, "utf8").split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (!m) continue; let v = m[2].trim(); if (/^(["']).*\1$/s.test(v)) v = v.slice(1, -1); e[m[1]] = v; } } catch {} return e; };
const save = (kv) => { const keys = Object.keys(kv); let lines = fs.existsSync(envp) ? fs.readFileSync(envp, "utf8").split(/\r?\n/).filter(l => l && !keys.some(k => l.startsWith(k + "="))) : []; for (const k of keys) lines.push(`${k}=${kv[k]}`); fs.writeFileSync(envp + ".tmp", lines.join("\n") + "\n", { mode: 0o600 }); fs.renameSync(envp + ".tmp", envp); fs.chmodSync(envp, 0o600); };
const out = (o) => { console.log(JSON.stringify(o)); process.exit(0); };
const SCOPES = ["openid", "email", "https://mail.google.com/", "https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/documents", "https://www.googleapis.com/auth/presentations"];
const REDIRECT = "http://localhost";
const e = read(); const id = e.GOOGLE_OAUTH_CLIENT_ID, secret = e.GOOGLE_OAUTH_CLIENT_SECRET;
if (cmd === "save-client") {
  const cid = (process.env.GOOGLE_OAUTH_CLIENT_ID || "").trim(), cs = (process.env.GOOGLE_OAUTH_CLIENT_SECRET || "").trim(); const kv = {};
  if (cid) { if (!/\.apps\.googleusercontent\.com$/.test(cid)) out({ ok: false, error: "client ID should end in .apps.googleusercontent.com" }); kv.GOOGLE_OAUTH_CLIENT_ID = cid; }
  if (cs) kv.GOOGLE_OAUTH_CLIENT_SECRET = cs;
  if (!Object.keys(kv).length) out({ ok: false, error: "nothing to save" }); save(kv); out({ ok: true, saved: Object.keys(kv) });
}
if (cmd === "url") {
  if (!id || !secret) out({ ok: false, error: "NO_CLIENT" });
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth"); Object.entries({ client_id: id, redirect_uri: REDIRECT, response_type: "code", scope: SCOPES.join(" "), access_type: "offline", prompt: "consent" }).forEach(([k, v]) => u.searchParams.set(k, v)); out({ ok: true, url: u.toString() });
}
const token = async (body) => (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) })).json();
if (cmd === "exchange") {
  if (!id || !secret) out({ ok: false, error: "NO_CLIENT" });
  const raw = (process.env.GOOGLE_OAUTH_REDIRECT_URL || "").trim(); let code = raw;
  try { const u = new URL(raw); if (u.searchParams.get("error")) out({ ok: false, error: "Google returned: " + u.searchParams.get("error") }); code = u.searchParams.get("code") || ""; } catch {}
  if (!code) out({ ok: false, error: "no code found in the pasted address" });
  const t = await token({ code, client_id: id, client_secret: secret, redirect_uri: REDIRECT, grant_type: "authorization_code" });
  if (!t.refresh_token) out({ ok: false, error: t.error_description || t.error || "no refresh token returned" });
  save({ GOOGLE_OAUTH_REFRESH_TOKEN: t.refresh_token }); out({ ok: true, saved: "GOOGLE_OAUTH_REFRESH_TOKEN", scopes: t.scope });
}
if (cmd === "check") {
  if (!id || !secret) out({ ok: false, error: "NO_CLIENT" });
  if (!e.GOOGLE_OAUTH_REFRESH_TOKEN) out({ ok: false, error: "NO_TOKEN" });
  const t = await token({ client_id: id, client_secret: secret, refresh_token: e.GOOGLE_OAUTH_REFRESH_TOKEN, grant_type: "refresh_token" });
  if (!t.access_token) out({ ok: false, error: "TOKEN_INVALID: " + (t.error_description || t.error) });
  const H = { Authorization: "Bearer " + t.access_token };
  const probe = async (name, url, pick) => { try { const r = await fetch(url, { headers: H }); const j = await r.json(); return [name, r.ok ? pick(j) : "ERROR " + r.status + ": " + (j.error?.message || "")]; } catch (x) { return [name, "ERROR " + x.message]; } };
  const res = Object.fromEntries(await Promise.all([
    probe("gmail", "https://gmail.googleapis.com/gmail/v1/users/me/profile", j => "ok " + j.emailAddress),
    probe("calendar", "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1", j => "ok"),
    probe("drive", "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)", j => "ok"),
    probe("sheets", "https://www.googleapis.com/drive/v3/files?pageSize=1&q=mimeType%3D'application%2Fvnd.google-apps.spreadsheet'&fields=files(id)", j => "ok"),
    probe("docs", "https://docs.googleapis.com/v1/documents/none", j => "ok"),
    probe("slides", "https://slides.googleapis.com/v1/presentations/none", j => "ok")
  ]));
  // docs/slides probes use a dummy id: 404 means the API is reachable and authorized
  for (const k of ["docs", "slides"]) if (/^ERROR 404/.test(res[k])) res[k] = "ok";
  out({ ok: Object.values(res).every(v => v.startsWith("ok")), scopes: t.scope, ...res });
}
out({ ok: false, error: "usage: check|url|exchange|save-client <TOOL>" });
