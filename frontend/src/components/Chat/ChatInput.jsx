// ============================================================
// components/Chat/ChatInput.jsx
// Pill-shaped input bar with optional attach button and teal send button
// ============================================================

import React, { useRef, useEffect } from "react";

function ChatInput({ onSend, disabled, showAttach = false }) {
  const [value, setValueState] = React.useState("");
  const textareaRef = useRef(null);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }, [value]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValueState("");
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="chat-input-bar">
      <form className="chat-input-form" onSubmit={handleSubmit}>
        {/* Optional attach button */}
        {showAttach && (
          <button
            type="button"
            className="chat-attach-btn"
            aria-label="Attach file"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="16" />
              <line x1="8" y1="12" x2="16" y2="12" />
            </svg>
          </button>
        )}

        <textarea
          ref={textareaRef}
          className="chat-input"
          value={value}
          onChange={(e) => setValueState(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
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
          {/* Paper-plane send icon */}
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </form>
    </div>
  );
}

export default ChatInput;