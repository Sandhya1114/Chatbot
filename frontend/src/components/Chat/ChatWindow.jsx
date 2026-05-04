// ============================================================
// components/Chat/ChatWindow.jsx
// ============================================================

import React, { useRef, useEffect, useState } from "react";
import MessageBubble from "./MessageBubble";
import QuickReplies from "./QuickReplies";
import ChatInput from "./ChatInput";
import EscalationModal from "./EscalationModal";
import { useChat } from "../../hooks/useChat";
import "../../styles/ChatWidget.css";
import "../../styles/ChatBody.css";

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
  const [activeNav, setActiveNav] = useState("home");
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const userHasSent = messages.some((m) => m.role === "user");

  return (
    <>
      <div className="chat-window" role="dialog" aria-label="Customer Support Chat">

        {/* ---- Header ---- */}
        <div className="chat-header">
          <div className="chat-header__avatar-wrap">
            <div className="chat-header__avatar" aria-hidden="true">
              {/* Default avatar icon — swap the contents for an <img> if you have a real photo */}
              <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
                <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
              </svg>
            </div>
            <div className="chat-header__online-dot" aria-hidden="true" />
          </div>

          <div className="chat-header__info">
            <div className="chat-header__title">Support Team</div>
            <div className="chat-header__status">
              <span className="chat-header__status-dot" aria-hidden="true" />
              {isLoading ? "Restoring your chat…" : "Online"}
            </div>
          </div>

          {/* New Chat */}
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

          {/* Escalate to human */}
          <button
            className="btn-escalate-header"
            onClick={() => setShowEscalation(true)}
            aria-label="Talk to a human agent"
          >
            👤 Human
          </button>

          {/* Three-dot menu / close */}
          <button
            className="chat-header__menu"
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
          {isLoading && (
            <div className="chat-welcome" style={{ opacity: 0.6 }}>
              <span className="chat-welcome__emoji">⏳</span>
              <h3 className="chat-welcome__title">Restoring your conversation…</h3>
              <p className="chat-welcome__subtitle">Just a moment.</p>
            </div>
          )}

          {!isLoading && messages.length === 0 && (
            <div className="chat-welcome">
              <span className="chat-welcome__emoji">👋</span>
              <h3 className="chat-welcome__title">Hi there! How can I help?</h3>
              <p className="chat-welcome__subtitle">
                Ask me anything, or choose a common question below.
                <br />I'm here to help 24/7!
              </p>
            </div>
          )}

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

          {!isLoading &&
            messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)}

          {isTyping && (
            <div className="typing-indicator" aria-label="Bot is typing">
              <div className="message-avatar" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
                  <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
                </svg>
              </div>
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
        {/* {!isLoading && (
          <QuickReplies
            showInitial={!userHasSent}
            suggestions={suggestions}
            onSelect={(question) => sendMessage(question)}
          />
        )} */}

        {/* ---- Input Bar ---- */}
        <ChatInput onSend={sendMessage} disabled={isTyping || isLoading} />

        {/* ---- Powered-by footer ---- */}
        {/* <div className="chat-powered">Powered by AI Assistant</div> */}

        {/* ---- Bottom Navigation ---- */}
        {/* <nav className="chat-bottom-nav" aria-label="Chat navigation">
          {[
            {
              id: "home",
              label: "Home",
              icon: (
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
                </svg>
              ),
            },
            {
              id: "messages",
              label: "Messages",
              icon: (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                </svg>
              ),
            },
            {
              id: "search",
              label: "Search",
              icon: (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              ),
            },
            {
              id: "profile",
              label: "Profile",
              icon: (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              ),
            },
          ].map((item) => (
            <button
              key={item.id}
              className={`chat-nav-item${activeNav === item.id ? " active" : ""}`}
              onClick={() => setActiveNav(item.id)}
              aria-label={item.label}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav> */}
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