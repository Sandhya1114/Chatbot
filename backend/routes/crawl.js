// ============================================================
// routes/crawl.js — Website FAQ Crawler  (v2.0.0)
//
// POST /api/admin/crawl
//   Body: { url, mode? }
//   → Crawls the given URL, extracts FAQ-like content,
//     saves to Supabase, returns extracted FAQs
//
// POST /api/admin/crawl/preview
//   Body: { url }
//   → Same crawl but ONLY returns preview — does NOT save.
//     Used by the frontend "Preview" step before confirming,
//     AND by chatbot.js auto-crawl engine.
//
// POST /api/admin/crawl/save
//   Body: { faqs, mode }
//   → Saves already-extracted FAQs (from preview) to Supabase.
//
// POST /api/admin/crawl/links
//   Body: { url }
//   → Fetches a homepage and returns all internal links found.
//     Used by the frontend "Deep Crawl" flow AND auto-crawl deepLinks.
//
// POST /api/admin/crawl/auto
//   Body: { urls?, mode?, saveToDb?, appId? }
//   → NEW: Called by chatbot.js autoCrawl engine.
//     Crawls one or more URLs, deduplicates FAQs, and optionally
//     saves to Supabase. Returns { faqs, saved, total }.
//     Rate-limited to prevent abuse from embedded widgets.
// ============================================================

const express = require("express");
const router = express.Router();

// ============================================================
// Lazy-load dependencies so the rest of the app still boots
// even if these are not installed yet.
// Install with: npm install axios cheerio
// ============================================================
function requireDep(name) {
  try {
    return require(name);
  } catch {
    throw new Error(
      `"${name}" is not installed. Run: npm install axios cheerio`
    );
  }
}

const { supabase } = require("../utils/supabase");
const { invalidateFAQCache } = require("../utils/faqMatcher");

// ============================================================
// Rate-limiting for /auto endpoint
// Prevents embedded widgets on high-traffic sites from
// hammering the crawler on every page load.
//
// Simple in-memory store: { ip+appId -> { count, windowStart } }
// In production, replace with Redis-backed rate limiting.
// ============================================================
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX_CALLS = 10;              // max 10 auto-crawls per hour per appId+IP

function checkRateLimit(ip, appId) {
  const key = `${ip}:${appId}`;
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: RATE_LIMIT_MAX_CALLS - 1 };
  }

  if (entry.count >= RATE_LIMIT_MAX_CALLS) {
    const resetIn = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - entry.windowStart)) / 60000);
    return { allowed: false, remaining: 0, resetInMinutes: resetIn };
  }

  entry.count += 1;
  return { allowed: true, remaining: RATE_LIMIT_MAX_CALLS - entry.count };
}

// Periodically clear expired rate limit entries to avoid memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      rateLimitStore.delete(key);
    }
  }
}, RATE_LIMIT_WINDOW_MS);


// ============================================================
// Crawl helpers
// ============================================================

/**
 * Fetch raw HTML from a URL with a browser-like User-Agent.
 * Follows up to 3 redirects, 10 s timeout.
 */
async function fetchHTML(url) {
  const axios = requireDep("axios");

  const response = await axios.get(url, {
    timeout: 10000,
    maxRedirects: 3,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; FAQBot/1.0; +https://your-domain.com)",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    validateStatus: () => true,
  });

  if (response.status >= 400) {
    throw new Error(
      `Server returned ${response.status} for ${url}. The page may require login or block bots.`
    );
  }

  return response.data;
}

/**
 * Normalise and deduplicate text.
 */
function clean(text = "") {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Generate keywords from a question string.
 */
const STOP = new Set([
  "what", "when", "where", "which", "who", "whom", "whose", "why", "how",
  "does", "have", "will", "your", "from", "that", "this", "with", "they",
  "their", "there", "been", "were", "would", "could", "should", "about",
  "into", "than", "then", "just", "also", "more", "some", "such", "like",
]);

function extractKeywords(question) {
  return question
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w))
    .slice(0, 8);
}

