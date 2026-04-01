

import React, { useRef, useEffect, useState } from 'react';
import MessageBubble from './MessageBubble';
import QuickReplies from './QuickReplies';
import ChatInput from './ChatInput';
import EscalationModal from './EscalationModal';
import { useChat } from '../../hooks/useChat';
import '../../styles/ChatWidget.css';
import '../../styles/ChatBody.css';

function ChatWindow({ onClose }) {
  const { messages, isTyping, sendMessage, conversationHistory } = useChat();
  const [showEscalation, setShowEscalation] = useState(false);
  const messagesEndRef = useRef(null);

  // Auto-scroll to bottom whenever messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // Show quick replies until the user has sent their first message
  const userHasSent = messages.some(m => m.role === 'user');
  const showQuickReplies = !userHasSent;

  return (
    <>
      <div className="chat-window" role="dialog" aria-label="Customer Support Chat">

        {/* ---- Header ---- */}
        <div className="chat-header">
          <div className="chat-header__avatar" aria-hidden="true">🤖</div>
          <div className="chat-header__info">
            <div className="chat-header__title">Support Assistant</div>
            <div className="chat-header__status">
              <span className="status-dot" aria-hidden="true" />
              Online · Typically replies instantly
            </div>
          </div>

          {/* Talk to Human button */}
          <button
            className="btn-escalate-header"
            onClick={() => setShowEscalation(true)}
            aria-label="Talk to a human agent"
          >
            👤 Human
          </button>

          {/* Close button */}
          <button
            className="chat-header__close"
            onClick={onClose}
            aria-label="Close chat"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        {/* ---- Message List ---- */}
        <div className="chat-messages" role="log" aria-live="polite" aria-label="Chat messages">
          {/* Welcome message shown when no messages yet */}
          {messages.length === 0 && (
            <div className="chat-welcome">
              <span className="chat-welcome__emoji">👋</span>
              <h3 className="chat-welcome__title">Hello! How can I help?</h3>
              <p className="chat-welcome__subtitle">
                Ask me anything, or choose a common question below.
                <br />I'm here to help 24/7!
              </p>
            </div>
          )}

          {/* Render all messages */}
          {messages.map(msg => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {/* Typing indicator */}
          {isTyping && (
            <div className="typing-indicator" aria-label="Bot is typing">
              <div className="message-avatar" aria-hidden="true">🤖</div>
              <div className="typing-dots">
                <span /><span /><span />
              </div>
            </div>
          )}

          {/* Invisible anchor to scroll to */}
          <div ref={messagesEndRef} />
        </div>

        {/* ---- Quick Reply FAQ Buttons ---- */}
        <QuickReplies
          visible={showQuickReplies}
          onSelect={(question) => sendMessage(question)}
        />

        {/* ---- Input Bar ---- */}
        <ChatInput onSend={sendMessage} disabled={isTyping} />
      </div>

      {/* ---- Escalation Modal (rendered on top) ---- */}
      {showEscalation && (
        <EscalationModal
          onClose={() => setShowEscalation(false)}
          conversationHistory={conversationHistory}
        />
      )}
    </>
  );
}

export default ChatWindow;