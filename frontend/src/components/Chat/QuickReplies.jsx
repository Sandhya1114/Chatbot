// ============================================================
// components/Chat/QuickReplies.jsx
// Shows FAQ quick-reply buttons the user can tap
// ============================================================

import React, { useEffect, useState } from 'react';
import { fetchQuickReplies } from '../../utils/api';

function QuickReplies({ onSelect, visible }) {
  const [faqs, setFaqs] = useState([]);

  // Load FAQs from the backend on mount
  useEffect(() => {
    fetchQuickReplies()
      .then(data => {
        // Handle both shapes: { faqs: [...] } or plain array
        const list = Array.isArray(data) ? data : (Array.isArray(data?.faqs) ? data.faqs : []);
        setFaqs(list);
      })
      .catch(() => setFaqs([]));
  }, []);

  // Don't render if hidden or no FAQs loaded
  if (!visible || faqs.length === 0) return null;

  return (
    <div className="quick-replies">
      <p className="quick-replies__label">💡 Common Questions</p>
      <div className="quick-replies__list">
        {faqs.map(faq => (
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

export default QuickReplies;