// ============================================================
// extractFAQs(html, sourceUrl)
//
// Tries multiple extraction strategies in order of confidence.
// Returns Array<{ question, answer, keywords }>
// ============================================================
function extractFAQs(html, sourceUrl) {
  const cheerio = requireDep("cheerio");
  const $ = cheerio.load(html);

  $(
    "script, style, noscript, nav, footer, header, " +
    ".cookie-banner, .chat-widget, .newsletter, " +
    "[aria-hidden='true'], .sr-only"
  ).remove();

  const faqs = [];
  const seen = new Set();

  function addFAQ(question, answer) {
    const q = clean(question);
    const a = clean(answer);
    if (!q || !a || q.length < 10 || a.length < 10) return;
    if (q.length > 300 || a.length > 2000) return;
    const key = q.toLowerCase().slice(0, 80);
    if (seen.has(key)) return;
    seen.add(key);
    faqs.push({ question: q, answer: a, keywords: extractKeywords(q) });
  }

  // ── Strategy 1: Schema.org FAQPage JSON-LD ──────────────────
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).html();
      const json = JSON.parse(raw);
      const pages = [];

      if (Array.isArray(json["@graph"])) pages.push(...json["@graph"]);
      else pages.push(json);

      for (const page of pages) {
        if (page["@type"] === "FAQPage" && Array.isArray(page.mainEntity)) {
          for (const item of page.mainEntity) {
            const q = item.name || item.question || "";
            const a =
              item.acceptedAnswer?.text ||
              item.acceptedAnswer?.["@value"] ||
              item.answer?.text ||
              "";
            addFAQ(q, a);
          }
        }

        if (page["@type"] === "HowTo" && Array.isArray(page.step)) {
          for (const step of page.step) {
            addFAQ(step.name || "", step.text || "");
          }
        }
      }
    } catch {
      // Malformed JSON-LD — skip silently
    }
  });

  if (faqs.length >= 3) return faqs;

  // ── Strategy 2: Semantic details/summary ────────────────────
  $("details").each((_, el) => {
    const summary = $(el).find("summary").first();
    const question = summary.text();
    summary.remove();
    const answer = $(el).text();
    addFAQ(question, answer);
  });

  if (faqs.length >= 3) return faqs;

  // ── Strategy 3: data-faq / aria-label patterns ──────────────
  $("[data-faq], [data-accordion], [data-qa]").each((_, el) => {
    const $el = $(el);
    const qEl =
      $el.find("[data-question], .faq-question, .accordion-title, .faq__question").first();
    const aEl =
      $el.find("[data-answer], .faq-answer, .accordion-content, .faq__answer").first();
    if (qEl.length && aEl.length) {
      addFAQ(qEl.text(), aEl.text());
    }
  });

  if (faqs.length >= 3) return faqs;

  // ── Strategy 4: Heading + next sibling paragraph ────────────
  const headingSelectors = [
    "h2", "h3", "h4",
    ".faq-question", ".question", "[class*='faq'] h3",
    "[class*='faq'] h4", "[class*='question']",
  ];

  $(headingSelectors.join(", ")).each((_, el) => {
    const $h = $(el);
    const question = $h.text();

    if (!question.includes("?") && question.split(" ").length < 4) return;

    let answer = "";
    let $next = $h.next();
    let safety = 0;
    while ($next.length && !$next.is("h1,h2,h3,h4,h5,h6") && safety++ < 5) {
      answer += " " + $next.text();
      $next = $next.next();
    }

    addFAQ(question, answer);
  });

  if (faqs.length >= 3) return faqs;

  // ── Strategy 5: dl/dt/dd ────────────────────────────────────
  $("dl").each((_, dl) => {
    const $dl = $(dl);
    const dts = $dl.find("dt");
    const dds = $dl.find("dd");
    dts.each((i, dt) => {
      addFAQ($(dt).text(), $(dds.get(i)).text());
    });
  });

  if (faqs.length >= 3) return faqs;

  // ── Strategy 6: Generic paragraph pairs ─────────────────────
  const QUESTION_STARTERS = /^(what|how|why|when|where|who|can|do|is|are|will|should|does)\b/i;

  $("p, li").each((_, el) => {
    const text = clean($(el).text());
    if (text.length < 15) return;

    if (QUESTION_STARTERS.test(text) || text.endsWith("?")) {
      const $next = $(el).next();
      if ($next.length) {
        const answer = clean($next.text());
        if (answer.length > 20 && !answer.endsWith("?")) {
          addFAQ(text, answer);
        }
      }
    }
  });

  return faqs;
}

// ============================================================
// saveFAQsToSupabase(faqs, mode)
//
// mode: "append" (default) or "replace"
// Returns { added, total }
// ============================================================
async function saveFAQsToSupabase(faqs, mode = "append") {
  if (mode === "replace") {
    const { error: delErr } = await supabase
      .from("faqs")
      .delete()
      .neq("id", 0);
    if (delErr) throw new Error("Failed to clear existing FAQs: " + delErr.message);

    const rows = faqs.map((faq, idx) => ({
      id: idx + 1,
      question: faq.question,
      answer: faq.answer,
      keywords: faq.keywords,
    }));

    const { error: insErr } = await supabase.from("faqs").insert(rows);
    if (insErr) throw new Error("Failed to insert FAQs: " + insErr.message);

    invalidateFAQCache();
    return { added: rows.length, total: rows.length };
  }

  // ── Append mode ──────────────────────────────────────────────
  const { data: existing, error: fetchErr } = await supabase
    .from("faqs")
    .select("id")
    .order("id", { ascending: false })
    .limit(1);

  if (fetchErr) throw new Error("Failed to read existing FAQs: " + fetchErr.message);

  let nextId = existing && existing.length > 0 ? existing[0].id + 1 : 1;

  const rows = faqs.map((faq) => ({
    id: nextId++,
    question: faq.question,
    answer: faq.answer,
    keywords: faq.keywords,
  }));

  const { error: insErr } = await supabase.from("faqs").insert(rows);
  if (insErr) throw new Error("Failed to insert FAQs: " + insErr.message);

  invalidateFAQCache();

  const { count } = await supabase
    .from("faqs")
    .select("id", { count: "exact", head: true });

  return { added: rows.length, total: count ?? rows.length };
}

