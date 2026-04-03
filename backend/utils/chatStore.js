// ============================================================
// utils/chatStore.js — Persistent Chat Session Storage
//
// Handles all DB operations for storing/retrieving chat history.
// Designed for 50M+ concurrent sessions via Supabase.
//
// KEY DESIGN DECISIONS:
//   • upsert_chat_session RPC  → atomic session init on widget open
//   • append_message RPC       → atomic single-message append (no races)
//   • No read-modify-write     → each op is one SQL statement
//   • app_id support           → multi-tenant (embed in any app)
// ============================================================

const { supabase } = require("./supabase");

// ============================================================
// initSession(sessionId, appId, metadata)
//
// Called when the chat widget opens. Creates the session row
// if it doesn't exist, returns existing messages if it does.
// Safe to call on every page load / widget mount.
//
// Returns: Array of message objects (may be empty for new sessions)
// ============================================================
async function initSession(sessionId, appId = "default", metadata = {}) {
  if (!sessionId) {
    console.error("[ChatStore] initSession: sessionId is required");
    return [];
  }

  const { data, error } = await supabase.rpc("upsert_chat_session", {
    p_session_id: sessionId,
    p_app_id:     appId,
    p_metadata:   metadata,
  });

  if (error) {
    console.error("[ChatStore] initSession error:", error.message);
    return []; // Fail gracefully — chat still works, just won't persist
  }

  // data is a JSONB array of message objects
  return Array.isArray(data) ? data : [];
}

// ============================================================
// saveMessage(sessionId, message)
//
// Atomically appends one message to the session's messages array.
// Call this after EVERY message — both user and bot.
//
// message shape:
//   { id, role: 'user'|'bot', content, source: 'faq'|'ai'|null, timestamp }
//
// Returns: true on success, false on failure
// ============================================================
async function saveMessage(sessionId, message) {
  if (!sessionId || !message) return false;

  // Strip any non-serialisable fields before storing
  const payload = {
    id:        message.id        || `${Date.now()}-${Math.random()}`,
    role:      message.role,
    content:   message.content,
    source:    message.source    || null,
    timestamp: message.timestamp || new Date().toISOString(),
  };

  const { error } = await supabase.rpc("append_message", {
    p_session_id: sessionId,
    p_message:    payload,
  });

  if (error) {
    console.error("[ChatStore] saveMessage error:", error.message);
    return false;
  }

  return true;
}

// ============================================================
// getMessages(sessionId)
//
// Fetch all messages for a session. Used for admin lookups.
// The widget itself uses initSession() on mount instead.
// ============================================================
async function getMessages(sessionId) {
  if (!sessionId) return [];

  const { data, error } = await supabase.rpc("get_session_messages", {
    p_session_id: sessionId,
  });

  if (error) {
    console.error("[ChatStore] getMessages error:", error.message);
    return [];
  }

  return Array.isArray(data) ? data : [];
}

// ============================================================
// clearSession(sessionId)
//
// Wipes the messages array for a session (user-triggered reset).
// Keeps the session row intact.
// ============================================================
async function clearSession(sessionId) {
  if (!sessionId) return false;

  const { error } = await supabase.rpc("clear_session_messages", {
    p_session_id: sessionId,
  });

  if (error) {
    console.error("[ChatStore] clearSession error:", error.message);
    return false;
  }

  return true;
}

// ============================================================
// getSessionAnalytics(appId, daysBack)
//
// Returns aggregate stats for an app. Used in admin dashboard.
// ============================================================
async function getSessionAnalytics(appId = "default", daysBack = 30) {
  const { data, error } = await supabase.rpc("get_session_analytics", {
    p_app_id:    appId,
    p_days_back: daysBack,
  });

  if (error) {
    console.error("[ChatStore] getSessionAnalytics error:", error.message);
    return null;
  }

  // RPC returns an array with one row
  return data?.[0] || null;
}

module.exports = { initSession, saveMessage, getMessages, clearSession, getSessionAnalytics };