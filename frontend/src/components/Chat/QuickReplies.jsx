// ============================================================
// components/Chat/QuickReplies.jsx
//
// Two modes:
//   1. INITIAL mode (no messages sent yet):
//      Fetches all FAQs from /api/chat/faqs and shows them as
//      tappable buttons. Disappears once the user sends anything.
//
//   2. CONTEXTUAL mode (after each bot reply):
//      Shows the "suggestions" returned by the backend — related
//      FAQs ranked by relevance to what the user just asked.
//      Replaces itself on every new reply, stays visible throughout
//      the conversation so the user always has something to tap.
// ============================================================

import React, { useEffect, useState } from 'react';
import { fetchQuickReplies } from '../../utils/api';

function QuickReplies({ onSelect, showInitial, suggestions = [] }) {
  const [initialFaqs, setInitialFaqs] = useState([]);

  // Load the full FAQ list once for the initial state
  useEffect(() => {
    fetchQuickReplies()
      .then(data => {
        const list = Array.isArray(data)
          ? data
          : Array.isArray(data?.faqs)
          ? data.faqs
          : [];
        setInitialFaqs(list);
      })
      .catch(() => setInitialFaqs([]));
  }, []);

  // ── INITIAL mode: show all FAQs before first message ──
  if (showInitial && initialFaqs.length > 0) {
    return (
      <div className="quick-replies">
        <p className="quick-replies__label">💡 Common Questions</p>
        <div className="quick-replies__list">
          {initialFaqs.map(faq => (
            <button
              key={faq.id}
              className="quick-reply-btn"
              onClick={() => onSelect(faq.question)}
              title={faq.question}
            >
              {faq.question}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── CONTEXTUAL mode: show related suggestions after each reply ──
  if (!showInitial && suggestions.length > 0) {
    return (
      <div className="quick-replies">
        <p className="quick-replies__label">🔗 You might also want to know</p>
        <div className="quick-replies__list">
          {suggestions.map(faq => (
            <button
              key={faq.id}
              className="quick-reply-btn"
              onClick={() => onSelect(faq.question)}
              title={faq.question}
            >
              {faq.question}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Nothing to show
  return null;
}

export default QuickReplies;