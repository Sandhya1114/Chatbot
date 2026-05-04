// ============================================================
// hooks/useChat.js — Chat Hook with Persistent Storage
//
// HOW PERSISTENCE WORKS:
//   1. On first mount, generate a UUID v4 sessionId and store
//      it in localStorage under the key: `chatbot_session_<appId>`
//   2. Call GET /api/chat/history?sessionId=xxx to restore
//      previous messages from Supabase (survives refresh/close)
//   3. Every message (user + bot) is saved to the DB via the
//      POST /api/chat endpoint (backend saves both sides)
//   4. "New Chat" button calls DELETE /api/chat/history and
//      generates a fresh sessionId
//
// LIBRARY USAGE:
//   Pass `appId` prop to ChatWidget to namespace sessions:
//   <ChatWidget appId="my-saas-app" />
//   Different appIds = different session namespaces in Supabase.
// ============================================================

import { useState, useCallback, useRef, useEffect } from "react";

// ---- Helpers ------------------------------------------------

function generateUUID() {
  // Crypto-quality UUID v4 (works in all modern browsers)
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older environments
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function getStorageKey(appId) {
  return `chatbot_session_${appId}`;
}

function getOrCreateSessionId(appId) {
  const key = getStorageKey(appId);
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const newId = generateUUID();
    localStorage.setItem(key, newId);
    return newId;
  } catch {
    // localStorage unavailable (private browsing etc.) — use in-memory only
    return generateUUID();
  }
}

function createMessage(role, content, source = null, extra = {}) {
  return {
    id:        `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role,
    content,
    source,
    timestamp: new Date().toISOString(),
    ...extra,
  };
}

// ---- Hook ---------------------------------------------------

export function useChat(appId = "default") {
  const [messages, setMessages]     = useState([]);
  const [isTyping, setIsTyping]     = useState(false);
  const [isLoading, setIsLoading]   = useState(true);  // true while restoring history
  const [error, setError]           = useState(null);
  const [suggestions, setSuggestions] = useState([]);

  // Session ID — stable for the lifetime of this hook instance
  const sessionIdRef = useRef(getOrCreateSessionId(appId));
  const sessionId    = sessionIdRef.current;

  // Conversation history kept in-memory for AI context window
  // (mirrored from messages state — avoids re-computing on every send)
  const conversationHistory = useRef([]);

  // ── RESTORE HISTORY ON MOUNT ──────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function restoreHistory() {
      setIsLoading(true);
      try {
        const res = await fetch(
          `/api/chat/history?sessionId=${encodeURIComponent(sessionId)}&appId=${encodeURIComponent(appId)}`
        );

        if (!res.ok) throw new Error("Failed to fetch history");

        const data = await res.json();
        const savedMessages = Array.isArray(data.messages) ? data.messages : [];

        if (!cancelled) {
          setMessages(savedMessages);
          // Rebuild conversationHistory ref from saved messages
          conversationHistory.current = savedMessages.map((m) => ({
            role:    m.role === "bot" ? "assistant" : "user",
            content: m.content,
          }));
        }
      } catch (err) {
        console.warn("[useChat] Could not restore history:", err.message);
        // Non-fatal — chat still works without history
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    restoreHistory();
    return () => { cancelled = true; };
  }, [sessionId, appId]); // Only runs once on mount

  // ── SEND MESSAGE ─────────────────────────────────────────
  const sendMessage = useCallback(async (text) => {
    if (!text.trim()) return;

    setError(null);
    setSuggestions([]);

    // Optimistically add user message to UI immediately
    const userMsg = createMessage("user", text);
    setMessages((prev) => [...prev, userMsg]);
    conversationHistory.current.push({ role: "user", content: text });

    setIsTyping(true);

    try {
      const response = await fetch("/api/chat", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message:             text,
          sessionId,           // ← backend saves both user + bot messages
          appId,
          conversationHistory: conversationHistory.current.slice(-10),
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Server error");
      }

      const data = await response.json();

      // Build the bot message from the response
      // Use the server-generated timestamp + id if available
      const botMsg = createMessage("bot", data.reply, data.source, {
        id:          data.messageId || undefined,
        sourceUrl:   data.sourceUrl || null,
        timestamp:   data.timestamp || new Date().toISOString(),
        faqQuestion: data.faqQuestion,
      });

      setMessages((prev) => [...prev, botMsg]);
      conversationHistory.current.push({ role: "assistant", content: data.reply });

      if (Array.isArray(data.suggestions) && data.suggestions.length > 0) {
        setSuggestions(data.suggestions);
      } else {
        setSuggestions([]);
      }
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
      const errMsg = createMessage(
        "bot",
        '⚠️ Sorry, I couldn\'t process your request. Please try again or click "Talk to Human" for help.',
        null
      );
      setMessages((prev) => [...prev, errMsg]);
      setSuggestions([]);
    } finally {
      setIsTyping(false);
    }
  }, [sessionId, appId]);

  // ── CLEAR / NEW CHAT ─────────────────────────────────────
  // Wipes DB history AND generates a new sessionId so the next
  // conversation is completely fresh and separately tracked.
  const clearMessages = useCallback(async () => {
    try {
      // Tell backend to clear this session's history
      await fetch("/api/chat/history", {
        method:  "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
    } catch (err) {
      console.warn("[useChat] Could not clear remote history:", err.message);
    }

    // Generate a brand-new sessionId and persist it
    const newSessionId = generateUUID();
    sessionIdRef.current = newSessionId;
    try {
      localStorage.setItem(getStorageKey(appId), newSessionId);
    } catch {
      // localStorage unavailable — fine, session just won't persist
    }

    // Reset local state
    setMessages([]);
    setError(null);
    setSuggestions([]);
    conversationHistory.current = [];
  }, [sessionId, appId]);

  return {
    messages,
    isTyping,
    isLoading,           // ← true while fetching saved history on mount
    error,
    suggestions,
    sessionId,           // ← expose for debugging / admin use
    sendMessage,
    clearMessages,
    conversationHistory: conversationHistory.current,
  };
}
