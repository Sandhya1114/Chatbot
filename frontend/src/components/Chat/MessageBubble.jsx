// ============================================================
// components/Chat/MessageBubble.jsx
// Renders a single chat message (user or bot)
// ============================================================

import React from 'react';
import { formatTime } from '../../utils/api';

function MessageBubble({ message }) {
  const isUser = message.role === 'user';

  const escapeHtml = (text) =>
    String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  // Format markdown-like bold (**text**) and newlines for display
  const formatContent = (text) => {
    if (!text) return '';
    return escapeHtml(text)
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // **bold**
      .replace(/\n/g, '<br />');                          // line breaks
  };

  return (
    <div className={`message-row message-row--${isUser ? 'user' : 'bot'}`}>
      {/* Bot avatar — only shown for bot messages */}
      {!isUser && (
        <div className="message-avatar" aria-hidden="true">🤖</div>
      )}

      <div className="message-bubble-wrap">
        {/* Source badge for bot messages (FAQ or AI) */}
        {!isUser && message.source && (
          <span className={`message-source-badge message-source-badge--${message.source}`}>
            {message.source === 'faq' ? '📚 FAQ' : '✨ AI'}
          </span>
        )}

        {/* The message bubble itself */}
        <div
          className={`message-bubble message-bubble--${isUser ? 'user' : 'bot'}`}
          dangerouslySetInnerHTML={{ __html: formatContent(message.content) }}
          aria-label={`${isUser ? 'You' : 'Bot'}: ${message.content}`}
        />

        {!isUser && message.sourceUrl && (
          <a
            className="message-source-link"
            href={message.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            View source
          </a>
        )}

        {/* Timestamp */}
        <span className="message-time">
          {formatTime(message.timestamp)}
        </span>
      </div>
    </div>
  );
}

export default MessageBubble;
