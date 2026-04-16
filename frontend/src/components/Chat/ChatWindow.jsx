// ============================================================
// components/Chat/ChatWindow.jsx — with Persistent History
// ============================================================

import React, { useRef, useEffect, useState } from "react";
import MessageBubble from "./MessageBubble";
import QuickReplies from "./QuickReplies";
import ChatInput from "./ChatInput";
import EscalationModal from "./EscalationModal";
import { useChat } from "../../hooks/useChat";
import "../../styles/ChatWidget.css";
import "../../styles/ChatBody.css";

// appId: namespace for this embed — pass from ChatWidget
function ChatWindow({ onClose, appId = "default" }) {
  const {
    messages,
    isTyping,
    isLoading,
    suggestions,
    sendMessage,
    clearMessages,
    conversationHistory,
  } = useChat(appId);

  const [showEscalation, setShowEscalation] = useState(false);
  const messagesEndRef = useRef(null);

  // Auto-scroll to bottom on new messages or typing
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const userHasSent = messages.some((m) => m.role === "user");

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
              {isLoading ? "" : "Online · "}
            </div>
          </div>

          {/* New Chat button — clears history and starts fresh */}
          {messages.length > 0 && !isLoading && (
            <button
              className="btn-escalate-header"
              onClick={clearMessages}
              aria-label="Start a new chat"
              title="Clear history and start fresh"
              style={{ marginRight: 4 }}
            >
              🔄 New
            </button>
          )}

          <button
            className="btn-escalate-header"
            onClick={() => setShowEscalation(true)}
            aria-label="Talk to a human agent"
          >
            👤 Human
          </button>

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
        <div
          className="chat-messages"
          role="log"
          aria-live="polite"
          aria-label="Chat messages"
        >
          {/* ---- Loading skeleton while restoring history ---- */}
          {isLoading && (
            <div className="chat-welcome" style={{ opacity: 0.6 }}>
              <span className="chat-welcome__emoji">⏳</span>
              <h3 className="chat-welcome__title">Restoring your conversation…</h3>
              <p className="chat-welcome__subtitle">Just a moment.</p>
            </div>
          )}

          {/* ---- Welcome screen (new session, no messages) ---- */}
          {!isLoading && messages.length === 0 && (
            <div className="chat-welcome">
              <span className="chat-welcome__emoji">👋</span>
              <h3 className="chat-welcome__title">Hello! How can I help?</h3>
              <p className="chat-welcome__subtitle">
                Ask me anything, or choose a common question below.
                <br />I&apos;m here to help 24/7!
              </p>
            </div>
          )}

          {/* ---- Restored history banner ---- */}
          {!isLoading && messages.length > 0 && !userHasSent && (
            <div
              style={{
                textAlign: "center",
                fontSize: 11,
                color: "var(--color-text-muted)",
                padding: "4px 0 8px",
              }}
            >
              💬 Your previous conversation has been restored
            </div>
          )}

          {/* ---- Messages ---- */}
          {!isLoading &&
            messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)}

          {/* ---- Typing indicator ---- */}
          {isTyping && (
            <div className="typing-indicator" aria-label="Bot is typing">
              <div className="message-avatar" aria-hidden="true">🤖</div>
              <div className="typing-dots">
                <span />
                <span />
                <span />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* ---- Quick Replies ---- */}
        {!isLoading && (
          <QuickReplies
            showInitial={!userHasSent}
            suggestions={suggestions}
            onSelect={(question) => sendMessage(question)}
          />
        )}

        {/* ---- Input Bar ---- */}
        <ChatInput onSend={sendMessage} disabled={isTyping || isLoading} />
      </div>

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