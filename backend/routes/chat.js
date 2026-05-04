const express = require("express");
const OpenAI = require("openai");
const { matchFAQ, getAllFAQs } = require("../utils/faqMatcher");
const { increment } = require("../utils/store");
const { initSession, saveMessage, clearSession } = require("../utils/chatStore");

const router = express.Router();

const aiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
});

const CONTEXT_ONLY_FALLBACK =
  "I'm sorry, I couldn't find that information. Please contact support for more details.";

function isValidSessionId(id) {
  if (typeof id !== "string") return false;
  if (id.length < 8 || id.length > 128) return false;
  return /^[\w-]+$/.test(id);
}

function extractSourceUrl(text) {
  const match = String(text || "").match(/Source URL:\s*(https?:\/\/\S+)/i);
  return match?.[1]?.trim() || null;
}

function stripSourceMetadata(text) {
  return String(text || "")
    .replace(/Source URL:\s*https?:\/\/\S+\s*/gi, "")
    .trim();
}

function cleanContextText(text) {
  return stripSourceMetadata(text)
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeSiteOrigin(rawUrl) {
  try {
    return new URL(String(rawUrl || "").trim()).origin;
  } catch {
    return "";
  }
}

function buildConciseFallback(text, maxWords = 80) {
  const normalized = cleanContextText(text);
  if (!normalized) return CONTEXT_ONLY_FALLBACK;

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  let wordCount = 0;
  const selected = [];

  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter(Boolean);
    if (selected.length > 0 && wordCount + words.length > maxWords) break;
    selected.push(sentence);
    wordCount += words.length;
    if (wordCount >= maxWords) break;
  }

  if (selected.length > 0) {
    return selected.join(" ").trim();
  }

  const allWords = normalized.split(/\s+/).filter(Boolean);
  const trimmedWords = allWords.slice(0, maxWords);
  const suffix = trimmedWords.length < allWords.length ? "..." : "";
  return `${trimmedWords.join(" ")}${suffix}`.trim();
}

async function rewriteFaqAnswer(question, context) {
  const cleanedContext = cleanContextText(context);
  if (!cleanedContext) return CONTEXT_ONLY_FALLBACK;

  if (!process.env.OPENAI_API_KEY) {
    return buildConciseFallback(cleanedContext);
  }

  try {
    const model = process.env.AI_MODEL || "gpt-3.5-turbo";
    const completion = await aiClient.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: `You are a helpful and professional support assistant.

You must answer the user's question strictly based on the provided context.

Rules:
- Do NOT generate information that is not present in the context.
- If the answer is partially available, provide the most relevant information.
- If no relevant information is found, reply exactly with:
"I'm sorry, I couldn't find that information. Please contact support for more details."
- Keep responses short (under 80 words), clear, and user-friendly.
- Combine information if multiple relevant points are found.
- Do not mention the source or context.`,
        },
        {
          role: "user",
          content: `Context:\n${cleanedContext}\n\nQuestion:\n${question}\n\nHelpful Answer:`,
        },
      ],
      max_tokens: 160,
      temperature: 0.2,
    });

    const reply = completion.choices[0]?.message?.content?.trim();
    return reply || buildConciseFallback(cleanedContext);
  } catch (error) {
    console.error("[Chat] FAQ rewrite error:", error.message);
    return buildConciseFallback(cleanedContext);
  }
}

router.get("/history", async (req, res) => {
  const { sessionId, appId = "default" } = req.query;

  if (!sessionId || !isValidSessionId(sessionId)) {
    return res.status(400).json({ error: "Valid sessionId query param is required." });
  }

  try {
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
    return res.json({ sessionId, messages: [], total: 0 });
  }
});

router.post("/", async (req, res) => {
  const {
    message,
    sessionId,
    appId = "default",
    conversationHistory = [],
    siteOrigin = "",
    pageUrl = "",
  } = req.body;

  void conversationHistory;

  if (!message || typeof message !== "string" || message.trim() === "") {
    return res.status(400).json({ error: "Message is required and must be a non-empty string." });
  }

  if (!sessionId || !isValidSessionId(sessionId)) {
    return res.status(400).json({ error: "Valid sessionId is required to persist chat history." });
  }

  const trimmedMessage = message.trim();
  increment("totalQueries").catch(() => {});

  const userMessage = {
    id: `${Date.now()}-u-${Math.random().toString(36).slice(2, 7)}`,
    role: "user",
    content: trimmedMessage,
    source: null,
    timestamp: new Date().toISOString(),
  };

  saveMessage(sessionId, userMessage).catch((err) =>
    console.error("[Chat] Failed to save user message:", err.message)
  );

  try {
    const siteContext = {
      appId,
      siteOrigin: normalizeSiteOrigin(siteOrigin),
      pageUrl: String(pageUrl || ""),
    };

    const { match: faqMatch, suggestions } = await matchFAQ(trimmedMessage, siteContext);
    const suggestionList = (suggestions || []).map(({ id, question }) => ({ id, question }));

    if (faqMatch) {
      increment("faqAnswered").catch(() => {});

      const sourceUrl = extractSourceUrl(faqMatch.answer);
      const rewrittenReply = await rewriteFaqAnswer(trimmedMessage, faqMatch.answer);

      const botMessage = {
        id: `${Date.now()}-b-${Math.random().toString(36).slice(2, 7)}`,
        role: "bot",
        content: rewrittenReply,
        source: "faq",
        sourceUrl,
        faqQuestion: faqMatch.question,
        timestamp: new Date().toISOString(),
      };

      saveMessage(sessionId, botMessage).catch((err) =>
        console.error("[Chat] Failed to save FAQ bot message:", err.message)
      );

      return res.json({
        reply: rewrittenReply,
        source: "faq",
        sourceUrl,
        faqQuestion: faqMatch.question,
        suggestions: suggestionList,
        messageId: botMessage.id,
        timestamp: botMessage.timestamp,
      });
    }

    const fallbackMessage = {
      id: `${Date.now()}-b-${Math.random().toString(36).slice(2, 7)}`,
      role: "bot",
      content: CONTEXT_ONLY_FALLBACK,
      source: null,
      timestamp: new Date().toISOString(),
    };

    saveMessage(sessionId, fallbackMessage).catch((err) =>
      console.error("[Chat] Failed to save fallback bot message:", err.message)
    );

    return res.json({
      reply: CONTEXT_ONLY_FALLBACK,
      source: null,
      suggestions: suggestionList,
      messageId: fallbackMessage.id,
      timestamp: fallbackMessage.timestamp,
    });
  } catch (error) {
    console.error("[Chat] Error:", error.message);
    return res.status(500).json({
      error: "Something went wrong. Please try again or contact support.",
      details: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

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

router.get("/faqs", async (req, res) => {
  try {
    const faqs = await getAllFAQs({
      appId: req.query.appId || "default",
      siteOrigin: normalizeSiteOrigin(req.query.siteOrigin || ""),
      pageUrl: String(req.query.pageUrl || ""),
    });
    const list = Array.isArray(faqs) ? faqs : [];
    const quickReplies = list.map(({ id, question }) => ({ id, question }));
    res.json({ faqs: quickReplies, total: quickReplies.length });
  } catch (err) {
    console.error("[GET /api/chat/faqs] Error:", err.message);
    res.json({ faqs: [], total: 0 });
  }
});

module.exports = router;
