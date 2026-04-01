// ============================================================
// routes/chat.js - Main Chat Endpoint
// POST /api/chat      - Handles all user messages
// GET  /api/chat/faqs - Returns all FAQs for quick-reply buttons
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
// ============================================================
router.post("/", async (req, res) => {
  const { message, conversationHistory = [] } = req.body;

  if (!message || typeof message !== "string" || message.trim() === "") {
    return res.status(400).json({ error: "Message is required and must be a non-empty string." });
  }

  // Fire-and-forget — don't await so it doesn't slow down the response
  increment("totalQueries").catch(() => {});

  try {
    // STEP 1: Try to match against FAQ knowledge base (reads from Supabase)
    const faqMatch = await matchFAQ(message.trim());

    if (faqMatch) {
      increment("faqAnswered").catch(() => {});
      return res.json({
        reply: faqMatch.answer,
        source: "faq",
        faqQuestion: faqMatch.question,
        timestamp: new Date().toISOString(),
      });
    }

    // STEP 2: No FAQ match - call the AI
    const model = process.env.AI_MODEL || "gpt-3.5-turbo";
    const recentHistory = conversationHistory.slice(-10).map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    const systemPrompt = `You are a helpful, friendly customer support chatbot for a software company.
Your job is to answer customer questions clearly and concisely.
Guidelines:
- Keep responses brief (2-4 sentences when possible)
- Be warm, professional, and empathetic
- If you don't know something specific, say so honestly and offer to connect them with a human agent
- Format lists with bullet points when helpful
- Never make up information about pricing, features, or policies`;

    const aiResponse = await aiClient.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        ...recentHistory,
        { role: "user", content: message.trim() },
      ],
      max_tokens: 500,
      temperature: 0.7,
    });

    const aiReply = aiResponse.choices[0]?.message?.content
      || "I'm sorry, I couldn't generate a response. Please try again.";

    increment("aiAnswered").catch(() => {});

    return res.json({
      reply: aiReply,
      source: "ai",
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
// Returns FAQ list for quick-reply buttons on the frontend
// ============================================================
router.get("/faqs", async (req, res) => {
  try {
    const faqs = await getAllFAQs();
    // Ensure we always have an array even if Supabase returns null
    const list = Array.isArray(faqs) ? faqs : [];
    const quickReplies = list.map(({ id, question }) => ({ id, question }));
    res.json({ faqs: quickReplies, total: quickReplies.length });
  } catch (err) {
    // Log full error so you can see it in the backend terminal
    console.error("[GET /api/chat/faqs] Error:", err.message, err.stack);
    // Return empty array instead of 500 so the chat still works
    res.json({ faqs: [], total: 0 });
  }
});

module.exports = router;