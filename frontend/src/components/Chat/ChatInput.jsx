import React, { useRef, useEffect } from 'react';

function ChatInput({ onSend, disabled }) {
  const [value, setValueState] = React.useState('');
  const textareaRef = useRef(null);

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
        />
        <button
          type="submit"
          className="chat-send-btn"
          disabled={!value.trim() || disabled}
        >
          ➤
        </button>
      </form>
    </div>
  );
}

export default ChatInput;