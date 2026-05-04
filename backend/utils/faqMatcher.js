// ============================================================
// utils/faqMatcher.js - FAQ Search & RAG-Style Matching
//
// How the RAG pipeline works:
//   1. Fetch FAQ knowledge base from Supabase (cached 60s)
//   2. For every user message, score ALL FAQs using:
//      - Keyword overlap (exact + partial)
//      - Question word overlap (tf-idf-like weight by word rarity)
//      - Phrase proximity bonus
//   3. Return the BEST match (if score >= threshold) for the answer
//   4. Also return TOP N related FAQs as "suggestions" — these are
//      shown as contextual quick-replies AFTER every bot reply,
//      replacing the generic initial buttons.
// ============================================================

const { supabase } = require("./supabase");

let faqCache = [];
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60 * 1000;

// Stop-words to ignore during scoring (too common to be meaningful)
const STOP_WORDS = new Set([
  "the","a","an","is","are","was","were","be","been","being",
  "have","has","had","do","does","did","will","would","could","should",
  "may","might","can","to","of","in","on","at","by","for","with",
  "about","from","into","that","this","these","those","i","my","me",
  "your","you","we","our","they","their","it","its","and","or","but",
  "not","no","so","if","then","how","what","when","where","why","who",
  "html","htm","php","aspx","jsp",
]);

function normalizeOrigin(rawUrl) {
  try {
    return new URL(String(rawUrl || "").trim()).origin.toLowerCase();
  } catch {
    return "";
  }
}

function extractSourceUrl(answer) {
  const match = String(answer || "").match(/Source URL:\s*(https?:\/\/\S+)/i);
  return match?.[1]?.trim() || "";
}

function extractPathTokens(pageUrl) {
  try {
    const parsed = new URL(String(pageUrl || "").trim());
    const path = parsed.pathname === "/" ? "home" : parsed.pathname;
    return tokenize(path.replace(/[-_/]+/g, " "));
  } catch {
    return [];
  }
}

function isGenericCrawlerQuestion(question) {
  const normalized = String(question || "").trim().toLowerCase();
  return (
    normalized.startsWith("what information is available on the ") ||
    normalized.startsWith("what other information is available on the ") ||
    normalized.startsWith("what is ") && normalized.endsWith(" about?")
  );
}

function isLowSignalFaq(faq) {
  const question = String(faq?.question || "").toLowerCase();
  const answer = String(faq?.answer || "").toLowerCase();
  return (
    /what does "?(0 pieces|loading products?|page \d+ of \d+)"?/i.test(question) ||
    /loading products?/i.test(answer)
  );
}

function isSectionExplainQuestion(question) {
  return /^what does "/i.test(String(question || "").trim());
}

function extractRouteHintsFromQuery(normalizedQuery) {
  const hints = [];
  const routeKeywords = [
    "home", "shop", "about", "faq", "contact", "blog", "men", "women",
    "kids", "accessories", "account", "returns", "privacy", "terms", "size"
  ];

  for (const token of routeKeywords) {
    if (normalizedQuery.includes(token)) {
      hints.push(token);
    }
  }

  if (normalizedQuery.includes("home page")) {
    hints.push("home page");
  }

  return hints;
}

function filterFAQsForSite(faqs, siteOrigin) {
  if (!siteOrigin) return faqs;

  const scoped = [];
  const global = [];

  for (const faq of faqs) {
    const sourceOrigin = normalizeOrigin(extractSourceUrl(faq.answer));
    if (sourceOrigin && sourceOrigin === siteOrigin) {
      scoped.push(faq);
    } else if (!sourceOrigin) {
      global.push(faq);
    }
  }

  const pool = scoped.length > 0 ? scoped.concat(global) : faqs;
  return pool.filter((faq) => !isLowSignalFaq(faq));
}

