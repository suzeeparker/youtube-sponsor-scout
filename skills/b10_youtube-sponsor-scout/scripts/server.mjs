#!/usr/bin/env node
/**
 * YouTube Sponsor Scout MCP Server and CLI
 *
 * Implements an automated YouTube Sponsor Scouting workflow:
 * 1. Topic Search & Video Metadata/Chapters/Transcript Ingestion via Free YouTube Data API v3 (`youtube.googleapis.com`)
 * 2. Contact Enrichment (Hunter.io `/v2/domain-search`)
 * 3. Data Persistence (Google Sheets API v4 via built-in Node.js RS256 JWT)
 * 4. 3-Sentence Personalized Pitch Generation (agent-supplied or deterministic 3-sentence builder)
 *
 * Works both as an MCP server (when `@modelcontextprotocol/sdk` is installed) and as a standalone zero-dependency
 * ES module / CLI script using built-in Node.js `crypto`, `fs`, `path`, and `fetch`.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILL_ROOT = path.resolve(__dirname, "..");

/**
 * Lightweight zero-dependency `.env` loader (supports standard KEY="VAL" and JSON-like "KEY": "VAL")
 */
export function loadEnvFiles(customPaths = []) {
  const candidates = [
    ...customPaths,
    path.join(SKILL_ROOT, ".env"),
    path.resolve(process.cwd(), ".env")
  ];

  for (const envPath of candidates) {
    if (!envPath || !fs.existsSync(envPath)) continue;
    try {
      const content = fs.readFileSync(envPath, "utf8");
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const match = line.match(/^"?([A-Za-z0-9_]+)"?\s*[:=]\s*(.*)$/);
        if (!match) continue;
        const key = match[1];
        let val = match[2].trim();
        if (val.endsWith(",")) val = val.slice(0, -1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    } catch {
      // ignore unreadable .env files
    }
  }
}

loadEnvFiles();

const getYouTubeApiKey = () =>
  process.env.YOUTUBE_API_KEY ||
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  process.env.GOOGLE_AI_STUDIO_KEY;

const getHunterApiKey = () => process.env.HUNTER_API_KEY;
const getDefaultSpreadsheetId = () => process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

/**
 * Extracts the 11-character YouTube video ID from any standard YouTube URL or ID string
 */
export function extractYouTubeVideoId(videoUrlOrId) {
  if (!videoUrlOrId) return null;
  const trimmed = String(videoUrlOrId).trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname.includes("youtu.be")) {
      return parsed.pathname.split("/").filter(Boolean)[0] || null;
    }
    const vParam = parsed.searchParams.get("v");
    if (vParam) return vParam;
    const shortsMatch = parsed.pathname.match(/\/(?:shorts|embed|v)\/([a-zA-Z0-9_-]{11})/);
    if (shortsMatch) return shortsMatch[1];
  } catch {
    const regexMatch = trimmed.match(/(?:v=|youtu\.be\/|\/embed\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
    if (regexMatch) return regexMatch[1];
  }
  return null;
}

/**
 * Converts ISO 8601 duration (e.g. PT8M8S) to seconds and MM:SS string
 */
export function parseIsoDuration(isoDuration = "") {
  const match = String(isoDuration).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return { totalSeconds: 0, formatted: "00:00" };
  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  const seconds = parseInt(match[3] || "0", 10);
  const totalSeconds = hours * 3600 + minutes * 60 + seconds;
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  return { totalSeconds, formatted: `${mm}:${ss}` };
}

/**
 * Parses MM:SS or HH:MM:SS timestamp into total seconds
 */
export function timestampToSeconds(ts = "00:00") {
  const parts = String(ts).trim().split(":").map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

/**
 * Formats seconds into MM:SS
 */
export function secondsToTimestamp(sec = 0) {
  const s = Math.max(0, Math.floor(sec));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

/**
 * Parses chapter lines and outbound links from a YouTube video description
 */
export function parseDescriptionMetadata(description = "", totalDurationSeconds = 0) {
  const lines = String(description).split(/\r?\n/);
  const chapters = [];
  const urls = [];

  for (const line of lines) {
    const tsMatch = line.match(/^(?:[-•*]\s*)?(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—:]?\s*(.+)$/);
    if (tsMatch) {
      const timestamp = secondsToTimestamp(timestampToSeconds(tsMatch[1]));
      const startSeconds = timestampToSeconds(tsMatch[1]);
      chapters.push({
        timestamp,
        startSeconds,
        title: tsMatch[2].trim()
      });
    }

    const lineUrls = line.match(/https?:\/\/[^\s)]+/gi) || [];
    for (const u of lineUrls) {
      urls.push({ url: u, contextLine: line.trim() });
    }
  }

  for (let i = 0; i < chapters.length; i++) {
    const nextStart = chapters[i + 1]?.startSeconds ?? (totalDurationSeconds || chapters[i].startSeconds + 60);
    chapters[i].endSeconds = nextStart;
    chapters[i].timestampRange = `${chapters[i].timestamp} - ${secondsToTimestamp(nextStart)}`;
  }

  return { chapters, urls };
}

/**
 * Attempts to fetch public timedtext captions from the YouTube watch page (best-effort, $0 cost)
 */
export async function fetchYouTubeTranscript(videoId) {
  try {
    const watchRes = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });
    if (!watchRes.ok) return [];
    const html = await watchRes.text();
    const match = html.match(/"captions":(\{"playerCaptionsTracklistRenderer":.*?\}),"videoDetails"/);
    if (!match) return [];
    const captionsObj = JSON.parse(match[1]);
    const track = captionsObj?.playerCaptionsTracklistRenderer?.captionTracks?.[0];
    if (!track?.baseUrl) return [];

    const xmlRes = await fetch(track.baseUrl);
    if (!xmlRes.ok) return [];
    const xml = await xmlRes.text();
    const segments = [];
    for (const m of xml.matchAll(/<text start="([^"]+)" dur="([^"]+)"[^>]*>([\s\S]*?)<\/text>/g)) {
      const startSeconds = Math.floor(parseFloat(m[1]));
      const text = m[3]
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (text) {
        segments.push({
          timestamp: secondsToTimestamp(startSeconds),
          startSeconds,
          text
        });
      }
    }
    return segments;
  } catch {
    return [];
  }
}

