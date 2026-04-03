// ============================================================
// components/Chat/ChatWidget.jsx — Embeddable Library Entry Point
//
// This is the ONE component you drop into any app.
//
// Props:
//   appId  (string) — namespace for this embed. Use a unique
//                     identifier per product that embeds this
//                     widget so sessions don't cross-contaminate.
//                     Default: "default"
//
// Usage:
//   <ChatWidget />                        // single app
//   <ChatWidget appId="my-saas-app" />   // multi-tenant
// ============================================================

import React, { useState } from "react";
import ChatWindow from "./ChatWindow";
import "../../styles/ChatWidget.css";

function ChatWidget({ appId = "default" }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {isOpen && (
        <ChatWindow onClose={() => setIsOpen(false)} appId={appId} />
      )}

      <button
        className="chat-launcher"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={isOpen ? "Close chat" : "Open chat"}
        aria-expanded={isOpen}
      >
        {isOpen ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        ) : (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z" />
          </svg>
        )}
      </button>
    </>
  );
}

export default ChatWidget;