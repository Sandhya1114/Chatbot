// ============================================================
// routes/chat.js - Main Chat Endpoint
// POST /api/chat      - Handles all user messages
// GET  /api/chat/faqs - Returns all FAQs for initial quick-reply buttons
// ============================================================

const express = require("express");
const router = express.Router();
const OpenAI = require("openai");
const { matchFAQ, getAllFAQs } = require("../utils/faqMatcher");
const { increment } = require("../utils/store");

const aiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
});

// ============================================================
// POST /api/chat
// Body: { message: string, conversationHistory: array }
//
// Response always includes:
//   reply        — the bot's answer text
//   source       — "faq" | "ai"
//   suggestions  — array of { id, question } for contextual quick-replies
//   timestamp    — ISO string
// ============================================================
router.post("/", async (req, res) => {
  const { message, conversationHistory = [] } = req.body;

  if (!message || typeof message !== "string" || message.trim() === "") {
    return res
      .status(400)
      .json({ error: "Message is required and must be a non-empty string." });
  }

  increment("totalQueries").catch(() => {});

  try {
    // ── STEP 1: RAG — score all FAQs, get best match + related suggestions ──
    const { match: faqMatch, suggestions } = await matchFAQ(message.trim());

    // Serialise suggestions to lightweight { id, question } objects
    const suggestionList = (suggestions || []).map(({ id, question }) => ({ id, question }));

    if (faqMatch) {
      increment("faqAnswered").catch(() => {});
      return res.json({
        reply: faqMatch.answer,
        source: "faq",
        faqQuestion: faqMatch.question,
        suggestions: suggestionList,   // ← contextual related FAQs
        timestamp: new Date().toISOString(),
      });
    }

    // ── STEP 2: No FAQ match → call AI with full context ──
    const model = process.env.AI_MODEL || "gpt-3.5-turbo";
    const recentHistory = conversationHistory.slice(-10).map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    // Build a system prompt that tells the AI to behave like a knowledgeable
    // human support rep AND to naturally suggest related topics it knows about.
    const systemPrompt = `You are a friendly, knowledgeable customer support assistant for a SaaS software company.
Your personality is warm, conversational, and genuinely helpful — like a real human support agent, not a robot.

Guidelines:
- Answer clearly and concisely (2-4 sentences ideally, longer only if truly needed)
- Use natural, conversational language — contractions are fine ("you'll", "we've", "don't")
- When you don't know something specific, be honest and offer to connect them with a human
- Format lists with bullet points when it helps readability
- NEVER make up pricing, policies, or feature details you're not sure about
- After your main answer, if relevant, briefly mention 1-2 related things the user might also want to know
  (e.g. "By the way, if you're also wondering about billing, I can help with that too.")
- Keep suggestions natural — don't force them if they don't fit`;

    const aiResponse = await aiClient.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        ...recentHistory,
        { role: "user", content: message.trim() },
      ],
      max_tokens: 600,
      temperature: 0.75,  // slightly higher for more natural, human-like variation
    });

    const aiReply =
      aiResponse.choices[0]?.message?.content ||
      "I'm sorry, I couldn't generate a response. Please try again.";

    increment("aiAnswered").catch(() => {});

    return res.json({
      reply: aiReply,
      source: "ai",
      suggestions: suggestionList,   // ← still return related FAQ suggestions
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error("Chat error:", error.message);
    return res.status(500).json({
      error: "Something went wrong. Please try again or contact support.",
      details: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================
// GET /api/chat/faqs
// Returns the full FAQ list for the INITIAL quick-reply buttons
// shown when the chat first opens (before any message is sent).
// ============================================================
router.get("/faqs", async (req, res) => {
  try {
    const faqs = await getAllFAQs();
    const list = Array.isArray(faqs) ? faqs : [];
    const quickReplies = list.map(({ id, question }) => ({ id, question }));
    res.json({ faqs: quickReplies, total: quickReplies.length });
  } catch (err) {
    console.error("[GET /api/chat/faqs] Error:", err.message);
    res.json({ faqs: [], total: 0 });
  }
});

module.exports = router;