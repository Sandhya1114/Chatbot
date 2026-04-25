// ============================================================
// routes/chat.js — Main Chat Endpoint (with Persistence)
//
// POST /api/chat           — Handle user message, save to DB
// GET  /api/chat/faqs      — Initial quick-reply FAQ buttons
// GET  /api/chat/history   — Restore session history on mount
// DELETE /api/chat/history — Clear a session's chat history
// ============================================================

const express = require("express");
const router = express.Router();
const OpenAI = require("openai");
const { matchFAQ, getAllFAQs } = require("../utils/faqMatcher");
const { increment } = require("../utils/store");
const { initSession, saveMessage, clearSession } = require("../utils/chatStore");

const aiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
});

// ============================================================
// Validate session ID — must be a non-empty string, UUID-like
// Prevents SQL injection / oversized keys
// ============================================================
function isValidSessionId(id) {
  if (typeof id !== "string") return false;
  if (id.length < 8 || id.length > 128) return false;
  // Allow UUID v4 format and reasonable custom formats
  return /^[\w\-]+$/.test(id);
}

// ============================================================
// GET /api/chat/history?sessionId=xxx&appId=yyy
//
// Called by the widget on mount to restore previous chat.
// Creates the session row if it doesn't exist yet.
// Returns the messages array (empty for brand new sessions).
// ============================================================
router.get("/history", async (req, res) => {
  const { sessionId, appId = "default" } = req.query;

  if (!sessionId || !isValidSessionId(sessionId)) {
    return res.status(400).json({ error: "Valid sessionId query param is required." });
  }

  try {
    // upsert_chat_session: creates row if new, returns messages if existing
    const messages = await initSession(sessionId, appId, {
      userAgent: req.headers["user-agent"]?.slice(0, 200),
      ip: req.ip,
    });

    return res.json({
      sessionId,
      messages,
      total: messages.length,
    });
  } catch (err) {
    console.error("[Chat] History fetch error:", err.message);
    // Return empty rather than failing — widget still usable
    return res.json({ sessionId, messages: [], total: 0 });
  }
});

// ============================================================
// POST /api/chat
//
// Body: { message, sessionId, appId?, conversationHistory? }
//
// Flow:
//   1. Validate inputs
//   2. Save user message to DB
//   3. Run FAQ matcher (RAG)
//   4. If no FAQ match → call AI
//   5. Save bot reply to DB
//   6. Return reply + suggestions
// ============================================================
router.post("/", async (req, res) => {
  const {
    message,
    sessionId,
    appId = "default",
    conversationHistory = [],
  } = req.body;

  // ---- Input validation ----
  if (!message || typeof message !== "string" || message.trim() === "") {
    return res.status(400).json({ error: "Message is required and must be a non-empty string." });
  }

  if (!sessionId || !isValidSessionId(sessionId)) {
    return res.status(400).json({ error: "Valid sessionId is required to persist chat history." });
  }

  const trimmedMessage = message.trim();

  // Fire-and-forget analytics
  increment("totalQueries").catch(() => {});

  // ---- Save user message to DB (non-blocking) ----
  const userMessage = {
    id:        `${Date.now()}-u-${Math.random().toString(36).slice(2, 7)}`,
    role:      "user",
    content:   trimmedMessage,
    source:    null,
    timestamp: new Date().toISOString(),
  };

  // Run DB save in background — don't block the response on it
  saveMessage(sessionId, userMessage).catch((err) =>
    console.error("[Chat] Failed to save user message:", err.message)
  );

  try {
    // ── STEP 1: RAG — match against FAQ knowledge base ──
    const { match: faqMatch, suggestions } = await matchFAQ(trimmedMessage);

    const suggestionList = (suggestions || []).map(({ id, question }) => ({ id, question }));

    if (faqMatch) {
      increment("faqAnswered").catch(() => {});

      const botMessage = {
        id:        `${Date.now()}-b-${Math.random().toString(36).slice(2, 7)}`,
        role:      "bot",
        content:   faqMatch.answer,
        source:    "faq",
        faqQuestion: faqMatch.question,
        timestamp: new Date().toISOString(),
      };

      // Save bot reply to DB (non-blocking)
      saveMessage(sessionId, botMessage).catch((err) =>
        console.error("[Chat] Failed to save FAQ bot message:", err.message)
      );

      return res.json({
        reply:       faqMatch.answer,
        source:      "faq",
        faqQuestion: faqMatch.question,
        suggestions: suggestionList,
        messageId:   botMessage.id,
        timestamp:   botMessage.timestamp,
      });
    }

    // ── STEP 2: No FAQ match → call AI ──
    const model = process.env.AI_MODEL || "gpt-3.5-turbo";

    // Build recent history for AI context (last 10 exchanges)
    const recentHistory = conversationHistory.slice(-10).map((msg) => ({
      role:    msg.role === "bot" ? "assistant" : msg.role,
      content: msg.content,
    }));

    const systemPrompt = `You are a friendly, knowledgeable customer support assistant for a SaaS software company.
Your personality is warm, conversational, and genuinely helpful — like a real human support agent, not a robot.

Guidelines:
- Answer clearly and concisely (2-4 sentences ideally, longer only if truly needed)
- Use natural, conversational language — contractions are fine ("you'll", "we've", "don't")
- When you don't know something specific, be honest and offer to connect them with a human
- Format lists with bullet points when it helps readability
- NEVER make up pricing, policies, or feature details you're not sure about
- After your main answer, if relevant, briefly mention 1-2 related things the user might also want to know
- Keep suggestions natural — don't force them if they don't fit`;

    const aiResponse = await aiClient.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        ...recentHistory,
        { role: "user", content: trimmedMessage },
      ],
      max_tokens:  600,
      temperature: 0.75,
    });

    const aiReply =
      aiResponse.choices[0]?.message?.content ||
      "I'm sorry, I couldn't generate a response. Please try again.";

    increment("aiAnswered").catch(() => {});

    const botMessage = {
      id:        `${Date.now()}-b-${Math.random().toString(36).slice(2, 7)}`,
      role:      "bot",
      content:   aiReply,
      source:    "ai",
      timestamp: new Date().toISOString(),
    };

    // Save AI bot reply to DB (non-blocking)
    saveMessage(sessionId, botMessage).catch((err) =>
      console.error("[Chat] Failed to save AI bot message:", err.message)
    );

    return res.json({
      reply:       aiReply,
      source:      "ai",
      suggestions: suggestionList,
      messageId:   botMessage.id,
      timestamp:   botMessage.timestamp,
    });

  } catch (error) {
    console.error("[Chat] Error:", error.message);
    return res.status(500).json({
      error: "Something went wrong. Please try again or contact support.",
      details: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================
// DELETE /api/chat/history
//
// Body: { sessionId }
// Clears a session's message history (user-triggered "New Chat")
// ============================================================
router.delete("/history", async (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId || !isValidSessionId(sessionId)) {
    return res.status(400).json({ error: "Valid sessionId is required." });
  }

  try {
    await clearSession(sessionId);
    return res.json({ success: true, message: "Chat history cleared." });
  } catch (err) {
    console.error("[Chat] Clear session error:", err.message);
    return res.status(500).json({ error: "Failed to clear chat history." });
  }
});

// ============================================================
// GET /api/chat/faqs
// Returns the full FAQ list for initial quick-reply buttons
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

