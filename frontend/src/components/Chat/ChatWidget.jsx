// ============================================================
// components/Chat/ChatWidget.jsx
// The floating launcher button that toggles the chat window
// This is the only component you need to embed on any webpage
// ============================================================

import React, { useState } from 'react';
import ChatWindow from './ChatWindow';
import '../../styles/ChatWidget.css';

function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);

  const toggleChat = () => setIsOpen(prev => !prev);

  return (
    <>
      {/* Chat Window — rendered when open */}
      {isOpen && <ChatWindow onClose={() => setIsOpen(false)} />}

      {/* Floating launcher button */}
      <button
        className="chat-launcher"
        onClick={toggleChat}
        aria-label={isOpen ? 'Close chat' : 'Open chat'}
        aria-expanded={isOpen}
      >
        {isOpen ? (
          /* Close (X) icon */
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        ) : (
          /* Chat bubble icon */
          <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z" />
          </svg>
        )}
      </button>
    </>
  );
}

export default ChatWidget;
