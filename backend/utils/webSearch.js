// ============================================================
// utils/webSearch.js — Live Web Search via Tavily API
//
// Used by routes/chat.js to fetch real-time data before
// calling Groq, so the AI can answer questions about current
// products, prices, events, and specs accurately.
//
// Tavily free tier: 1,000 searches/month
// Sign up at: https://app.tavily.com
// Set TAVILY_API_KEY in your .env file.
// ============================================================

const TAVILY_API_URL = "https://api.tavily.com/search";

// ── Keywords that signal a query needs live data ─────────────
// If a user message contains any of these, we search before
// calling the AI. This avoids wasting search quota on questions
// the model can answer from training data (e.g. "how do I reset
// my password?").
const LIVE_DATA_TRIGGERS = [
    // Products & specs
    "latest", "newest", "new", "current", "recent", "just released",
    "specs", "specifications", "features", "price", "cost", "how much",
    "release date", "launch", "announced", "available",
    // Brands & product lines commonly asked about
    "iphone", "samsung", "pixel", "galaxy", "macbook", "ipad",
    "windows", "android", "ios", "playstation", "xbox", "nvidia",
    "amd", "intel", "tesla", "openai", "chatgpt", "gemini",
    // Temporal signals
    "2024", "2025", "2026", "this year", "today", "now",
    "compare", "vs", "versus", "better than", "difference between",
    // News & events
    "news", "update", "changelog", "version", "review",
];

/**
 * Returns true if the query likely needs live web data.
 * Case-insensitive partial match against LIVE_DATA_TRIGGERS.
 *
 * @param {string} query
 * @returns {boolean}
 */
function needsWebSearch(query) {
    if (!query || typeof query !== "string") return false;
    const lower = query.toLowerCase();
    return LIVE_DATA_TRIGGERS.some((trigger) => lower.includes(trigger));
}

/**
 * Searches the web via Tavily and returns a concise context string
 * ready to be injected into the AI system prompt.
 *
 * Returns null if:
 *   - TAVILY_API_KEY is not set
 *   - The search fails for any reason (graceful degradation)
 *
 * @param {string} query   The user's message (used as the search query)
 * @param {object} options
 * @param {number} options.maxResults  Max results to include (default: 5)
 * @param {number} options.maxAge      Max result age in days (default: 30)
 * @returns {Promise<string|null>}
 */
async function searchWeb(query, options = {}) {
    const apiKey = process.env.TAVILY_API_KEY;

    if (!apiKey || apiKey === "tvly-YOUR_KEY_HERE") {
        console.warn("[WebSearch] TAVILY_API_KEY not set — skipping live search.");
        return null;
    }

    const { maxResults = 5, maxAge = 30 } = options;

    try {
        const response = await fetch(TAVILY_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                query,
                search_depth: "basic",      // "basic" is fast & cheap; "advanced" for deeper research
                include_answer: true,       // Tavily's own AI summary — used as a quick anchor
                include_raw_content: false, // don't need full HTML
                max_results: maxResults,
                days: maxAge,               // only results from the last N days
            }),
        });

        if (!response.ok) {
            const err = await response.text();
            console.error(`[WebSearch] Tavily API error ${response.status}:`, err);
            return null;
        }

        const data = await response.json();

        // ── Build a clean context block for the AI prompt ──────────
        const lines = [];

        // Tavily's own short answer (usually 1-2 sentences) — great anchor
        if (data.answer) {
            lines.push(`Quick summary: ${data.answer}`);
            lines.push("");
        }

        // Top search results with title, url, and snippet
        if (Array.isArray(data.results) && data.results.length > 0) {
            lines.push("Search results:");
            data.results.slice(0, maxResults).forEach((r, i) => {
                lines.push(`${i + 1}. ${r.title}`);
                if (r.url) lines.push(`   Source: ${r.url}`);
                if (r.content) lines.push(`   ${r.content.slice(0, 300).trim()}...`);
                lines.push("");
            });
        }

        if (lines.length === 0) return null;

        return lines.join("\n");
    } catch (err) {
        console.error("[WebSearch] Fetch failed:", err.message);
        return null;
    }
}

module.exports = { needsWebSearch, searchWeb };