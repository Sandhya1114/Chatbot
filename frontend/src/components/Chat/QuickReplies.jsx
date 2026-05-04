// ============================================================
// components/Chat/QuickReplies.jsx
// ============================================================

import React, { useEffect, useState } from "react";
import { fetchQuickReplies } from "../../utils/api";

function QuickReplies({ onSelect, showInitial, suggestions = [] }) {
  const [initialFaqs, setInitialFaqs] = useState([]);

  useEffect(() => {
    fetchQuickReplies()
      .then((data) => {
        const list = Array.isArray(data)
          ? data
          : Array.isArray(data?.faqs)
            ? data.faqs
            : [];
        setInitialFaqs(list);
      })
      .catch(() => setInitialFaqs([]));
  }, []);

  if (showInitial && initialFaqs.length > 0) {
    return (
      <div className="quick-replies">
        <p className="quick-replies__label">💡 Common Questions</p>
        <div className="quick-replies__list">
          {initialFaqs.map((faq) => (
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

  if (!showInitial && suggestions.length > 0) {
    return (
      <div className="quick-replies">
        <p className="quick-replies__label">🔗 You might also want to know</p>
        <div className="quick-replies__list">
          {suggestions.map((faq) => (
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

  return null;
}

export default QuickReplies;