// ============================================================
// POST /api/admin/crawl/auto  ← NEW
//
// Called by chatbot.js embed library's auto-crawl engine.
// Rate-limited to prevent abuse from high-traffic embeds.
//
// Body: {
//   urls?:      string[]  — URLs to crawl (defaults to Referer header)
//   mode?:      string    — "append" | "replace" (default: "append")
//   saveToDb?:  boolean   — persist to Supabase? (default: true)
//   appId?:     string    — for rate-limit keying
// }
//
// Response: {
//   success: true,
//   faqs:    Array<FAQ>,
//   saved:   boolean,
//   added:   number,
//   total:   number,
//   message: string
// }
// ============================================================
router.post("/auto", async (req, res) => {
  const {
    urls,
    mode = "append",
    saveToDb = true,
    appId = "default",
  } = req.body;

  // ── Rate limit check ───────────────────────────────────────
  const clientIp =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown";

  const rateCheck = checkRateLimit(clientIp, appId);
  if (!rateCheck.allowed) {
    console.warn(`[AutoCrawl] Rate limited: ${clientIp} / ${appId}`);
    return res.status(429).json({
      error: `Auto-crawl rate limit reached. Try again in ${rateCheck.resetInMinutes} minutes.`,
      resetInMinutes: rateCheck.resetInMinutes,
    });
  }

  // ── Determine URLs to crawl ────────────────────────────────
  let urlsToScrape = [];

  if (Array.isArray(urls) && urls.length > 0) {
    urlsToScrape = urls.slice(0, 20); // hard cap at 20 URLs per call
  } else {
    // Fall back to Referer header (the page the widget is embedded on)
    const referer = req.headers.referer || req.headers.referrer;
    if (referer) {
      urlsToScrape = [referer];
    }
  }

  if (urlsToScrape.length === 0) {
    return res.status(400).json({
      error: "No URLs provided and no Referer header found. Pass urls[] in request body.",
    });
  }

  // ── Validate each URL ──────────────────────────────────────
  const validUrls = [];
  for (const raw of urlsToScrape) {
    try {
      const parsed = new URL(raw.startsWith("http") ? raw : "https://" + raw);
      if (["http:", "https:"].includes(parsed.protocol)) {
        validUrls.push(parsed.href);
      }
    } catch {
      // Skip malformed
    }
  }

  if (validUrls.length === 0) {
    return res.status(400).json({ error: "No valid URLs found after filtering." });
  }

  console.log(`[AutoCrawl] appId="${appId}" crawling ${validUrls.length} URL(s): ${validUrls.join(", ")}`);

  // ── Crawl each URL ─────────────────────────────────────────
  const allFAQs = [];
  const seenQuestions = new Set();
  const errors = [];

  for (const url of validUrls) {
    try {
      const html = await fetchHTML(url);
      const pageFAQs = extractFAQs(html, url);

      for (const faq of pageFAQs) {
        const key = faq.question.toLowerCase().slice(0, 80);
        if (!seenQuestions.has(key)) {
          seenQuestions.add(key);
          allFAQs.push(faq);
        }
      }

      console.log(`[AutoCrawl] ${url} → ${pageFAQs.length} FAQs`);
    } catch (err) {
      console.warn(`[AutoCrawl] Failed to crawl ${url}: ${err.message}`);
      errors.push({ url, error: err.message });
    }

    // Polite delay between requests
    await new Promise(r => setTimeout(r, 300));
  }

  if (allFAQs.length === 0) {
    return res.json({
      success: true,
      faqs: [],
      saved: false,
      added: 0,
      total: 0,
      errors,
      message: "No FAQ content found on the provided page(s).",
    });
  }

  // ── Save or return ─────────────────────────────────────────
  if (saveToDb) {
    try {
      const result = await saveFAQsToSupabase(allFAQs, mode);
      console.log(`[AutoCrawl] Saved ${result.added} FAQs (total: ${result.total})`);

      return res.json({
        success: true,
        faqs: allFAQs,
        saved: true,
        added: result.added,
        total: result.total,
        errors,
        message: `Auto-crawl complete. Saved ${result.added} FAQs to database.`,
        rateLimit: { remaining: rateCheck.remaining },
      });
    } catch (err) {
      console.error("[AutoCrawl] Save error:", err.message);
      // Return FAQs anyway so client can use them session-only
      return res.status(207).json({
        success: false,
        faqs: allFAQs,
        saved: false,
        added: 0,
        total: allFAQs.length,
        errors: [...errors, { url: "database", error: err.message }],
        message: `Extracted ${allFAQs.length} FAQs but failed to save: ${err.message}`,
      });
    }
  } else {
    // Session-only: just return FAQs, don't save
    return res.json({
      success: true,
      faqs: allFAQs,
      saved: false,
      added: 0,
      total: allFAQs.length,
      errors,
      message: `Auto-crawl complete. Extracted ${allFAQs.length} FAQs (session-only, not saved).`,
      rateLimit: { remaining: rateCheck.remaining },
    });
  }
});

