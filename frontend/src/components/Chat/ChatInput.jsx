// ============================================================
// components/Chat/ChatInput.jsx
// Message input bar with auto-resize textarea and send button
// ============================================================

import React, { useRef, useEffect } from 'react';

function ChatInput({ onSend, disabled }) {
  const [value, setValueState] = React.useState('');
  const textareaRef = useRef(null);

  // Auto-resize textarea as user types
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  }, [value]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValueState('');
  };

  // Allow Enter to send (Shift+Enter for new line)
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="chat-input-bar">
      <form className="chat-input-form" onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
          className="chat-input"
          value={value}
          onChange={e => setValueState(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message…"
          disabled={disabled}
          rows={1}
          aria-label="Type your message"
        />
        <button
          type="submit"
          className="chat-send-btn"
          disabled={!value.trim() || disabled}
          aria-label="Send message"
        >
          {/* Send icon SVG */}
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </form>
    </div>
  );
}

export default ChatInput;