const IGNORED_DOMAINS = new Set([
  "youtube.com", "youtu.be", "google.com", "twitter.com", "x.com",
  "instagram.com", "facebook.com", "tiktok.com", "linkedin.com",
  "discord.gg", "discord.com", "patreon.com", "github.com",
  "amzn.to", "amazon.com", "bit.ly", "tinyurl.com", "linktr.ee"
]);

/**
 * Deterministic sponsor extraction from video snippet, chapters, links, and transcript
 */
export function extractSponsorFromMetadata({ videoUrl, title, channelTitle, description, durationSeconds, chapters, urls, transcript }) {
  let sponsorName = "";
  let brandDomain = "";

  const explicitPatterns = [
    /(?:video is\s+)?sponsored by\s+([A-Z][A-Za-z0-9.&+-]+(?:\s+[A-Z][A-Za-z0-9.&+-]+){0,2})/i,
    /(?:brought to you|partnered with|thanks to our sponsor)\s*:?\s*([A-Z][A-Za-z0-9.&+-]+(?:\s+[A-Z][A-Za-z0-9.&+-]+){0,2})/i
  ];

  let explicitQuoteLine = "";
  for (const line of String(description).split(/\r?\n/)) {
    for (const pat of explicitPatterns) {
      const m = line.match(pat);
      if (m && m[1]) {
        sponsorName = m[1].replace(/[.,!?;:]+$/, "").trim();
        explicitQuoteLine = line.trim();
        break;
      }
    }
    if (sponsorName) break;
  }

  if (sponsorName) {
    const slug = sponsorName.toLowerCase().replace(/[^a-z0-9]/g, "");
    const matchingUrl = urls.find((u) => u.url.toLowerCase().includes(slug));
    if (matchingUrl) {
      try {
        const host = new URL(matchingUrl.url).hostname.replace(/^www\./i, "").toLowerCase();
        if (!IGNORED_DOMAINS.has(host)) brandDomain = host;
      } catch {
        // ignore
      }
    }
    if (!brandDomain) {
      brandDomain = `${slug}.com`;
    }
  } else {
    for (const u of urls) {
      try {
        const host = new URL(u.url).hostname.replace(/^www\./i, "").toLowerCase();
        if (!IGNORED_DOMAINS.has(host) && !host.endsWith(".fm") && !host.endsWith(".ly")) {
          brandDomain = host;
          const base = host.split(".")[0];
          sponsorName = base.charAt(0).toUpperCase() + base.slice(1);
          explicitQuoteLine = u.contextLine;
          break;
        }
      } catch {
        // ignore
      }
    }
  }

  if (!sponsorName) {
    return {
      hasSponsor: false,
      videoUrl,
      videoTitle: title,
      channelTitle,
      duration: secondsToTimestamp(durationSeconds),
      sponsors: [],
      chapters,
      transcriptExcerpt: transcript.slice(0, 30),
      videoSummary: `${title} by ${channelTitle}`,
      analysisNotes: "No explicit sponsor mention detected in video metadata."
    };
  }

  const sponsorLower = sponsorName.toLowerCase();
  const matchingChapters = chapters.filter((c) => c.title.toLowerCase().includes(sponsorLower));
  let startSeconds = 0;
  let endSeconds = Math.min(durationSeconds || 90, 90);
  let timestampRange = "00:00 - 01:30";

  if (matchingChapters.length > 0) {
    startSeconds = matchingChapters[0].startSeconds;
    endSeconds = matchingChapters[matchingChapters.length - 1].endSeconds;
    timestampRange = `${secondsToTimestamp(startSeconds)} - ${secondsToTimestamp(endSeconds)}`;
  }

  const paragraphs = String(description)
    .split(/\r?\n\r?\n/)
    .map((p) => p.replace(/\r?\n/g, " ").trim())
    .filter(Boolean);

  const sponsorParagraphs = paragraphs.filter(
    (p) =>
      p.toLowerCase().includes(sponsorLower) &&
      !/^\d{1,2}:\d{2}/.test(p) &&
      !/^chapters\b/i.test(p)
  );

  const extractedQuote =
    sponsorParagraphs.join(" — ") ||
    explicitQuoteLine ||
    `Sponsored integration featuring ${sponsorName} (${brandDomain}).`;

  const sponsorEntry = {
    sponsorName,
    brandDomain,
    timestampRange,
    startSeconds,
    endSeconds,
    extractedQuote,
    productCategory: "Software / SaaS & Creator Partnerships",
    offerDetails: urls[0]?.url || `https://${brandDomain}`,
    confidenceScore: 95
  };

  return {
    hasSponsor: true,
    videoUrl,
    videoTitle: title,
    channelTitle,
    duration: secondsToTimestamp(durationSeconds),
    sponsorName,
    brandDomain,
    timestampRange,
    extractedQuote,
    productCategory: sponsorEntry.productCategory,
    sponsors: [sponsorEntry],
    chapters,
    description,
    transcriptExcerpt: transcript.slice(0, 40),
    videoSummary: `${title} by ${channelTitle} (Sponsored by ${sponsorName})`,
    analysisNotes: "Ingested via free YouTube Data API v3 ($0 Gemini API token cost)."
  };
}

