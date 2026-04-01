// ============================================================
// utils/api.js - API Helper Functions
// All fetch calls to the backend are centralized here.
// ============================================================

const BASE_URL = process.env.REACT_APP_API_URL || '';

// Generic fetch wrapper with error handling
async function apiFetch(endpoint, options = {}) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  return data;
}

// ---- Chat API ----
export const sendChatMessage = (message, conversationHistory) =>
  apiFetch('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message, conversationHistory }),
  });

// ---- FAQ API ----
export const fetchQuickReplies = () =>
  apiFetch('/api/chat/faqs');

// ---- Escalation API ----
export const submitEscalation = (payload) =>
  apiFetch('/api/escalate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

// ---- Admin API ----
export const fetchAnalytics = () =>
  apiFetch('/api/admin/analytics');

export const fetchAdminFAQs = () =>
  apiFetch('/api/admin/faqs');

export const uploadFAQs = (faqs) =>
  apiFetch('/api/admin/faqs/upload', {
    method: 'POST',
    body: JSON.stringify(faqs),
  });

export const deleteFAQ = (id) =>
  apiFetch(`/api/admin/faqs/${id}`, { method: 'DELETE' });

// ---- Helper: Format timestamp ----
export const formatTime = (isoString) => {
  if (!isoString) return '';
  return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export const formatDateTime = (isoString) => {
  if (!isoString) return '';
  return new Date(isoString).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};
