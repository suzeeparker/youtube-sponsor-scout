import test from "node:test";
import assert from "node:assert/strict";
import {
  extractYouTubeVideoId,
  parseIsoDuration,
  parseDescriptionMetadata,
  extractSponsorFromMetadata,
  generateSponsorPitch,
  searchYouTubeVideosByTopic
} from "./server.mjs";

test("extractYouTubeVideoId parses watch, short, and raw video IDs", () => {
  assert.equal(extractYouTubeVideoId("https://www.youtube.com/watch?v=tCd105_BsAo"), "tCd105_BsAo");
  assert.equal(extractYouTubeVideoId("https://youtu.be/tCd105_BsAo?t=98"), "tCd105_BsAo");
  assert.equal(extractYouTubeVideoId("https://www.youtube.com/shorts/tCd105_BsAo"), "tCd105_BsAo");
  assert.equal(extractYouTubeVideoId("tCd105_BsAo"), "tCd105_BsAo");
});

test("parseIsoDuration converts ISO 8601 duration to seconds and MM:SS", () => {
  const res = parseIsoDuration("PT8M8S");
  assert.equal(res.totalSeconds, 488);
  assert.equal(res.formatted, "08:08");
});

test("extractSponsorFromMetadata extracts sponsor brand, domain, timestampRange, and quote", () => {
  const description = [
    "Google's Gemini 4 Argon is #1 on Zapier's AutomationBench.",
    "",
    "🤝 This video is sponsored by Zapier",
    "",
    "Chapters",
    "0:00 Intro",
    "1:38 Zapier Google AI Studio action",
    "3:54 Gemini 4 Argon builds and tests the Zapier workflow",
    "4:48 Agentically managed: the Zap fixes itself"
  ].join("\n");

  const { chapters, urls } = parseDescriptionMetadata(description, 488);
  const result = extractSponsorFromMetadata({
    videoUrl: "https://www.youtube.com/watch?v=tCd105_BsAo",
    title: "Gemini 4 Argon Finds YouTube Sponsors For $0.07",
    channelTitle: "Creator Magic",
    description,
    durationSeconds: 488,
    chapters,
    urls,
    transcript: []
  });

  assert.equal(result.hasSponsor, true);
  assert.equal(result.sponsorName, "Zapier");
  assert.equal(result.brandDomain, "zapier.com");
  assert.equal(result.timestampRange, "01:38 - 04:48");
  assert.ok(result.extractedQuote.includes("sponsored by Zapier"));
});

test("generateSponsorPitch produces a strict 3-sentence pitch or formats customPitch", async () => {
  const autoPitch = await generateSponsorPitch({
    sponsorName: "Zapier",
    sponsorDomain: "zapier.com",
    extractedQuote: "This video is sponsored by Zapier.",
    contactName: "Anja Simic",
    channelName: "Creator Magic"
  });
  assert.equal(autoPitch.sentenceCount, 3);
  assert.ok(autoPitch.fullPitch.includes("Hi Anja"));

  const custom = await generateSponsorPitch({
    sponsorName: "Zapier",
    customPitch: "Sentence one. Sentence two. Sentence three?"
  });
  assert.equal(custom.sentenceCount, 3);
  assert.equal(custom.sentence1, "Sentence one.");
});

test("searchYouTubeVideosByTopic validates topic and enriches search results with statistics and sponsor hints", async () => {
  await assert.rejects(
    () => searchYouTubeVideosByTopic(""),
    /Missing required 'topic' parameter/
  );

  const originalFetch = globalThis.fetch;
  const originalKey = process.env.YOUTUBE_API_KEY;
  if (!originalKey) process.env.YOUTUBE_API_KEY = "test-key"; // fetch is mocked below
  try {
    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("/youtube/v3/search")) {
        return {
          ok: true,
          json: async () => ({
            items: [
              { id: { videoId: "tCd105_BsAo" } },
              { id: { videoId: "abc12345678" } }
            ]
          })
        };
      }
      if (urlStr.includes("/youtube/v3/videos")) {
        return {
          ok: true,
          json: async () => ({
            items: [
              {
                id: "tCd105_BsAo",
                snippet: {
                  title: "Gemini 4 Argon Finds YouTube Sponsors For $0.07",
                  channelTitle: "Creator Magic",
                  publishedAt: "2026-10-16T10:34:17Z",
                  description: "🤝 This video is sponsored by Zapier\n\nChapters\n0:00 Intro\n1:38 Zapier action\n2:53 Next"
                },
                contentDetails: { duration: "PT8M8S" },
                statistics: { viewCount: "42500", likeCount: "1900" }
              },
              {
                id: "abc12345678",
                snippet: {
                  title: "Unsponsored Tutorial",
                  channelTitle: "Dev Channel",
                  publishedAt: "2026-10-18T12:00:00Z",
                  description: "Just a tutorial with no sponsor."
                },
                contentDetails: { duration: "PT5M0S" },
                statistics: { viewCount: "12000", likeCount: "500" }
              }
            ]
          })
        };
      }
      throw new Error(`Unexpected fetch URL: ${urlStr}`);
    };

    const res = await searchYouTubeVideosByTopic("Gemini 4 Argon", 2, "viewCount");
    assert.equal(res.topic, "Gemini 4 Argon");
    assert.equal(res.requestedCount, 2);
    assert.equal(res.order, "viewCount");
    assert.equal(res.totalReturned, 2);
    assert.equal(res.videos[0].videoId, "tCd105_BsAo");
    assert.equal(res.videos[0].viewCount, 42500);
    assert.equal(res.videos[0].hasSponsorHint, true);
    assert.equal(res.videos[0].sponsorName, "Zapier");
    assert.equal(res.videos[0].brandDomain, "zapier.com");
    assert.equal(res.videos[1].hasSponsorHint, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (!originalKey) delete process.env.YOUTUBE_API_KEY;
  }
});