/**
 * Core Function 0: searchYouTubeVideosByTopic
 * Searches YouTube Data API v3 for the top `{count}` videos related to `{topic}` and enriches with video statistics,
 * duration, and a quick sponsor detection preview.
 * Supports passing either `(topic, count, order)` positional arguments or a single options object `{ topic, count, order }`.
 */
export async function searchYouTubeVideosByTopic(topicOrOptions, countArg = 5, orderArg = "relevance", pageTokenArg = "") {
  let topic = topicOrOptions;
  let count = countArg;
  let order = orderArg;
  let pageToken = pageTokenArg;

  if (topicOrOptions && typeof topicOrOptions === "object") {
    topic = topicOrOptions.topic;
    count = topicOrOptions.count ?? 5;
    order = topicOrOptions.order ?? "relevance";
    pageToken = topicOrOptions.pageToken ?? "";
  }

  if (!topic || !String(topic).trim()) {
    throw new Error("Missing required 'topic' parameter for searchYouTubeVideosByTopic.");
  }

  const apiKey = getYouTubeApiKey();
  if (!apiKey) {
    throw new Error("Missing YOUTUBE_API_KEY (or GEMINI_API_KEY / GOOGLE_API_KEY) environment variable.");
  }

  const maxResults = Math.min(Math.max(Number(count) || 5, 1), 50);
  const validOrders = new Set(["relevance", "viewCount", "date", "rating", "title", "videoCount"]);
  const safeOrder = validOrders.has(order) ? order : "relevance";

  const searchUrl =
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video` +
    `&q=${encodeURIComponent(String(topic).trim())}` +
    `&maxResults=${maxResults}` +
    `&order=${encodeURIComponent(safeOrder)}` +
    (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "") +
    `&key=${encodeURIComponent(apiKey)}`;

  const searchRes = await fetch(searchUrl);
  if (!searchRes.ok) {
    const errText = await searchRes.text();
    throw new Error(`YouTube Data API v3 search error (${searchRes.status} ${searchRes.statusText}): ${errText}`);
  }

  const searchData = await searchRes.json();
  const searchItems = searchData?.items || [];
  const nextPageToken = searchData?.nextPageToken || null;
  const videoIds = searchItems
    .map((item) => item?.id?.videoId)
    .filter(Boolean);

  if (videoIds.length === 0) {
    return {
      topic: String(topic).trim(),
      requestedCount: maxResults,
      order: safeOrder,
      totalReturned: 0,
      nextPageToken,
      videos: []
    };
  }

  const detailsUrl =
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics` +
    `&id=${encodeURIComponent(videoIds.join(","))}` +
    `&key=${encodeURIComponent(apiKey)}`;

  const detailsRes = await fetch(detailsUrl);
  if (!detailsRes.ok) {
    const errText = await detailsRes.text();
    throw new Error(`YouTube Data API v3 videos details error (${detailsRes.status} ${detailsRes.statusText}): ${errText}`);
  }

  const detailsData = await detailsRes.json();
  const detailsById = new Map((detailsData?.items || []).map((item) => [item.id, item]));

  const videos = videoIds
    .map((id) => {
      const item = detailsById.get(id);
      if (!item) return null;
      const videoUrl = `https://www.youtube.com/watch?v=${id}`;
      const title = item.snippet?.title || "";
      const channelTitle = item.snippet?.channelTitle || "";
      const publishedAt = item.snippet?.publishedAt || "";
      const description = item.snippet?.description || "";
      const { totalSeconds: durationSeconds, formatted: duration } = parseIsoDuration(
        item.contentDetails?.duration || ""
      );
      const viewCount = Number(item.statistics?.viewCount || 0);
      const likeCount = Number(item.statistics?.likeCount || 0);

      const { chapters, urls } = parseDescriptionMetadata(description, durationSeconds);
      const sponsorPreview = extractSponsorFromMetadata({
        videoUrl,
        title,
        channelTitle,
        description,
        durationSeconds,
        chapters,
        urls,
        transcript: []
      });

      return {
        videoId: id,
        videoUrl,
        title,
        channelTitle,
        publishedAt,
        duration,
        durationSeconds,
        viewCount,
        likeCount,
        hasSponsorHint: sponsorPreview.hasSponsor,
        sponsorName: sponsorPreview.sponsorName || null,
        brandDomain: sponsorPreview.brandDomain || null,
        timestampRange: sponsorPreview.timestampRange || null,
        extractedQuote: sponsorPreview.extractedQuote || null
      };
    })
    .filter(Boolean);

  return {
    topic: String(topic).trim(),
    requestedCount: maxResults,
    order: safeOrder,
    totalReturned: videos.length,
    nextPageToken,
    videos
  };
}

