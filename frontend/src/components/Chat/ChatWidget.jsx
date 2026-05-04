// ============================================================
// components/Chat/ChatWidget.jsx — Embeddable Library Entry Point
//
// Props:
//   appId  (string) — namespace for this embed.
//   showPill (bool) — show the "Need help? We're online" pill.
//                     Default: true
// ============================================================

import React, { useState } from "react";
import ChatWindow from "./ChatWindow";
import "../../styles/ChatWidget.css";

function ChatWidget({ appId = "default", showPill = true }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {isOpen && (
        <ChatWindow onClose={() => setIsOpen(false)} appId={appId} />
      )}

      {/* "Need help? We're online" helper pill */}
      {!isOpen && showPill && (
        <div className="chat-launcher-pill">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          Need help?
          <span className="chat-launcher-pill__label">We're online</span>
        </div>
      )}

      {/* Main launcher button */}
      <button
        className="chat-launcher"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={isOpen ? "Close chat" : "Open chat"}
        aria-expanded={isOpen}
      >
        {isOpen ? (
          /* Close icon */
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        ) : (
          /* Chat icon */
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
        )}
        {!isOpen && "Chat with us"}
      </button>
    </>
  );
}

export default ChatWidget;