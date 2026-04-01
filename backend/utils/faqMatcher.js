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
]);

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
function scoreFAQ(faq, queryTokens, normalizedQuery) {
  let score = 0;

  // --- Keyword matching ---
  const keywords = Array.isArray(faq.keywords) ? faq.keywords : [];
  for (const keyword of keywords) {
    const kw = keyword.toLowerCase();
    if (normalizedQuery.includes(kw)) {
      score += 3.0; // exact keyword hit
    } else {
      // partial — any query token is contained in the keyword or vice versa
      for (const token of queryTokens) {
        if (kw.includes(token) || token.includes(kw)) {
          score += 1.0;
          break;
        }
      }
    }
  }

  // --- Question-word matching ---
  const qTokens = tokenize(faq.question);
  for (const qWord of qTokens) {
    if (qWord.length <= 3) continue;
    if (queryTokens.includes(qWord)) {
      score += 1.5;
    } else {
      for (const token of queryTokens) {
        if (qWord.includes(token) || token.includes(qWord)) {
          score += 0.5;
          break;
        }
      }
    }
  }

  // --- Phrase proximity bonus ---
  // If the question contains a sequence of 3+ words that appear in the query
  const qWords = faq.question.toLowerCase().split(/\s+/);
  for (let i = 0; i <= qWords.length - 3; i++) {
    const phrase = qWords.slice(i, i + 3).join(" ").replace(/[^\w\s]/g, "");
    if (normalizedQuery.includes(phrase)) {
      score += 2.0;
    }
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
async function matchFAQ(userMessage) {
  const faqs = await loadFAQs();
  if (faqs.length === 0) return { match: null, suggestions: [] };

  const normalizedQuery = userMessage.toLowerCase().replace(/[^\w\s]/g, " ");
  const queryTokens = tokenize(userMessage);

  // Score every FAQ
  const scored = faqs.map((faq) => ({
    faq,
    score: scoreFAQ(faq, queryTokens, normalizedQuery),
  }));

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  const MATCH_THRESHOLD = 2.0;
  const topMatch = scored[0];
  const match = topMatch.score >= MATCH_THRESHOLD ? topMatch.faq : null;

  // Suggestions: next best FAQs that have at least a tiny relevance score,
  // or if there's no match at all, return the top 3 from any score.
  const MIN_SUGGESTION_SCORE = match ? 0.5 : 0;
  const suggestions = scored
    .filter((s) => s.faq !== match && s.score > MIN_SUGGESTION_SCORE)
    .slice(0, 3)
    .map((s) => s.faq);

  // If we have no suggestions from relevance, fall back to top 3 overall
  // (so there's always something to show)
  if (suggestions.length === 0) {
    const fallback = scored
      .filter((s) => s.faq !== match)
      .slice(0, 3)
      .map((s) => s.faq);
    return { match, suggestions: fallback };
  }

  return { match, suggestions };
}

// Return all FAQs (used for initial quick-reply buttons on open)
async function getAllFAQs() {
  return loadFAQs();
}

module.exports = { matchFAQ, getAllFAQs, loadFAQs, invalidateFAQCache };