/**
 * Core Function 1: detectYouTubeSponsors
 * Fetches video snippet & contentDetails from YouTube Data API v3 ($0 cost) and extracts sponsor metadata.
 */
export async function detectYouTubeSponsors({ videoUrl }) {
  const apiKey = getYouTubeApiKey();
  if (!apiKey) {
    throw new Error("Missing YOUTUBE_API_KEY (or GEMINI_API_KEY / GOOGLE_API_KEY) environment variable.");
  }

  const videoId = extractYouTubeVideoId(videoUrl);
  if (!videoId) {
    throw new Error(`Invalid YouTube video URL or ID: ${videoUrl}`);
  }

  const endpoint = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(endpoint);

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`YouTube Data API v3 error (${res.status} ${res.statusText}): ${errorText}`);
  }

  const data = await res.json();
  const item = data?.items?.[0];
  if (!item) {
    throw new Error(`YouTube video not found for ID: ${videoId}`);
  }

  const title = item.snippet?.title || "";
  const channelTitle = item.snippet?.channelTitle || "";
  const description = item.snippet?.description || "";
  const { totalSeconds: durationSeconds } = parseIsoDuration(item.contentDetails?.duration || "");
  const { chapters, urls } = parseDescriptionMetadata(description, durationSeconds);
  const transcript = await fetchYouTubeTranscript(videoId);

  return extractSponsorFromMetadata({
    videoUrl,
    title,
    channelTitle,
    description,
    durationSeconds,
    chapters,
    urls,
    transcript
  });
}

/**
 * Core Function 2: enrichSponsorContact
 * Queries Hunter.io `/v2/domain-search` to find marketing/partnerships decision makers.
 */