function scorePageContext(faq, pageUrl, queryHints) {
  if (!pageUrl) return 0;

  let bonus = 0;
  const pageTokens = extractPathTokens(pageUrl);
  const faqText = [
    faq.question || "",
    Array.isArray(faq.keywords) ? faq.keywords.join(" ") : "",
    extractSourceUrl(faq.answer),
  ].join(" ").toLowerCase();

  for (const token of pageTokens) {
    if (token && faqText.includes(token)) {
      bonus += 0.6;
    }
  }

  try {
    const faqSource = extractSourceUrl(faq.answer);
    if (faqSource) {
      const sourcePath = new URL(faqSource).pathname.replace(/\/+$/, "") || "/";
      const currentPath = new URL(pageUrl).pathname.replace(/\/+$/, "") || "/";
      if (sourcePath === currentPath) {
        bonus += 2.2;
      }
    }
  } catch {
    // Ignore URL parsing issues for context scoring.
  }

  if (!isGenericCrawlerQuestion(faq.question)) {
    bonus += 0.35;
  }

  if (Array.isArray(queryHints) && queryHints.length > 0) {
    const sourceUrl = extractSourceUrl(faq.answer);
    const combined = [
      faq.question || "",
      Array.isArray(faq.keywords) ? faq.keywords.join(" ") : "",
      sourceUrl,
    ].join(" ").toLowerCase();

    for (const hint of queryHints) {
      if (hint === "home page") {
        try {
          if (sourceUrl && (new URL(sourceUrl).pathname === "/" || new URL(sourceUrl).pathname === "")) {
            bonus += 3;
            continue;
          }
        } catch {
          // Ignore invalid source URLs.
        }
      }

      if (combined.includes(hint)) {
        bonus += 1.8;
      }
    }
  }

  return bonus;
}

function rankFAQsForContext(faqs, pageUrl) {
  return [...faqs].sort((a, b) => {
    const sectionDelta = Number(isSectionExplainQuestion(a.question)) - Number(isSectionExplainQuestion(b.question));
    if (sectionDelta !== 0) return sectionDelta;

    const genericDelta = Number(isGenericCrawlerQuestion(a.question)) - Number(isGenericCrawlerQuestion(b.question));
    if (genericDelta !== 0) return genericDelta;

    const contextDelta = scorePageContext(b, pageUrl) - scorePageContext(a, pageUrl);
    if (contextDelta !== 0) return contextDelta;

    return Number(a.id || 0) - Number(b.id || 0);
  });
}

