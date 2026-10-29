#!/usr/bin/env node
// Deterministic JSON CLI for youtube-sponsor-scout (Grok Bot). Thin wrapper over scripts/server.mjs.
// .env is loaded by server.mjs from the tool folder (scripts/..), independent of cwd.
import fs from "node:fs";
import path from "node:path";
import {
  searchYouTubeVideosByTopic, detectYouTubeSponsors, enrichSponsorContact, appendSponsorToSheet,
  scoutYouTubeSponsorPipeline, scoutTopicSponsorsPipeline, getGoogleSheetsAccessToken,
  SHEET_HEADERS, SHEET_LAST_COL, buildSheetRow
} from "./server.mjs";

const SECRET_KEYS = ["YOUTUBE_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_AI_STUDIO_KEY", "HUNTER_API_KEY", "GOOGLE_PRIVATE_KEY"];
const ORDERS = ["relevance", "viewCount", "date", "rating"];
const USAGE = `usage: cli.mjs <command> [args]
  search <topic> [--count N] [--order relevance|viewCount|date|rating] [--page-token T]
  detect <url>
  enrich <domain>
  sheet-check
  append --json <rows.json>
  row-preview --json <rows.json>   (dry run: prints the 16-cell Sheet rows, never writes)
  export --json <rows.json> --out <dir>
  pipeline-topic <topic> --count N [--order O] [--no-sheet] [--no-enrich]
  pipeline-url <url> [--no-sheet] [--no-enrich]`;

function redact(s) {
  let out = String(s);
  for (const k of SECRET_KEYS) {
    const v = process.env[k];
    if (v && v.length >= 8) out = out.split(v).join(`[${k}]`);
  }
  return out;
}
function emit(obj) { process.stdout.write(redact(JSON.stringify(obj, null, 2)) + "\n"); }
function fail(msg, code = 1) { emit({ ok: false, error: redact(msg) }); process.exit(code); }

function parse(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-sheet" || a === "--no-enrich") opt[a.slice(2)] = true;
    else if (a.startsWith("--")) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) fail(`option ${a} needs a value\n${USAGE}`, 2);
      opt[a.slice(2)] = v; i++;
    } else pos.push(a);
  }
  return { pos, opt };
}
function intOpt(v, def, lo, hi, name) {
  if (v === undefined) return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) fail(`--${name} must be an integer ${lo}-${hi}`, 2);
  return n;
}
function orderOpt(v) {
  if (v === undefined) return "relevance";
  if (!ORDERS.includes(v)) fail(`--order must be one of ${ORDERS.join("|")}`, 2);
  return v;
}
function readRows(file) {
  if (!file) fail("--json <rows.json> is required", 2);
  let data;
  try { data = JSON.parse(fs.readFileSync(path.resolve(file), "utf8")); } catch (e) { fail(`cannot read rows file: ${e.message}`, 2); }
  const rows = Array.isArray(data) ? data : [data];
  rows.forEach((r, i) => { if (!r || !r.sponsorName) fail(`row ${i}: sponsorName is required`, 2); });
  return rows;
}
const COLS = ["searchedFor", "resultNo", "videoTitle", "channelTitle", "viewCount", "videoUrl", "sponsorName", "brandDomain", "timestamp",
  "extractedQuote", "contactName", "contactEmail", "contactTitle", "pitch", "status"];
