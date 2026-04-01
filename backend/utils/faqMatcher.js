// ============================================================
// utils/faqMatcher.js - FAQ Search & Matching Logic
// Reads FAQs from Supabase instead of a local JSON file.
// Results are cached in memory for 60 seconds to avoid hitting
// the database on every single chat message.
// ============================================================

const { supabase } = require("./supabase");

// Simple in-memory cache so we don't query Supabase on every message
let faqCache = [];
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

// ============================================================
// loadFAQs()
// Fetches FAQs from Supabase with 60-second caching.
// ============================================================
async function loadFAQs() {
  const now = Date.now();

  // Return cached FAQs if they're still fresh
  if (faqCache.length > 0 && now - cacheTimestamp < CACHE_TTL_MS) {
    return faqCache;
  }

  // Check Supabase credentials exist before querying
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.error("[FAQ] SUPABASE_URL or SUPABASE_ANON_KEY is missing in .env!");
    return [];
  }

  const { data, error } = await supabase
    .from("faqs")
    .select("*")
    .order("id", { ascending: true });

  if (error) {
    console.error("[FAQ] Supabase error loading FAQs:");
    console.error("  Code:", error.code);
    console.error("  Message:", error.message);
    console.error("  Details:", error.details);
    console.error("  Hint:", error.hint);
    console.error("  → Did you run supabase/setup.sql in your Supabase SQL Editor?");
    return faqCache.length > 0 ? faqCache : []; // stale cache or empty
  }

  if (!data || data.length === 0) {
    console.warn("[FAQ] No FAQs found in Supabase. Upload faqs.json via the Admin panel.");
    return [];
  }

  console.log(`[FAQ] Loaded ${data.length} FAQs from Supabase`);
  faqCache = data;
  cacheTimestamp = now;
  return faqCache;
}

// Force-invalidate the cache (called after FAQ upload/delete)
function invalidateFAQCache() {
  faqCache = [];
  cacheTimestamp = 0;
}

// ============================================================
// matchFAQ(userMessage) - Main matching function
// How it works:
//   1. Normalize the user query (lowercase, strip punctuation)
//   2. For each FAQ, count how many keywords appear in the query
//   3. Return the FAQ with the highest match score
//   4. Require at least 1 keyword match (threshold = 1)
// ============================================================
async function matchFAQ(userMessage) {
  const faqs = await loadFAQs();
  const normalized = userMessage.toLowerCase().replace(/[^\w\s]/g, "");

  let bestMatch = null;
  let bestScore = 0;

  for (const faq of faqs) {
    let score = 0;
    const keywords = Array.isArray(faq.keywords) ? faq.keywords : [];

    // Count matching keywords in the user message
    for (const keyword of keywords) {
      if (normalized.includes(keyword.toLowerCase())) {
        score++;
      }
    }

    // Partial credit for question word matches
    const questionWords = faq.question.toLowerCase().split(" ");
    for (const word of questionWords) {
      if (word.length > 3 && normalized.includes(word)) {
        score += 0.5;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = faq;
    }
  }

  return bestScore >= 1 ? bestMatch : null;
}

// Return all FAQs (used for quick-reply buttons on the frontend)
async function getAllFAQs() {
  return loadFAQs();
}

module.exports = { matchFAQ, getAllFAQs, loadFAQs, invalidateFAQCache };