function dedupeFaqsByQuestion(faqs) {
  const seen = new Set();
  return faqs.filter((faq) => {
    const key = String(faq?.question || "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ============================================================
// loadFAQs() — Fetch from Supabase with 60s in-memory cache
// ============================================================
async function loadFAQs() {
  const now = Date.now();
  if (faqCache.length > 0 && now - cacheTimestamp < CACHE_TTL_MS) {
    return faqCache;
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.error("[FAQ] SUPABASE_URL or SUPABASE_ANON_KEY is missing in .env!");
    return [];
  }

  const { data, error } = await supabase
    .from("faqs")
    .select("*")
    .order("id", { ascending: true });

  if (error) {
    console.error("[FAQ] Supabase error:", error.message);
    return faqCache.length > 0 ? faqCache : [];
  }

  if (!data || data.length === 0) {
    console.warn("[FAQ] No FAQs found in Supabase.");
    return [];
  }

  console.log(`[FAQ] Loaded ${data.length} FAQs from Supabase`);
  faqCache = data;
  cacheTimestamp = now;
  return faqCache;
}

function invalidateFAQCache() {
  faqCache = [];
  cacheTimestamp = 0;
}

// ============================================================
// tokenize(text) — lowercase, strip punctuation, remove stop-words
// ============================================================
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function scoreTokenOverlap(tokens, queryTokens, exactWeight, partialWeight) {
  let score = 0;
  for (const token of tokens) {
    if (queryTokens.includes(token)) {
      score += exactWeight;
      continue;
    }

    for (const queryToken of queryTokens) {
      if (token.includes(queryToken) || queryToken.includes(token)) {
        score += partialWeight;
        break;
      }
    }
  }
  return score;
}

function scorePhraseMatches(text, normalizedQuery, phraseLength, weight) {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  let score = 0;

  for (let i = 0; i <= words.length - phraseLength; i++) {
    const phrase = words
      .slice(i, i + phraseLength)
      .join(" ")
      .replace(/[^\w\s]/g, "")
      .trim();

    if (phrase && normalizedQuery.includes(phrase)) {
      score += weight;
    }
  }

  return score;
}

// ============================================================
// scoreFAQ(faq, queryTokens, normalizedQuery)
//
// Returns a numeric relevance score.
// Higher = more relevant.
//
// Scoring breakdown:
//   +3.0  per keyword EXACT match
//   +1.0  per keyword PARTIAL match (keyword contains query token)
//   +1.5  per question-word EXACT match (if word > 4 chars)
//   +0.5  per question-word PARTIAL match
//   +2.0  bonus if the raw query contains a 3+ word phrase from the question
// ============================================================
function scoreFAQ(faq, queryTokens, normalizedQuery, pageUrl, queryHints) {
  let score = 0;

  // --- Keyword matching ---
  const keywords = Array.isArray(faq.keywords) ? faq.keywords : [];
  for (const keyword of keywords.map((keyword) => keyword.toLowerCase())) {
    if (normalizedQuery.includes(keyword)) {
      score += 3.0;
      continue;
    }

    for (const token of queryTokens) {
      if (keyword.includes(token) || token.includes(keyword)) {
        score += 1.0;
        break;
      }
    }
  }

  // --- Question-word matching ---
  const qTokens = tokenize(faq.question);
  score += scoreTokenOverlap(qTokens, queryTokens, 1.5, 0.5);

  // --- Answer-body matching ---
  // This lets route-level scraped content match even when the user's wording
  // appears in the stored answer more than in the generated FAQ question.
  const answerTokens = tokenize(String(faq.answer || "")).slice(0, 250);
  score += scoreTokenOverlap(answerTokens, queryTokens, 0.7, 0.2);

  // --- Phrase proximity bonus ---
  score += scorePhraseMatches(faq.question, normalizedQuery, 3, 2.0);
  score += scorePhraseMatches(String(faq.answer || "").slice(0, 400), normalizedQuery, 3, 0.8);
  score += scorePageContext(faq, pageUrl, queryHints);

  if (!isGenericCrawlerQuestion(faq.question)) {
    score += 0.15;
  }

  return score;
}

// ============================================================
// matchFAQ(userMessage)
//
// Returns: { match: faq|null, suggestions: faq[] }
//   match       — the best FAQ answer (score >= 2.0 threshold)
//   suggestions — top 3 related FAQs (excluding the match),
//                 to show as contextual quick-replies after reply
// ============================================================
async function matchFAQ(userMessage, options = {}) {
  const faqs = filterFAQsForSite(await loadFAQs(), normalizeOrigin(options.siteOrigin));
  if (faqs.length === 0) return { match: null, suggestions: [] };

  const normalizedQuery = userMessage.toLowerCase().replace(/[^\w\s]/g, " ");
  const queryTokens = tokenize(userMessage);
  const pageUrl = String(options.pageUrl || "");
  const queryHints = extractRouteHintsFromQuery(normalizedQuery);

  // Score every FAQ
  const scored = faqs.map((faq) => ({
    faq,
    score: scoreFAQ(faq, queryTokens, normalizedQuery, pageUrl, queryHints),
  }));

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  const MATCH_THRESHOLD = 2.0;
  const topMatch = scored[0] || { faq: null, score: 0 };
  const match = topMatch.score >= MATCH_THRESHOLD ? topMatch.faq : null;

  // Suggestions: next best FAQs that have at least a tiny relevance score,
  // or if there's no match at all, return the top 3 from any score.
  const MIN_SUGGESTION_SCORE = match ? 0.5 : 0;
  const matchQuestionKey = String(match?.question || "").trim().toLowerCase();
  const suggestions = scored
    .filter((s) => s.faq !== match && String(s.faq?.question || "").trim().toLowerCase() !== matchQuestionKey && s.score > MIN_SUGGESTION_SCORE)
    .slice(0, 3)
    .map((s) => s.faq);

  // If we have no suggestions from relevance, fall back to top 3 overall
  // (so there's always something to show)
  if (suggestions.length === 0) {
    const fallback = scored
      .filter((s) => s.faq !== match && String(s.faq?.question || "").trim().toLowerCase() !== matchQuestionKey)
      .slice(0, 3)
      .map((s) => s.faq);
    return { match, suggestions: dedupeFaqsByQuestion(rankFAQsForContext(fallback, pageUrl)) };
  }

  return { match, suggestions: dedupeFaqsByQuestion(rankFAQsForContext(suggestions, pageUrl)) };
}

// Return all FAQs (used for initial quick-reply buttons on open)
async function getAllFAQs(options = {}) {
  const faqs = filterFAQsForSite(await loadFAQs(), normalizeOrigin(options.siteOrigin));
  return dedupeFaqsByQuestion(rankFAQsForContext(faqs, String(options.pageUrl || "")));
}

module.exports = { matchFAQ, getAllFAQs, loadFAQs, invalidateFAQCache };
