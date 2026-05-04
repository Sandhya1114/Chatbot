const express = require("express");
const OpenAI = require("openai");
const { matchFAQ, getAllFAQs } = require("../utils/faqMatcher");
const { increment } = require("../utils/store");
const { initSession, saveMessage, clearSession } = require("../utils/chatStore");

const router = express.Router();

const AI_API_KEY =
  process.env.GROQ_API_KEY ||
  process.env.OPENAI_API_KEY ||
  "";

const AI_BASE_URL =
  process.env.GROQ_BASE_URL ||
  process.env.OPENAI_BASE_URL ||
  "https://api.openai.com/v1";

const aiClient = new OpenAI({
  apiKey: AI_API_KEY,
  baseURL: AI_BASE_URL,
});

const CONTEXT_ONLY_FALLBACK =
  "I'm sorry, I couldn't find that information. Please contact support for more details.";

function hasAiAccess() {
  return Boolean(AI_API_KEY);
}

const FOLLOW_UP_PATTERNS = [
  /\btell me more\b/i,
  /\btell more\b/i,
  /\bmore detail(?:ed)?\b/i,
  /\bexplain more\b/i,
  /\bgo deeper\b/i,
  /\belaborate\b/i,
  /\bexpand\b/i,
  /\bdetail\b/i,
  /\bno about\b/i,
  /\bnot that\b/i,
  /\babout (?:the )?website\b/i,
  /\babout (?:the )?site\b/i,
  /\babout (?:the )?store\b/i,
];

const WEBSITE_PATTERNS = [
  /\bwebsite\b/i,
  /\bsite\b/i,
  /\bstore\b/i,
  /\bstorefront\b/i,
  /\bplatform\b/i,
  /\bbusiness\b/i,
  /\bcompany\b/i,
  /\bbrand\b/i,
];

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

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function isFollowUpPrompt(message) {
  const text = String(message || "").trim();
  if (!text) return false;
  if (text.split(/\s+/).length <= 4) return true;
  return FOLLOW_UP_PATTERNS.some((pattern) => pattern.test(text));
}

function isWebsiteIntent(message) {
  const text = String(message || "").trim();
  return WEBSITE_PATTERNS.some((pattern) => pattern.test(text));
}

function isWebsiteLevelFaq(faq) {
  const combined = [
    faq?.question || "",
    faq?.answer || "",
    faq?.keywords?.join ? faq.keywords.join(" ") : "",
  ].join(" ");

  return WEBSITE_PATTERNS.some((pattern) => pattern.test(combined)) ||
    /what information is available on the (home page|about|faq|contact|blog|shop)/i.test(String(faq?.question || "")) ||
    /what is .* about\?/i.test(String(faq?.question || ""));
}

function getConversationSlices(history, currentMessage) {
  const items = Array.isArray(history) ? history.slice() : [];
  const currentKey = normalizeText(currentMessage);

  let lastAssistant = null;
  let previousUser = null;
  let skippedCurrentUser = false;

  for (let i = items.length - 1; i >= 0; i -= 1) {
    const entry = items[i] || {};
    const role = entry.role === "assistant" ? "assistant" : "user";
    const content = String(entry.content || "").trim();
    if (!content) continue;

    if (role === "assistant" && !lastAssistant) {
      lastAssistant = content;
      continue;
    }

    if (role === "user") {
      const contentKey = normalizeText(content);
      if (!skippedCurrentUser && currentKey && contentKey === currentKey) {
        skippedCurrentUser = true;
        continue;
      }
      previousUser = content;
      break;
    }
  }

  return { previousUser, lastAssistant };
}

function buildEffectiveQuestion(message, conversationHistory) {
  const trimmed = String(message || "").trim();
  if (!trimmed) return "";

  const { previousUser, lastAssistant } = getConversationSlices(conversationHistory, trimmed);
  const followUp = isFollowUpPrompt(trimmed);
  const websiteIntent = isWebsiteIntent(trimmed) || isWebsiteIntent(previousUser);

  if (!followUp) {
    return {
      effectiveQuestion: trimmed,
      followUp,
      websiteIntent,
      previousUser,
      lastAssistant,
    };
  }

  const parts = [trimmed];
  if (previousUser) parts.push(`Previous topic: ${previousUser}`);
  if (websiteIntent) parts.push("Focus on the website/store overview, not a single product.");

  return {
    effectiveQuestion: parts.join(" "),
    followUp,
    websiteIntent,
    previousUser,
    lastAssistant,
  };
}

