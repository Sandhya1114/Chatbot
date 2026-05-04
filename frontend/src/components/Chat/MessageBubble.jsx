// ============================================================
// components/Chat/MessageBubble.jsx
//
// Renders a single chat message (user or bot).
//
// message shape:
//   {
//     id:        string
//     role:      'user' | 'bot'
//     content:   string              — plain text / markdown-lite
//     source?:   'faq' | 'ai'
//     timestamp: number | string
//     cards?:    Array<{             — optional rich feature cards
//       icon:     string             — emoji or text icon
//       iconType: 'teal'|'purple'|'amber'  — color theme
//       title:    string
//       subtitle: string
//     }>
//   }
// ============================================================

import React from "react";
import { formatTime } from "../../utils/api";

function MessageBubble({ message }) {
  const isUser = message.role === "user";

  // Render inline markdown (bold + newlines)
  const formatContent = (text) => {
    if (!text) return "";
    return text
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\n/g, "<br />");
  };

  return (
    <div className={`message-row message-row--${isUser ? "user" : "bot"}`}>
      {/* Bot avatar */}
      {!isUser && (
        <div className="message-avatar" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
            <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
          </svg>
        </div>
      )}

      <div className="message-bubble-wrap">
        {/* Source badge */}
        {!isUser && message.source && (
          <span
            className={`message-source-badge message-source-badge--${message.source}`}
          >
            {message.source === "faq" ? "📚 FAQ" : "✨ AI"}
          </span>
        )}

        {/* Bubble */}
        <div
          className={`message-bubble message-bubble--${isUser ? "user" : "bot"}`}
          aria-label={`${isUser ? "You" : "Bot"}: ${message.content}`}
        >
          {/* Text content */}
          <span
            dangerouslySetInnerHTML={{ __html: formatContent(message.content) }}
          />

          {/* Feature cards — shown inside bot bubbles when message.cards is set */}
          {!isUser && message.cards && message.cards.length > 0 && (
            <div className="feature-cards" role="list">
              {message.cards.map((card, idx) => (
                <div className="feature-card" key={idx} role="listitem">
                  <div
                    className={`feature-card__icon feature-card__icon--${
                      card.iconType || "teal"
                    }`}
                    aria-hidden="true"
                  >
                    {card.icon}
                  </div>
                  <div>
                    <div className="feature-card__title">{card.title}</div>
                    {card.subtitle && (
                      <div className="feature-card__subtitle">{card.subtitle}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Timestamp */}
        <span className="message-time">{formatTime(message.timestamp)}</span>
      </div>
    </div>
  );
}

export default MessageBubble;