export async function enrichSponsorContact({
  domain,
  department = "marketing",
  seniority = "executive,director,manager",
  limit = 10
}) {
  const hunterKey = getHunterApiKey();
  if (!hunterKey) {
    throw new Error("Missing HUNTER_API_KEY environment variable.");
  }

  const cleanDomain = String(domain)
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    .trim()
    .toLowerCase();

  const buildUrl = (dept, sen) => {
    let url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(cleanDomain)}&limit=${limit}&api_key=${hunterKey}`;
    if (dept) url += `&department=${encodeURIComponent(dept)}`;
    if (sen) url += `&seniority=${encodeURIComponent(sen)}`;
    return url;
  };

  let res = await fetch(buildUrl(department, seniority));
  let data = await res.json();

  if ((!data.data?.emails || data.data.emails.length === 0) && department) {
    res = await fetch(buildUrl(null, seniority));
    data = await res.json();
  }

  if (!res.ok) {
    const errorMsg = data?.errors?.[0]?.details || res.statusText;
    throw new Error(`Hunter.io API error (${res.status}): ${errorMsg}`);
  }

  const emailsList = data.data?.emails || [];
  const orgName = data.data?.organization || cleanDomain;
  const pattern = data.data?.pattern;

  const priorityKeywords = [
    "influencer", "partnership", "sponsorship", "creator", "brand",
    "growth", "cmo", "marketing director", "head of marketing", "vp marketing"
  ];

  function calculateScore(emailItem) {
    let score = emailItem.confidence || 50;
    const position = (emailItem.position || "").toLowerCase();
    for (const kw of priorityKeywords) {
      if (position.includes(kw)) {
        score += 40;
        break;
      }
    }
    if (emailItem.seniority === "director") score += 20;
    if (emailItem.seniority === "executive") score += 15;
    if (emailItem.seniority === "manager") score += 10;
    if (emailItem.type === "personal") score += 10;
    return score;
  }

  const rankedContacts = emailsList
    .map((e) => ({
      firstName: e.first_name,
      lastName: e.last_name,
      fullName: [e.first_name, e.last_name].filter(Boolean).join(" ") || "Marketing Lead",
      email: e.value,
      position: e.position || "Marketing / Growth Lead",
      seniority: e.seniority,
      department: e.department,
      confidence: e.confidence,
      type: e.type,
      linkedin: e.linkedin,
      score: calculateScore(e)
    }))
    .sort((a, b) => b.score - a.score);

  return {
    domain: cleanDomain,
    organization: orgName,
    emailPattern: pattern,
    totalFound: emailsList.length,
    primaryDecisionMaker: rankedContacts[0] || null,
    alternativeContacts: rankedContacts.slice(1, 5)
  };
}

/**
 * Generates an OAuth2 access token for Google Sheets API v4 using Node's built-in `crypto`
 */
export async function getGoogleSheetsAccessToken() {
  const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON;
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  let clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (credentialsJson) {
    const parsed = JSON.parse(credentialsJson);
    clientEmail = parsed.client_email;
    privateKey = parsed.private_key;
  } else if ((!clientEmail || !privateKey) && credentialsPath && fs.existsSync(credentialsPath)) {
    const parsed = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
    clientEmail = parsed.client_email;
    privateKey = parsed.private_key;
  }

  if (!clientEmail || !privateKey) {
    throw new Error(
      "Missing Google Sheets credentials. Provide GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY, GOOGLE_APPLICATION_CREDENTIALS, or GOOGLE_SERVICE_ACCOUNT_KEY_JSON."
    );
  }

  const formattedKey = privateKey.replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned =
    b64({ alg: "RS256", typ: "JWT" }) +
    "." +
    b64({
      iss: clientEmail,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600
    });
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(formattedKey, "base64url");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`
    })
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Google OAuth2 token error (${tokenRes.status}): ${errText}`);
  }

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

/**
 * Core Function 3: appendSponsorToSheet
 * Appends a scouted sponsor tracking row into Google Sheets API v4.
 */
export async function appendSponsorToSheet({
  spreadsheetId = getDefaultSpreadsheetId(),
  sheetName = "Sponsors",
  sponsorName,
  brandDomain = "",
  timestamp,
  extractedQuote,
  contactEmail,
  contactName = "",
  contactTitle = "",
  pitch = "",
  videoUrl = "",
  status = "Scouted - Ready to Pitch"
}) {
  if (!spreadsheetId) {
    throw new Error("Missing spreadsheetId parameter and GOOGLE_SHEETS_SPREADSHEET_ID environment variable.");
  }

  const accessToken = await getGoogleSheetsAccessToken();
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json"
  };

  try {
    const headerRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${sheetName}!A1:K1`)}`,
      { headers }
    );
    if (headerRes.ok) {
      const headerData = await headerRes.json();
      if (!headerData.values || headerData.values.length === 0) {
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${sheetName}!A1:K1`)}?valueInputOption=USER_ENTERED`,
          {
            method: "PUT",
            headers,
            body: JSON.stringify({
              values: [[
                "Video URL", "Video Timestamp", "Brand Domain", "Sponsor Name",
                "Decision Maker Name", "Job Title", "Contact Email", "Extracted Quote",
                "Outreach Pitch", "Logged At", "Status"
              ]]
            })
          }
        );
      }
    }
  } catch {
    // ignore header check warning
  }

  const loggedAt = new Date().toISOString().replace("T", " ").substring(0, 19);
  // Column order: Video URL | Video Timestamp | Brand Domain | Sponsor Name |
  // Decision Maker Name | Job Title | Contact Email | Extracted Quote | Outreach Pitch | Logged At | Status
  const rowValues = [
    videoUrl,
    timestamp,
    brandDomain,
    sponsorName,
    contactName,
    contactTitle,
    contactEmail,
    extractedQuote,
    pitch,
    loggedAt,
    status
  ];

  const appendRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${sheetName}!A:K`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ values: [rowValues] })
    }
  );

  if (!appendRes.ok) {
    const errText = await appendRes.text();
    throw new Error(`Google Sheets append error (${appendRes.status}): ${errText}`);
  }

  const appendData = await appendRes.json();
  return {
    success: true,
    message: `Successfully logged sponsor '${sponsorName}' to Google Sheet.`,
    spreadsheetId,
    sheetName,
    updatedRange: appendData.updates?.updatedRange,
    updatedRows: appendData.updates?.updatedRows || 1
  };
}