// rows.json object -> appendSponsorToSheet fields (Sheet columns A:P, see SHEET_HEADERS in server.mjs)
function sheetFields(r) {
  return {
    searchedFor: r.searchedFor || "", resultNo: r.resultNo ?? "", videoUrl: r.videoUrl || "", viewCount: r.viewCount ?? "",
    timestamp: r.timestamp || "", brandDomain: r.brandDomain || "", sponsorName: r.sponsorName,
    contactName: r.contactName || "", contactTitle: r.contactTitle || "", contactEmail: r.contactEmail || "",
    extractedQuote: r.extractedQuote || "", pitch: r.pitch || "", channelTitle: r.channelTitle || "",
    videoTitle: r.videoTitle || "", ...(r.status ? { status: r.status } : {})
  };
}
const csvCell = (v) => { const s = v == null ? "" : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const mdCell = (v) => (v == null ? "" : String(v)).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, opt } = parse(rest);
  if (opt["no-enrich"]) delete process.env.HUNTER_API_KEY; // pipeline skips Hunter when key is absent
  const sheetId = opt["no-sheet"] ? "" : undefined;       // "" disables sheet logging in pipelines

  switch (cmd) {
    case "search": {
      if (!pos[0]) fail(`search needs <topic>\n${USAGE}`, 2);
      return emit(await searchYouTubeVideosByTopic(pos[0], intOpt(opt.count, 5, 1, 50, "count"), orderOpt(opt.order), opt["page-token"] || ""));
    }
    case "detect": {
      if (!pos[0]) fail(`detect needs <url>\n${USAGE}`, 2);
      const r = await detectYouTubeSponsors({ videoUrl: pos[0] });
      return emit({ ...r, transcriptSegments: r.transcriptExcerpt?.length ?? 0 });
    }
    case "enrich": {
      if (!pos[0]) fail(`enrich needs <domain>\n${USAGE}`, 2);
      return emit(await enrichSponsorContact({ domain: pos[0] }));
    }
    case "sheet-check": {
      const id = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
      if (!id) fail("Missing GOOGLE_SHEETS_SPREADSHEET_ID");
      const token = await getGoogleSheetsAccessToken();
      const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(`Sponsors!A1:${SHEET_LAST_COL}1`)}`,
        { headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) fail(`Sheets read error (${res.status}): ${body?.error?.message || res.statusText}`);
      const header = body.values?.[0] || [];
      return emit({
        ok: true,
        auth: "ok",
        range: body.range,
        headerPresent: header.length > 0,
        headerMatches: header.length === 0 || header.join("|") === SHEET_HEADERS.join("|"),
        header,
        expectedHeader: SHEET_HEADERS,
        spreadsheetId: id,
        url: `https://docs.google.com/spreadsheets/d/${id}/edit`
      });
    }
    case "append": {
      const rows = readRows(opt.json);
      const results = [];
      for (const r of rows) results.push(await appendSponsorToSheet(sheetFields(r)));
      return emit({ ok: true, appended: results.length, results });
    }
    case "row-preview": {
      const rows = readRows(opt.json);
      const loggedAt = new Date().toISOString().replace("T", " ").substring(0, 19);
      return emit({ ok: true, dryRun: true, header: SHEET_HEADERS,
        rows: rows.map((r) => { const v = buildSheetRow({ ...sheetFields(r), loggedAt }); return Object.fromEntries(SHEET_HEADERS.map((h, i) => [h, v[i]])); }) });
    }
    case "export": {
      const rows = readRows(opt.json);
      if (!opt.out) fail("--out <dir> is required", 2);
      const dir = path.resolve(opt.out);
      fs.mkdirSync(dir, { recursive: true });
      const csv = [COLS.join(","), ...rows.map((r) => COLS.map((c) => csvCell(r[c])).join(","))].join("\r\n") + "\r\n";
      const md = [`| ${COLS.join(" | ")} |`, `|${COLS.map(() => "---").join("|")}|`,
        ...rows.map((r) => `| ${COLS.map((c) => mdCell(r[c])).join(" | ")} |`)].join("\n") + "\n";
      fs.writeFileSync(path.join(dir, "sponsors.csv"), csv);
      fs.writeFileSync(path.join(dir, "sponsors.md"), md);
      return emit({ ok: true, rows: rows.length, files: [path.join(dir, "sponsors.md"), path.join(dir, "sponsors.csv")] });
    }
    case "pipeline-topic": {
      if (!pos[0]) fail(`pipeline-topic needs <topic>\n${USAGE}`, 2);
      if (opt.count === undefined) fail("pipeline-topic needs --count N", 2);
      return emit(await scoutTopicSponsorsPipeline({ topic: pos[0], count: intOpt(opt.count, 5, 1, 50, "count"),
        order: orderOpt(opt.order), spreadsheetId: sheetId }));
    }
    case "pipeline-url": {
      if (!pos[0]) fail(`pipeline-url needs <url>\n${USAGE}`, 2);
      return emit(await scoutYouTubeSponsorPipeline({ videoUrl: pos[0], spreadsheetId: sheetId }));
    }
    default:
      fail(USAGE, 2);
  }
}
main().catch((e) => fail(e?.message || String(e)));