function combineFaqContexts(faqs, maxItems = 4) {
  return (Array.isArray(faqs) ? faqs : [])
    .slice(0, maxItems)
    .map((faq, index) => {
      const question = String(faq?.question || "").trim();
      const answer = cleanContextText(faq?.answer || "");
      if (!question || !answer) return "";
      return `FAQ ${index + 1}\nQuestion: ${question}\nAnswer: ${answer}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function buildConversationSummary(history, maxItems = 6) {
  return (Array.isArray(history) ? history : [])
    .slice(-maxItems)
    .map((entry) => {
      const role = entry?.role === "assistant" ? "Assistant" : "User";
      const content = String(entry?.content || "").trim();
      return content ? `${role}: ${content}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function buildSuggestionObjects(questions, prefix) {
  return questions
    .map((question, index) => ({
      id: `${prefix}-${index + 1}`,
      question: String(question || "").trim(),
    }))
    .filter((item, index, list) =>
      item.question &&
      list.findIndex((other) => other.question.toLowerCase() === item.question.toLowerCase()) === index
    )
    .slice(0, 3);
}

function parseSuggestionLines(rawText) {
  return String(rawText || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}

async function generateAiReply(question, options = {}) {
  const contextBlock = combineFaqContexts(options.relatedFaqs);
  const conversationBlock = buildConversationSummary(options.conversationHistory);
  const siteOrigin = normalizeSiteOrigin(options.siteOrigin || "");
  const pageUrl = String(options.pageUrl || "");
  const fallbackContext = contextBlock || "";

  if (!hasAiAccess()) {
    if (fallbackContext) {
      return {
        reply: buildConciseFallback(fallbackContext, 90),
        sourceUrl: extractSourceUrl(options.relatedFaqs?.[0]?.answer || "") || pageUrl || null,
      };
    }
    return { reply: CONTEXT_ONLY_FALLBACK, sourceUrl: pageUrl || null };
  }

  try {
    const model = process.env.AI_MODEL || "gpt-3.5-turbo";
    const completion = await aiClient.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: `You are a helpful website support assistant.

Rules:
- Prefer the provided website FAQ context when it is relevant.
- If the FAQ context is incomplete, you may still answer using general knowledge.
- Never invent company-specific policies, pricing, stock, shipping times, addresses, or support promises that are not in the provided context.
- If a site-specific answer is missing, say that you do not see that exact detail in the available website data, then give the best safe general guidance.
- Keep the reply concise, clear, and natural.
- Do not mention internal scoring, retrieval, or "provided context".`,
        },
        {
          role: "user",
          content: [
            siteOrigin ? `Website origin: ${siteOrigin}` : "",
            pageUrl ? `Current page: ${pageUrl}` : "",
            conversationBlock ? `Recent conversation:\n${conversationBlock}` : "",
            contextBlock ? `Relevant website FAQ data:\n${contextBlock}` : "Relevant website FAQ data:\nNone found.",
            options.focusInstruction ? `Answer focus: ${options.focusInstruction}` : "",
            `User question:\n${question}`,
            "Helpful answer:"
          ].filter(Boolean).join("\n\n"),
        },
      ],
      max_tokens: 220,
      temperature: contextBlock ? 0.35 : 0.55,
    });

    return {
      reply: completion.choices[0]?.message?.content?.trim() || CONTEXT_ONLY_FALLBACK,
      sourceUrl: extractSourceUrl(options.relatedFaqs?.[0]?.answer || "") || pageUrl || null,
    };
  } catch (error) {
    console.error("[Chat] AI fallback error:", error.message);
    if (fallbackContext) {
      return {
        reply: buildConciseFallback(fallbackContext, 90),
        sourceUrl: extractSourceUrl(options.relatedFaqs?.[0]?.answer || "") || pageUrl || null,
      };
    }
    return { reply: CONTEXT_ONLY_FALLBACK, sourceUrl: pageUrl || null };
  }
}