/**
 * Core Function 4: generateSponsorPitch
 * Builds a strict 3-sentence personalized outreach pitch ($0 external API cost).
 * Accepts an optional agent-crafted `customPitch` from the calling agent.
 */
export async function generateSponsorPitch({
  sponsorName,
  sponsorDomain = "",
  extractedQuote = "",
  contactName = "there",
  channelName = "our channel",
  channelNiche = "AI & developer workflows",
  audienceMetrics = "an engaged community of technical builders and decision-makers",
  customPitch = ""
}) {
  const firstName = String(contactName || "there").split(" ")[0];
  const shortQuote = String(extractedQuote)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);

  if (customPitch && customPitch.trim()) {
    const sentences = customPitch
      .trim()
      .split(/(?<=[.!?])\s+/)
      .filter(Boolean);
    return {
      subjectLine: `Partnership idea: ${sponsorName} x ${channelName}`,
      sentence1: sentences[0] || customPitch,
      sentence2: sentences[1] || "",
      sentence3: sentences[2] || "",
      fullPitch: customPitch.trim(),
      sentenceCount: sentences.length || 3
    };
  }

  const sentence1 = `Hi ${firstName}, I caught ${sponsorName}'s recent YouTube sponsorship integration ("${shortQuote}") and was impressed by how clearly it positioned ${sponsorDomain || sponsorName}'s real-world workflow value.`;
  const sentence2 = `At ${channelName}, we focus on ${channelNiche} and reach ${audienceMetrics} who actively evaluate and adopt tools like ${sponsorName}.`;
  const sentence3 = `Would you be open to a quick 5-minute chat next week, or can I send over our concise media kit with audience benchmarks?`;

  return {
    subjectLine: `Loved ${sponsorName}'s recent YouTube integration — ${channelName} partnership?`,
    sentence1,
    sentence2,
    sentence3,
    fullPitch: `${sentence1} ${sentence2} ${sentence3}`,
    sentenceCount: 3
  };
}

/**
 * Core Function 5: scoutYouTubeSponsorPipeline
 * Runs the complete 5-step pipeline for a single video URL ($0 Gemini API cost).
 */
export async function scoutYouTubeSponsorPipeline({
  videoUrl,
  spreadsheetId = getDefaultSpreadsheetId(),
  channelName,
  channelNiche,
  audienceMetrics,
  customPitch
}) {
  const detection = await detectYouTubeSponsors({ videoUrl });
  if (!detection.hasSponsor || !detection.brandDomain) {
    return {
      status: "NO_SPONSOR_DETECTED",
      message: "No sponsored brand deals found in this video.",
      videoMetadata: detection
    };
  }

  let enrichment = null;
  let contactEmail = "";
  let contactName = "there";
  let contactTitle = "";

  if (getHunterApiKey()) {
    enrichment = await enrichSponsorContact({ domain: detection.brandDomain });
    if (enrichment.primaryDecisionMaker) {
      contactEmail = enrichment.primaryDecisionMaker.email;
      contactName = enrichment.primaryDecisionMaker.fullName;
      contactTitle = enrichment.primaryDecisionMaker.position;
    }
  }

  const pitchResult = await generateSponsorPitch({
    sponsorName: detection.sponsorName,
    sponsorDomain: detection.brandDomain,
    extractedQuote: detection.extractedQuote,
    contactName,
    channelName,
    channelNiche,
    audienceMetrics,
    customPitch
  });

  let sheetResult = null;
  if (spreadsheetId && contactEmail) {
    sheetResult = await appendSponsorToSheet({
      spreadsheetId,
      sponsorName: detection.sponsorName,
      brandDomain: detection.brandDomain,
      timestamp: detection.timestampRange,
      extractedQuote: detection.extractedQuote,
      contactEmail,
      contactName,
      contactTitle,
      pitch: pitchResult.fullPitch,
      videoUrl
    });
  }

  return {
    status: "SUCCESS",
    sponsor: detection,
    contact: enrichment,
    pitch: pitchResult,
    sheetLogged: Boolean(sheetResult?.success),
    sheetResult
  };
}

/**
 * Core Function 6: scoutTopicSponsorsPipeline
 * Searches YouTube for the top `{count}` videos related to `{topic}` and executes the sponsor scouting pipeline
 * across each video that contains a detected sponsor.
 */
