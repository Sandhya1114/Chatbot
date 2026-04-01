// ============================================================
// utils/store.js - Supabase-Backed Data Store
// ============================================================

const { supabase } = require("./supabase");

const ANALYTICS_ROW_ID = 1;

// ============================================================
// increment(field)
// Atomically increments an analytics counter via Postgres RPC.
// ============================================================
async function increment(field) {
  const columnMap = {
    totalQueries: "total_queries",
    faqAnswered:  "faq_answered",
    aiAnswered:   "ai_answered",
    escalations:  "escalations",
  };

  const column = columnMap[field];
  if (!column) return;

  const { error } = await supabase.rpc("increment_analytics", {
    col_name: column,
    row_id: ANALYTICS_ROW_ID,
  });

  if (error) {
    console.error(`[Analytics] Failed to increment ${column}:`, error.message);
  }
}

// ============================================================
// addEscalation(data) - async, must be awaited by callers
// ============================================================
async function addEscalation(data) {
  const { error } = await supabase.from("escalations").insert({
    id: data.id,
    name: data.name,
    email: data.email,
    issue: data.issue,
    status: data.status,
    conversation_history: data.conversationHistory,
    created_at: data.createdAt,
  });

  if (error) {
    console.error("[Escalation] Failed to save escalation:", error.message);
    throw error;
  }
}

// ============================================================
// getAnalytics() - async, must be awaited by callers
// ============================================================
async function getAnalytics() {
  const { data, error } = await supabase
    .from("analytics")
    .select("*")
    .eq("id", ANALYTICS_ROW_ID)
    .single();

  if (error || !data) {
    console.error("[Analytics] Failed to fetch analytics:", error?.message);
    return { totalQueries: 0, faqAnswered: 0, aiAnswered: 0, escalations: 0 };
  }

  return {
    totalQueries: data.total_queries || 0,
    faqAnswered:  data.faq_answered  || 0,
    aiAnswered:   data.ai_answered   || 0,
    escalations:  data.escalations   || 0,
  };
}

// ============================================================
// getEscalations() - async, must be awaited by callers
// ============================================================
async function getEscalations() {
  const { data, error } = await supabase
    .from("escalations")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[Escalation] Failed to fetch escalations:", error.message);
    return [];
  }

  return (data || []).map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    issue: row.issue,
    status: row.status,
    conversationHistory: row.conversation_history || [],
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  }));
}

module.exports = { increment, addEscalation, getAnalytics, getEscalations };