// ============================================================
// POST /api/admin/crawl/links
// Fetches a homepage and returns all internal links found.
// Body: { url }
// Returns: { links: [{ href, text, path }] }
// ============================================================
router.post("/links", async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "url is required." });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url.startsWith("http") ? url : "https://" + url);
  } catch {
    return res.status(400).json({ error: "Invalid URL format." });
  }

  try {
    const cheerio = requireDep("cheerio");
    console.log(`[Crawler] Extracting links from: ${parsedUrl.href}`);
    const html = await fetchHTML(parsedUrl.href);
    const $ = cheerio.load(html);

    const origin = parsedUrl.origin;
    const seen = new Set();
    const links = [];

    $("a[href]").each((_, el) => {
      const raw = $(el).attr("href") || "";
      let resolved;
      try {
        resolved = new URL(raw, parsedUrl.href);
      } catch {
        return;
      }

      if (resolved.origin !== origin) return;
      if (!["http:", "https:"].includes(resolved.protocol)) return;

      resolved.hash = "";
      const key = resolved.href.replace(/\/$/, "");
      if (seen.has(key)) return;
      seen.add(key);

      const text = clean($(el).text()) || resolved.pathname;
      links.push({
        href: resolved.href,
        text: text.slice(0, 80),
        path: resolved.pathname,
      });
    });

    const PRIORITY = /faq|help|support|question|knowledge|info/i;
    links.sort((a, b) => {
      const pa = PRIORITY.test(a.path) ? 0 : 1;
      const pb = PRIORITY.test(b.path) ? 0 : 1;
      return pa - pb || a.path.localeCompare(b.path);
    });

    console.log(`[Crawler] Found ${links.length} internal links on ${parsedUrl.href}`);
    return res.json({ success: true, url: parsedUrl.href, links, total: links.length });
  } catch (err) {
    console.error("[Crawler] Links error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/admin/crawl/preview
// Crawls URL and returns extracted FAQs WITHOUT saving.
// ============================================================
router.post("/preview", async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "url is required." });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url.startsWith("http") ? url : "https://" + url);
  } catch {
    return res.status(400).json({ error: "Invalid URL format." });
  }

  try {
    console.log(`[Crawler] Previewing: ${parsedUrl.href}`);
    const html = await fetchHTML(parsedUrl.href);
    const faqs = extractFAQs(html, parsedUrl.href);

    if (faqs.length === 0) {
      return res.status(422).json({
        error:
          "No FAQ content found on this page. Try linking directly to a /faq or /help page.",
      });
    }

    console.log(`[Crawler] Extracted ${faqs.length} FAQs from ${parsedUrl.href}`);

    return res.json({
      success: true,
      url: parsedUrl.href,
      faqs,
      total: faqs.length,
    });
  } catch (err) {
    console.error("[Crawler] Preview error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/admin/crawl/save
// Saves a batch of already-extracted FAQs (from preview step).
// Body: { faqs: [...], mode: "append"|"replace" }
// ============================================================
router.post("/save", async (req, res) => {
  const { faqs, mode = "append" } = req.body;

  if (!Array.isArray(faqs) || faqs.length === 0) {
    return res.status(400).json({ error: "faqs array is required." });
  }

  for (let i = 0; i < faqs.length; i++) {
    if (!faqs[i].question || !faqs[i].answer) {
      return res.status(400).json({
        error: `FAQ at index ${i} is missing question or answer.`,
      });
    }
    if (!Array.isArray(faqs[i].keywords)) {
      faqs[i].keywords = extractKeywords(faqs[i].question);
    }
  }

  try {
    const result = await saveFAQsToSupabase(faqs, mode);

    return res.json({
      success: true,
      mode,
      message: `Successfully saved ${result.added} FAQs. Total in database: ${result.total}`,
      added: result.added,
      total: result.total,
    });
  } catch (err) {
    console.error("[Crawler] Save error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;