export async function scoutTopicSponsorsPipeline({
  topic,
  count = 5,
  order = "relevance",
  spreadsheetId = getDefaultSpreadsheetId(),
  creatorChannelName,
  creatorNiche,
  audienceStats,
  channelName,
  channelNiche,
  audienceMetrics
}) {
  const searchResults = await searchYouTubeVideosByTopic(topic, count, order);
  const resolvedChannelName = creatorChannelName || channelName;
  const resolvedChannelNiche = creatorNiche || channelNiche;
  const resolvedAudience = audienceStats || audienceMetrics;

  const scoutedResults = [];
  for (const video of searchResults.videos) {
    if (!video.hasSponsorHint || !video.brandDomain) {
      scoutedResults.push({
        videoId: video.videoId,
        videoUrl: video.videoUrl,
        title: video.title,
        channelTitle: video.channelTitle,
        viewCount: video.viewCount,
        status: "NO_SPONSOR_DETECTED"
      });
      continue;
    }

    const pipelineRes = await scoutYouTubeSponsorPipeline({
      videoUrl: video.videoUrl,
      spreadsheetId,
      channelName: resolvedChannelName,
      channelNiche: resolvedChannelNiche,
      audienceMetrics: resolvedAudience
    });

    scoutedResults.push({
      videoId: video.videoId,
      videoUrl: video.videoUrl,
      title: video.title,
      channelTitle: video.channelTitle,
      viewCount: video.viewCount,
      ...pipelineRes
    });
  }

  return {
    topic: searchResults.topic,
    requestedCount: searchResults.requestedCount,
    order: searchResults.order,
    totalVideosAnalyzed: searchResults.videos.length,
    sponsorsFoundCount: scoutedResults.filter((r) => r.status === "SUCCESS").length,
    videos: searchResults.videos,
    results: scoutedResults
  };
}

/**
 * Starts the MCP stdio server if `@modelcontextprotocol/sdk` is installed, or runs CLI mode if args are passed.
 */