async function generateAiSuggestions(question, reply, options = {}) {
  const originalQuestionKey = String(question || "").trim().toLowerCase();
  const fallbackQuestions = buildSuggestionObjects(
    (options.relatedFaqs || [])
      .map((faq) => faq.question)
      .filter((candidate) => String(candidate || "").trim().toLowerCase() !== originalQuestionKey),
    "faq-suggestion"
  );

  if (fallbackQuestions.length > 0) {
    return fallbackQuestions;
  }

  if (!hasAiAccess()) {
    return [];
  }

  try {
    const model = process.env.AI_MODEL || "gpt-3.5-turbo";
    const contextBlock = combineFaqContexts(options.relatedFaqs, 3);
    const completion = await aiClient.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: `You create short follow-up questions for a website chatbot.

Rules:
- Return 1 to 3 suggestions only.
- Put each suggestion on its own line.
- Each suggestion must be a concise user question.
- Keep them grounded in the same website/topic when possible.
- Do not repeat the original user question.`,
        },
        {
          role: "user",
          content: [
            contextBlock ? `Website FAQ context:\n${contextBlock}` : "",
            `User question: ${question}`,
            `Assistant reply: ${reply}`,
          ].filter(Boolean).join("\n\n"),
        },
      ],
      max_tokens: 140,
      temperature: 0.4,
    });

    const raw = completion.choices[0]?.message?.content?.trim() || "";
    return buildSuggestionObjects(
      parseSuggestionLines(raw).filter((candidate) => candidate.toLowerCase() !== originalQuestionKey),
      "ai-suggestion"
    );
  } catch (error) {
    console.error("[Chat] AI suggestion error:", error.message);
    return [];
  }
}

async function rewriteFaqAnswer(question, context) {
  const cleanedContext = cleanContextText(context);
  if (!cleanedContext) return CONTEXT_ONLY_FALLBACK;

  if (!hasAiAccess()) {
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

    const intent = buildEffectiveQuestion(trimmedMessage, conversationHistory);
    const { match: faqMatch, suggestions, relatedFaqs } = await matchFAQ(intent.effectiveQuestion, siteContext);
    let suggestionList = (suggestions || []).map(({ id, question }) => ({ id, question }));
    const shouldForceAiFollowUp = intent.followUp;
    const shouldForceWebsiteAnswer = intent.websiteIntent && faqMatch && !isWebsiteLevelFaq(faqMatch);

    if (faqMatch && !shouldForceAiFollowUp && !shouldForceWebsiteAnswer) {
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

      if (suggestionList.length === 0) {
        suggestionList = await generateAiSuggestions(trimmedMessage, rewrittenReply, {
          relatedFaqs,
          siteOrigin: siteContext.siteOrigin,
          pageUrl: siteContext.pageUrl,
        });
      }

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

    const aiResult = await generateAiReply(trimmedMessage, {
      relatedFaqs,
      conversationHistory,
      siteOrigin: siteContext.siteOrigin,
      pageUrl: siteContext.pageUrl,
      focusInstruction: intent.websiteIntent
        ? "The user is asking about the website/store as a whole. Prioritize describing the website, its purpose, features, and sections before discussing individual products."
        : "",
    });

    increment("aiAnswered").catch(() => {});

    if (shouldForceAiFollowUp || shouldForceWebsiteAnswer || suggestionList.length === 0) {
      suggestionList = await generateAiSuggestions(trimmedMessage, aiResult.reply, {
        relatedFaqs,
        siteOrigin: siteContext.siteOrigin,
        pageUrl: siteContext.pageUrl,
      });
    }

    const fallbackMessage = {
      id: `${Date.now()}-b-${Math.random().toString(36).slice(2, 7)}`,
      role: "bot",
      content: aiResult.reply,
      source: "ai",
      sourceUrl: aiResult.sourceUrl,
      timestamp: new Date().toISOString(),
    };

    saveMessage(sessionId, fallbackMessage).catch((err) =>
      console.error("[Chat] Failed to save fallback bot message:", err.message)
    );

    return res.json({
      reply: aiResult.reply,
      source: "ai",
      sourceUrl: aiResult.sourceUrl,
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