async function run() {
  const cliArg = process.argv[2];
  if (cliArg === "--topic" || cliArg === "-t") {
    const topic = process.argv[3];
    const count = Number(process.argv[4] || 5);
    const order = process.argv[5] || "relevance";
    const result = await searchYouTubeVideosByTopic(topic, count, order);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (cliArg && (cliArg.startsWith("http://") || cliArg.startsWith("https://"))) {
    const result = await scoutYouTubeSponsorPipeline({ videoUrl: cliArg });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { z } = await import("zod");

  const server = new McpServer({
    name: "youtube-sponsor-scout",
    version: "1.2.0"
  });

  server.tool(
    "search_youtube_videos_by_topic",
    "Searches YouTube via the free YouTube Data API v3 for the top {count} videos matching a {topic}, returning video URLs, titles, channel names, view/like counts, durations, and sponsor hints.",
    {
      topic: z.string().describe("Search topic or keyword phrase (e.g., 'AI coding agents', 'MCP server tutorial')"),
      count: z.number().optional().describe("Number of top videos to retrieve (default: 5, max: 50)"),
      order: z
        .enum(["relevance", "viewCount", "date", "rating"])
        .optional()
        .describe("Sort order for YouTube search results (default: 'relevance')")
    },
    async ({ topic, count = 5, order = "relevance" }) => {
      try {
        const result = await searchYouTubeVideosByTopic(topic, count, order);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: `Error searching YouTube videos by topic: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "detect_youtube_sponsors",
    "Accepts a YouTube URL and uses the free YouTube Data API v3 + caption extraction ($0 Gemini API cost) to retrieve video metadata, chapters, timestamps, brand names, domains, and extracted quotes for the calling agent.",
    {
      videoUrl: z.string().url().describe("The full public YouTube video URL (e.g. https://www.youtube.com/watch?v=xyz)")
    },
    async ({ videoUrl }) => {
      try {
        const result = await detectYouTubeSponsors({ videoUrl });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: `Error detecting sponsors: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "enrich_sponsor_contact",
    "Takes a sponsor's company domain name and queries Hunter.io (/v2/domain-search) to locate verified partnership and marketing decision-maker emails.",
    {
      domain: z.string().describe("Company domain name (e.g., 'zapier.com' or 'nordvpn.com')"),
      department: z.string().optional().describe("Hunter.io department filter: 'marketing', 'management', or 'communication' (default: 'marketing')"),
      seniority: z.string().optional().describe("Hunter.io seniority filter: 'executive,director,manager'"),
      limit: z.number().optional().describe("Max number of contacts to fetch (default: 10)")
    },
    async (params) => {
      try {
        const result = await enrichSponsorContact(params);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: `Error enriching contact via Hunter.io: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "append_sponsor_to_sheet",
    "Appends a new row logging the scouted sponsor name, video timestamp, extracted quote, contact email, and 3-sentence pitch into a designated Google Sheet.",
    {
      spreadsheetId: z.string().optional().describe("Google Spreadsheet ID (uses GOOGLE_SHEETS_SPREADSHEET_ID env var if omitted)"),
      sheetName: z.string().optional().describe("Worksheet tab name (default: 'Sponsors')"),
      sponsorName: z.string().describe("Name of the sponsored brand"),
      brandDomain: z.string().optional().describe("Domain of the brand (e.g. zapier.com)"),
      timestamp: z.string().describe("Timestamp range in the video (e.g. '01:38 - 04:48')"),
      extractedQuote: z.string().describe("Verbatim quote or transcript excerpt of the sponsor integration"),
      contactEmail: z.string().email().describe("Enriched decision-maker contact email address"),
      contactName: z.string().optional().describe("Name of the decision-maker contact"),
      contactTitle: z.string().optional().describe("Job title of the contact"),
      pitch: z.string().optional().describe("Generated 3-sentence outreach pitch"),
      videoUrl: z.string().optional().describe("Original YouTube video URL"),
      status: z.string().optional().describe("Tracking status (default: 'Scouted - Ready to Pitch')")
    },
    async (params) => {
      try {
        const result = await appendSponsorToSheet(params);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: `Error appending sponsor to Google Sheet: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "generate_sponsor_pitch",
    "Builds or formats a 3-sentence personalized cold outreach pitch tailored to the detected sponsor context and creator's channel ($0 external API cost).",
    {
      sponsorName: z.string().describe("Brand or sponsor name (e.g., 'Zapier')"),
      sponsorDomain: z.string().optional().describe("Sponsor domain name (e.g., 'zapier.com')"),
      extractedQuote: z.string().describe("Verbatim quote or context of how the sponsor was featured in the analyzed video"),
      contactName: z.string().optional().describe("First name of the decision maker (e.g. 'Anja')"),
      channelName: z.string().optional().describe("Outreach creator's channel name"),
      channelNiche: z.string().optional().describe("Creator's niche or topic focus"),
      audienceMetrics: z.string().optional().describe("Audience size or demographics"),
      customPitch: z.string().optional().describe("Optional 3-sentence pitch drafted directly by the calling agent")
    },
    async (params) => {
      try {
        const result = await generateSponsorPitch(params);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: `Error generating pitch: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "scout_youtube_sponsor_pipeline",
    "Executes the complete $0 YouTube Sponsor Scouting pipeline for a single video URL: 1. Free YouTube Data API v3 metadata & chapter ingestion, 2. Sponsor detection, 3. Hunter.io contact enrichment, 4. 3-Sentence pitch drafting, and 5. Google Sheets logging.",
    {
      videoUrl: z.string().url().describe("The YouTube video URL to analyze"),
      spreadsheetId: z.string().optional().describe("Optional Google Spreadsheet ID to log results"),
      channelName: z.string().optional().describe("Your YouTube channel name for tailored pitch crafting"),
      channelNiche: z.string().optional().describe("Your channel's niche / focus area"),
      audienceMetrics: z.string().optional().describe("Your channel's audience size and metrics"),
      customPitch: z.string().optional().describe("Optional 3-sentence pitch drafted by the calling agent")
    },
    async (params) => {
      try {
        const result = await scoutYouTubeSponsorPipeline(params);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: `Pipeline failure: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "scout_topic_sponsors_pipeline",
    "Searches YouTube for the top {count} videos matching {topic} and runs the complete sponsor scouting, Hunter.io contact enrichment, 3-sentence pitch generation, and Google Sheets logging pipeline across them.",
    {
      topic: z.string().describe("Topic or keyword phrase to search on YouTube (e.g., 'AI coding agents')"),
      count: z.number().optional().describe("Number of top videos to retrieve and scout (default: 5, max: 50)"),
      order: z
        .enum(["relevance", "viewCount", "date", "rating"])
        .optional()
        .describe("Sort order for YouTube search (default: 'relevance')"),
      spreadsheetId: z.string().optional().describe("Optional Google Spreadsheet ID to log discovered sponsors"),
      creatorChannelName: z.string().optional().describe("Your YouTube channel name for tailored pitch crafting"),
      creatorNiche: z.string().optional().describe("Your channel's niche / focus area"),
      audienceStats: z.string().optional().describe("Your channel's audience size and metrics")
    },
    async (params) => {
      try {
        const result = await scoutTopicSponsorsPipeline(params);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: `Topic pipeline failure: ${err.message}` }] };
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("YouTube Sponsor Scout MCP Server active on stdio.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error("Fatal error:", err.message);
    process.exit(1);
  });
}
