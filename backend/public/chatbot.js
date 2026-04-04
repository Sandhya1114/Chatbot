/*!
 * chatbot.js — Embed Library v2.0.0
 * Drop-in chat widget. Preserves all original React app functionality.
 *
 * Usage:
 *   <script src="chatbot.js"></script>
 *   <script>
 *     initChatbot({
 *       apiUrl: "https://your-backend.com",
 *       appId:  "my-app",
 *       theme:  { primary: "#4f46e5" },
 *       bot:    { name: "Aria", avatar: "🤖", status: "Online · Typically replies instantly" }
 *     });
 *   </script>
 *
 * All functionality from original React app preserved:
 *   ✅ Persistent session history (localStorage + Supabase via backend)
 *   ✅ FAQ quick-replies (initial) + contextual suggestions (after each reply)
 *   ✅ Source badges (📚 FAQ / ✨ AI)
 *   ✅ Typing indicator with animated dots
 *   ✅ Human escalation modal (name, email, issue → POST /api/escalate)
 *   ✅ New Chat button (clears remote + local history, new sessionId)
 *   ✅ "Previous conversation restored" banner
 *   ✅ Auto-resize textarea, Enter-to-send, Shift+Enter for newline
 *   ✅ Mobile full-screen responsive
 *   ✅ All original CSS variables + animations
 */

(function (global) {
  "use strict";

  if (global.__chatbotLoaded) return;
  global.__chatbotLoaded = true;

  // ─────────────────────────────────────────────────────────────
  // DEFAULT CONFIG — matches original React app defaults exactly
  // ─────────────────────────────────────────────────────────────
  var DEFAULTS = {
    apiUrl:   "",
    appId:    "default",
    position: "bottom-right",
    bot: {
      name:   "Support Assistant",
      avatar: "🤖",
      status: "Online · Typically replies instantly",
    },
    launcher: { size: 60 },
    theme: {
      primary:      "#4f46e5",
      primaryDark:  "#3730a3",
      primaryLight: "#818cf8",
      accent:       "#06b6d4",
      success:      "#10b981",
      warning:      "#f59e0b",
      danger:       "#ef4444",
      bg:           "#f8fafc",
      card:         "#ffffff",
      chatBg:       "#f1f5f9",
      border:       "#e2e8f0",
      borderLight:  "#f1f5f9",
      textPrimary:  "#0f172a",
      textSecondary:"#475569",
      textMuted:    "#94a3b8",
      userBubble:   "#4f46e5",
      userText:     "#ffffff",
      botBubble:    "#ffffff",
      botText:      "#0f172a",
      faqBadge:     "#e0e7ff",
      faqText:      "#4f46e5",
    },
  };

  // ─────────────────────────────────────────────────────────────
  // UTILS
  // ─────────────────────────────────────────────────────────────
  function mergeConfig(user) {
    var cfg = JSON.parse(JSON.stringify(DEFAULTS));
    if (!user) return cfg;
    if (user.apiUrl)    cfg.apiUrl   = user.apiUrl.replace(/\/$/, "");
    if (user.appId)     cfg.appId    = user.appId;
    if (user.position)  cfg.position = user.position;
    if (user.theme)     Object.assign(cfg.theme, user.theme);
    if (user.bot)       Object.assign(cfg.bot, user.bot);
    if (user.launcher)  Object.assign(cfg.launcher, user.launcher);
    return cfg;
  }

  function uuid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function fmtTime(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch (e) { return ""; }
  }

  function sanitize(str) {
    var d = document.createElement("div");
    d.textContent = str || "";
    return d.innerHTML;
  }

  // Matches original formatContent in MessageBubble.jsx
  function formatContent(text) {
    if (!text) return "";
    return sanitize(text)
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\n/g, "<br>");
  }

  // Session persistence — matches useChat.js exactly
  function getStorageKey(appId) { return "chatbot_session_" + appId; }

  function getOrCreateSessionId(appId) {
    var key = getStorageKey(appId);
    try {
      var existing = localStorage.getItem(key);
      if (existing) return existing;
      var id = uuid();
      localStorage.setItem(key, id);
      return id;
    } catch (e) {
      return uuid();
    }
  }

  function persistSessionId(appId, id) {
    try { localStorage.setItem(getStorageKey(appId), id); } catch (e) {}
  }

  // ─────────────────────────────────────────────────────────────
  // API LAYER — mirrors utils/api.js exactly
  // ─────────────────────────────────────────────────────────────
  function makeApi(cfg) {
    function apiFetch(path, opts) {
      opts = opts || {};
      return fetch(cfg.apiUrl + path, {
        headers: Object.assign({ "Content-Type": "application/json" }, opts.headers || {}),
        method:  opts.method || "GET",
        body:    opts.body,
      }).then(function (r) {
        return r.json().then(function (data) {
          if (!r.ok) throw new Error(data.error || "HTTP " + r.status);
          return data;
        });
      });
    }

    return {
      // GET /api/chat/history — restore session on open (useChat.js restoreHistory)
      fetchHistory: function (sessionId, appId) {
        return apiFetch(
          "/api/chat/history?sessionId=" + encodeURIComponent(sessionId) +
          "&appId=" + encodeURIComponent(appId)
        );
      },
      // POST /api/chat — send message (useChat.js sendMessage)
      sendMessage: function (message, sessionId, appId, conversationHistory) {
        return apiFetch("/api/chat", {
          method: "POST",
          body: JSON.stringify({ message: message, sessionId: sessionId, appId: appId, conversationHistory: conversationHistory }),
        });
      },
      // GET /api/chat/faqs — initial quick-reply buttons (QuickReplies.jsx)
      fetchFAQs: function () {
        return apiFetch("/api/chat/faqs");
      },
      // DELETE /api/chat/history — clear session (useChat.js clearMessages)
      clearHistory: function (sessionId) {
        return apiFetch("/api/chat/history", {
          method: "DELETE",
          body: JSON.stringify({ sessionId: sessionId }),
        });
      },
      // POST /api/escalate — submit escalation (EscalationModal.jsx)
      escalate: function (payload) {
        return apiFetch("/api/escalate", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      },
    };
  }

  // ─────────────────────────────────────────────────────────────
  // INJECT STYLES — all from global.css + ChatWidget.css +
  //                 ChatBody.css + EscalationModal.css
  // ─────────────────────────────────────────────────────────────
  function injectStyles(cfg) {
    if (document.getElementById("cb-styles")) return;
    var t = cfg.theme;
    var isLeft = cfg.position === "bottom-left";
    var launcherPos = isLeft ? "left:28px;" : "right:28px;";
    var windowPos   = isLeft ? "left:28px;" : "right:28px;";

    var css = [
      "@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=JetBrains+Mono:wght@400;500&display=swap');",

      /* CSS Variables — matches global.css exactly */
      ":root{",
      "--cb-primary:"        + t.primary        + ";",
      "--cb-primary-dark:"   + t.primaryDark    + ";",
      "--cb-primary-light:"  + t.primaryLight   + ";",
      "--cb-accent:"         + t.accent         + ";",
      "--cb-success:"        + t.success        + ";",
      "--cb-warning:"        + t.warning        + ";",
      "--cb-danger:"         + t.danger         + ";",
      "--cb-bg:"             + t.bg             + ";",
      "--cb-card:"           + t.card           + ";",
      "--cb-chat-bg:"        + t.chatBg         + ";",
      "--cb-border:"         + t.border         + ";",
      "--cb-border-light:"   + t.borderLight    + ";",
      "--cb-text:"           + t.textPrimary    + ";",
      "--cb-text-secondary:" + t.textSecondary  + ";",
      "--cb-muted:"          + t.textMuted      + ";",
      "--cb-user-bubble:"    + t.userBubble     + ";",
      "--cb-user-text:"      + t.userText       + ";",
      "--cb-bot-bubble:"     + t.botBubble      + ";",
      "--cb-bot-text:"       + t.botText        + ";",
      "--cb-faq-badge:"      + t.faqBadge       + ";",
      "--cb-faq-text:"       + t.faqText        + ";",
      "--cb-font:'DM Sans',-apple-system,BlinkMacSystemFont,sans-serif;",
      "--cb-mono:'JetBrains Mono','Courier New',monospace;",
      "--cb-r-sm:6px;--cb-r-md:12px;--cb-r-lg:16px;--cb-r-xl:24px;--cb-r-full:9999px;",
      "--cb-shadow-sm:0 1px 3px rgba(0,0,0,.06),0 1px 2px rgba(0,0,0,.04);",
      "--cb-shadow-md:0 4px 6px -1px rgba(0,0,0,.08),0 2px 4px -2px rgba(0,0,0,.06);",
      "--cb-shadow-xl:0 20px 25px -5px rgba(0,0,0,.12),0 8px 10px -6px rgba(0,0,0,.08);",
      "--cb-shadow-chat:0 25px 50px -12px rgba(79,70,229,.25);",
      "--cb-tr-fast:150ms ease;--cb-tr-base:250ms ease;",
      "}",

      /* Reset scoped to chatbot elements */
      "#cb-launcher,#cb-root,#cb-modal,",
      "#cb-launcher *,#cb-root *,#cb-modal *{box-sizing:border-box;margin:0;padding:0;font-family:var(--cb-font);}",

      /* ── LAUNCHER — matches ChatWidget.css .chat-launcher ── */
      "#cb-launcher{",
      "position:fixed;bottom:28px;" + launcherPos,
      "width:" + cfg.launcher.size + "px;height:" + cfg.launcher.size + "px;",
      "border-radius:var(--cb-r-full);",
      "background:linear-gradient(135deg,var(--cb-primary),var(--cb-primary-dark));",
      "color:#fff;border:none;cursor:pointer;",
      "display:flex;align-items:center;justify-content:center;",
      "box-shadow:var(--cb-shadow-chat);",
      "transition:transform var(--cb-tr-base),box-shadow var(--cb-tr-base);",
      "z-index:1000;animation:cb-slideUp .4s ease;}",
      "#cb-launcher:hover{transform:scale(1.08) translateY(-2px);box-shadow:0 30px 60px -10px rgba(79,70,229,.4);}",
      "#cb-launcher:active{transform:scale(.96);}",
      "#cb-launcher svg{width:26px;height:26px;transition:transform var(--cb-tr-base);}",

      /* ── CHAT WINDOW — matches ChatWidget.css .chat-window ── */
      "#cb-root{",
      "position:fixed;bottom:100px;" + windowPos,
      "width:390px;height:580px;",
      "background:var(--cb-card);border-radius:var(--cb-r-xl);",
      "box-shadow:var(--cb-shadow-xl),0 0 0 1px rgba(0,0,0,.04);",
      "display:flex;flex-direction:column;overflow:hidden;",
      "z-index:1000;animation:cb-pop .35s cubic-bezier(.34,1.56,.64,1);}",
      "#cb-root.cb-hidden{display:none;}",

      /* ── HEADER — matches ChatWidget.css .chat-header ── */
      ".cb-header{",
      "background:linear-gradient(135deg,var(--cb-primary) 0%,var(--cb-primary-dark) 100%);",
      "padding:16px 24px;display:flex;align-items:center;gap:16px;",
      "flex-shrink:0;position:relative;overflow:hidden;}",
      ".cb-header::before{content:'';position:absolute;top:-30px;right:-20px;",
      "width:100px;height:100px;border-radius:50%;background:rgba(255,255,255,.08);}",
      ".cb-header::after{content:'';position:absolute;bottom:-40px;right:60px;",
      "width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,.05);}",

      ".cb-avatar{width:42px;height:42px;border-radius:var(--cb-r-full);",
      "background:rgba(255,255,255,.2);border:2px solid rgba(255,255,255,.3);",
      "display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;}",
      ".cb-header-info{flex:1;min-width:0;}",
      ".cb-header-name{font-size:16px;font-weight:700;color:#fff;line-height:1.2;letter-spacing:-.01em;}",
      ".cb-header-status{font-size:12px;color:rgba(255,255,255,.75);display:flex;align-items:center;gap:4px;margin-top:2px;}",
      ".cb-status-dot{width:7px;height:7px;border-radius:50%;background:#4ade80;",
      "box-shadow:0 0 0 2px rgba(74,222,128,.3);animation:cb-pulse 2s infinite;flex-shrink:0;}",

      /* Header buttons — matches .btn-escalate-header */
      ".cb-header-btn{padding:4px 8px;border-radius:var(--cb-r-full);",
      "background:rgba(255,255,255,.15);color:#fff;font-size:12px;font-weight:600;",
      "border:1px solid rgba(255,255,255,.25);cursor:pointer;",
      "display:flex;align-items:center;gap:4px;",
      "transition:background var(--cb-tr-fast);white-space:nowrap;}",
      ".cb-header-btn:hover{background:rgba(255,255,255,.25);}",
      ".cb-close-btn{width:32px;height:32px;border-radius:var(--cb-r-full);",
      "background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.2);",
      "color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;",
      "flex-shrink:0;transition:background var(--cb-tr-fast);}",
      ".cb-close-btn:hover{background:rgba(255,255,255,.25);}",
      ".cb-close-btn svg{width:16px;height:16px;}",

      /* ── MESSAGES — matches ChatBody.css .chat-messages ── */
      ".cb-messages{flex:1;overflow-y:auto;padding:16px;",
      "display:flex;flex-direction:column;gap:16px;",
      "background:var(--cb-chat-bg);scroll-behavior:smooth;}",
      ".cb-messages::-webkit-scrollbar{width:6px;}",
      ".cb-messages::-webkit-scrollbar-thumb{background:var(--cb-border);border-radius:var(--cb-r-full);}",

      /* Welcome — matches .chat-welcome */
      ".cb-welcome{text-align:center;padding:16px;animation:cb-fadeIn .5s ease;}",
      ".cb-welcome-emoji{font-size:42px;display:block;margin-bottom:8px;}",
      ".cb-welcome-title{font-size:18px;font-weight:700;color:var(--cb-text);margin-bottom:4px;}",
      ".cb-welcome-sub{font-size:13px;color:var(--cb-muted);line-height:1.5;}",

      /* Restored banner */
      ".cb-restored-banner{text-align:center;font-size:11px;color:var(--cb-muted);padding:4px 0 8px;}",

      /* ── MESSAGE ROWS — matches .message-row ── */
      ".cb-msg-row{display:flex;gap:8px;animation:cb-slideUp .3s ease;}",
      ".cb-msg-row.user{flex-direction:row-reverse;}",
      ".cb-msg-avatar{width:30px;height:30px;border-radius:var(--cb-r-full);",
      "background:linear-gradient(135deg,var(--cb-primary),var(--cb-primary-dark));",
      "color:#fff;font-size:14px;display:flex;align-items:center;justify-content:center;",
      "flex-shrink:0;align-self:flex-end;}",
      ".cb-msg-wrap{max-width:80%;display:flex;flex-direction:column;gap:4px;}",
      ".cb-msg-row.user .cb-msg-wrap{align-items:flex-end;}",

      /* Source badge — matches .message-source-badge */
      ".cb-src-badge{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;",
      "border-radius:var(--cb-r-full);font-size:10px;font-weight:600;",
      "letter-spacing:.02em;text-transform:uppercase;align-self:flex-start;}",
      ".cb-src-badge.faq{background:var(--cb-faq-badge);color:var(--cb-faq-text);}",
      ".cb-src-badge.ai{background:#d1fae5;color:#065f46;}",

      /* Bubbles — matches .message-bubble */
      ".cb-bubble{padding:8px 16px;border-radius:var(--cb-r-lg);",
      "font-size:14px;line-height:1.6;word-break:break-word;}",
      ".cb-bubble.user{background:var(--cb-user-bubble);color:var(--cb-user-text);border-bottom-right-radius:var(--cb-r-sm);}",
      ".cb-bubble.bot{background:var(--cb-bot-bubble);color:var(--cb-bot-text);",
      "border-bottom-left-radius:var(--cb-r-sm);",
      "box-shadow:var(--cb-shadow-sm);border:1px solid var(--cb-border-light);}",
      ".cb-bubble.bot strong{font-weight:600;color:var(--cb-primary-dark);}",
      ".cb-time{font-size:10px;color:var(--cb-muted);padding:0 4px;}",

      /* ── TYPING — matches .typing-indicator ── */
      ".cb-typing{display:flex;align-items:center;gap:8px;animation:cb-fadeIn .3s ease;}",
      ".cb-typing-dots{display:flex;gap:4px;padding:8px 16px;",
      "background:var(--cb-bot-bubble);border-radius:var(--cb-r-lg);border-bottom-left-radius:var(--cb-r-sm);",
      "box-shadow:var(--cb-shadow-sm);border:1px solid var(--cb-border-light);}",
      ".cb-typing-dots span{width:7px;height:7px;border-radius:50%;background:var(--cb-muted);",
      "animation:cb-bounce 1.2s ease infinite;}",
      ".cb-typing-dots span:nth-child(2){animation-delay:.2s;}",
      ".cb-typing-dots span:nth-child(3){animation-delay:.4s;}",

      /* ── QUICK REPLIES — matches .quick-replies ── */
      ".cb-quick{padding:8px 16px;border-top:1px solid var(--cb-border-light);",
      "background:var(--cb-card);flex-shrink:0;}",
      ".cb-quick-label{font-size:11px;font-weight:600;color:var(--cb-muted);",
      "text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;}",
      ".cb-quick-list{display:flex;flex-wrap:wrap;gap:4px;max-height:90px;overflow-y:auto;}",
      ".cb-quick-btn{padding:4px 8px;border-radius:var(--cb-r-full);",
      "border:1.5px solid var(--cb-primary-light);background:transparent;",
      "color:var(--cb-primary);font-size:12px;font-weight:500;cursor:pointer;",
      "white-space:nowrap;max-width:200px;overflow:hidden;text-overflow:ellipsis;",
      "transition:all var(--cb-tr-fast);}",
      ".cb-quick-btn:hover{background:var(--cb-primary);color:#fff;",
      "border-color:var(--cb-primary);transform:translateY(-1px);}",

      /* ── INPUT BAR — matches .chat-input-bar ── */
      ".cb-input-bar{padding:8px 16px;border-top:1px solid var(--cb-border);",
      "background:var(--cb-card);flex-shrink:0;}",
      ".cb-input-form{display:flex;align-items:flex-end;gap:8px;",
      "background:var(--cb-chat-bg);border-radius:var(--cb-r-xl);",
      "padding:4px 4px 4px 16px;border:1.5px solid var(--cb-border);",
      "transition:border-color var(--cb-tr-fast),box-shadow var(--cb-tr-fast);}",
      ".cb-input-form:focus-within{border-color:var(--cb-primary);",
      "box-shadow:0 0 0 3px rgba(79,70,229,.1);}",
      ".cb-textarea{flex:1;border:none;background:transparent;resize:none;outline:none;",
      "font-size:14px;color:var(--cb-text);line-height:1.5;",
      "max-height:120px;min-height:36px;padding:4px 0;}",
      ".cb-textarea::placeholder{color:var(--cb-muted);}",
      ".cb-send-btn{width:36px;height:36px;border-radius:var(--cb-r-full);",
      "background:var(--cb-primary);color:#fff;border:none;cursor:pointer;",
      "display:flex;align-items:center;justify-content:center;flex-shrink:0;",
      "transition:all var(--cb-tr-fast);}",
      ".cb-send-btn:hover:not(:disabled){background:var(--cb-primary-dark);transform:scale(1.05);}",
      ".cb-send-btn:disabled{background:var(--cb-border);cursor:not-allowed;}",
      ".cb-send-btn svg{width:16px;height:16px;}",

      /* ── ESCALATION MODAL — matches EscalationModal.css ── */
      "#cb-modal{position:fixed;inset:0;background:rgba(15,23,42,.55);",
      "backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;",
      "z-index:1100;padding:16px;animation:cb-fadeIn .2s ease;}",
      "#cb-modal.cb-hidden{display:none;}",

      ".cb-modal-card{background:var(--cb-card);border-radius:var(--cb-r-xl);",
      "width:100%;max-width:420px;box-shadow:var(--cb-shadow-xl);overflow:hidden;",
      "animation:cb-pop .3s cubic-bezier(.34,1.56,.64,1);}",

      /* Modal header */
      ".cb-modal-hd{background:linear-gradient(135deg,var(--cb-primary),var(--cb-primary-dark));",
      "padding:24px 28px;color:#fff;position:relative;overflow:hidden;}",
      ".cb-modal-hd::before{content:'';position:absolute;top:-30px;right:-20px;",
      "width:120px;height:120px;border-radius:50%;background:rgba(255,255,255,.07);}",
      ".cb-modal-hd-icon{width:44px;height:44px;background:rgba(255,255,255,.2);",
      "border-radius:var(--cb-r-full);border:2px solid rgba(255,255,255,.3);",
      "display:flex;align-items:center;justify-content:center;font-size:22px;margin-bottom:8px;}",
      ".cb-modal-title{font-size:20px;font-weight:700;letter-spacing:-.02em;}",
      ".cb-modal-sub{font-size:13px;color:rgba(255,255,255,.75);margin-top:4px;}",

      /* Modal body / form — matches EscalationModal.css form styles */
      ".cb-modal-body{padding:24px 28px;}",
      ".cb-submit-err{padding:8px 16px;background:#fef2f2;border:1px solid #fecaca;",
      "border-radius:var(--cb-r-md);color:var(--cb-danger);font-size:13px;",
      "margin-bottom:16px;display:none;animation:cb-slideDown .3s ease;}",
      ".cb-form-group{margin-bottom:16px;}",
      ".cb-form-label{display:block;font-size:13px;font-weight:600;",
      "color:var(--cb-text-secondary);margin-bottom:4px;letter-spacing:.01em;}",
      ".cb-form-label span{color:var(--cb-danger);margin-left:2px;}",
      ".cb-form-input,.cb-form-textarea{width:100%;padding:8px 16px;",
      "border:1.5px solid var(--cb-border);border-radius:var(--cb-r-md);",
      "font-size:14px;color:var(--cb-text);background:var(--cb-bg);",
      "outline:none;transition:border-color var(--cb-tr-fast),box-shadow var(--cb-tr-fast);}",
      ".cb-form-input:focus,.cb-form-textarea:focus{border-color:var(--cb-primary);",
      "box-shadow:0 0 0 3px rgba(79,70,229,.1);background:#fff;}",
      ".cb-form-input::placeholder,.cb-form-textarea::placeholder{color:var(--cb-muted);}",
      ".cb-form-textarea{resize:vertical;min-height:80px;line-height:1.5;}",
      ".cb-field-err{font-size:12px;color:var(--cb-danger);margin-top:4px;display:none;}",

      /* Modal buttons — matches .btn styles */
      ".cb-modal-actions{display:flex;gap:8px;margin-top:16px;}",
      ".cb-btn{flex:1;padding:8px 16px;border-radius:var(--cb-r-md);",
      "font-size:14px;font-weight:600;cursor:pointer;border:none;",
      "display:flex;align-items:center;justify-content:center;gap:6px;",
      "transition:all var(--cb-tr-fast);}",
      ".cb-btn:disabled{opacity:.7;cursor:not-allowed;}",
      ".cb-btn-primary{background:var(--cb-primary);color:#fff;}",
      ".cb-btn-primary:hover:not(:disabled){background:var(--cb-primary-dark);",
      "transform:translateY(-1px);box-shadow:var(--cb-shadow-md);}",
      ".cb-btn-secondary{background:var(--cb-chat-bg);color:var(--cb-text-secondary);",
      "border:1.5px solid var(--cb-border);}",
      ".cb-btn-secondary:hover:not(:disabled){background:var(--cb-border-light);}",

      /* Spinner — matches .spinner */
      ".cb-spinner{width:16px;height:16px;border:2px solid rgba(255,255,255,.3);",
      "border-top-color:#fff;border-radius:50%;animation:cb-spin .8s linear infinite;}",

      /* Success state — matches .modal__success */
      ".cb-modal-success{text-align:center;padding:28px;}",
      ".cb-success-icon{font-size:48px;display:block;margin-bottom:16px;animation:cb-bounce .6s ease;}",
      ".cb-success-title{font-size:20px;font-weight:700;color:var(--cb-text);margin-bottom:8px;}",
      ".cb-success-text{font-size:14px;color:var(--cb-text-secondary);line-height:1.6;}",
      ".cb-ticket-id{display:inline-block;padding:4px 12px;background:var(--cb-faq-badge);",
      "color:var(--cb-primary);border-radius:var(--cb-r-sm);",
      "font-family:var(--cb-mono);font-size:12px;font-weight:600;margin-top:8px;}",

      /* ── KEYFRAMES — matches global.css animations ── */
      "@keyframes cb-fadeIn{from{opacity:0;}to{opacity:1;}}",
      "@keyframes cb-slideUp{from{opacity:0;transform:translateY(20px);}to{opacity:1;transform:translateY(0);}}",
      "@keyframes cb-slideDown{from{opacity:0;transform:translateY(-10px);}to{opacity:1;transform:translateY(0);}}",
      "@keyframes cb-pop{from{opacity:0;transform:translateY(20px) scale(.96);}to{opacity:1;transform:translateY(0) scale(1);}}",
      "@keyframes cb-pulse{0%,100%{transform:scale(1);}50%{transform:scale(1.05);}}",
      "@keyframes cb-bounce{0%,80%,100%{transform:translateY(0);}40%{transform:translateY(-8px);}}",
      "@keyframes cb-spin{to{transform:rotate(360deg);}}",

      /* ── MOBILE — matches ChatWidget.css @media (max-width: 480px) ── */
      "@media(max-width:480px){",
      "#cb-root{width:100%!important;height:100%!important;bottom:0!important;",
      "right:0!important;left:0!important;border-radius:0!important;}",
      "#cb-launcher{bottom:20px;" + (isLeft ? "left:20px;" : "right:20px;") + "width:54px;height:54px;}",
      "}",
    ].join("");

    var style = document.createElement("style");
    style.id = "cb-styles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ─────────────────────────────────────────────────────────────
  // SVG ICONS
  // ─────────────────────────────────────────────────────────────
  var ICON_CHAT  = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg>';
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
  var ICON_SEND  = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';

  // ─────────────────────────────────────────────────────────────
  // BUILD DOM — mirrors ChatWindow.jsx + ChatWidget.jsx structure
  // ─────────────────────────────────────────────────────────────
  function buildDOM(cfg) {
    // Launcher button
    var launcher = document.createElement("button");
    launcher.id = "cb-launcher";
    launcher.setAttribute("aria-label", "Open chat");
    launcher.setAttribute("aria-expanded", "false");
    launcher.innerHTML = ICON_CHAT;
    document.body.appendChild(launcher);

    // Chat window
    var root = document.createElement("div");
    root.id = "cb-root";
    root.className = "cb-hidden";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Customer Support Chat");
    root.innerHTML = [
      // Header
      '<div class="cb-header">',
        '<div class="cb-avatar" aria-hidden="true">' + sanitize(cfg.bot.avatar) + '</div>',
        '<div class="cb-header-info">',
          '<div class="cb-header-name">' + sanitize(cfg.bot.name) + '</div>',
          '<div class="cb-header-status">',
            '<span class="cb-status-dot" aria-hidden="true"></span>',
            '<span class="cb-status-text">' + sanitize(cfg.bot.status) + '</span>',
          '</div>',
        '</div>',
        // New chat button — hidden until user sends first message (matches ChatWindow.jsx)
        '<button class="cb-header-btn cb-new-btn" style="display:none" aria-label="Start a new chat" title="Clear history and start fresh">🔄 New</button>',
        // Human escalation button
        '<button class="cb-header-btn cb-human-btn" aria-label="Talk to a human agent">👤 Human</button>',
        // Close button
        '<button class="cb-close-btn" aria-label="Close chat">' + ICON_CLOSE + '</button>',
      '</div>',
      // Messages
      '<div class="cb-messages" role="log" aria-live="polite" aria-label="Chat messages">',
        // Welcome screen (matches ChatWindow.jsx welcome)
        '<div class="cb-welcome">',
          '<span class="cb-welcome-emoji">👋</span>',
          '<h3 class="cb-welcome-title">Hello! How can I help?</h3>',
          '<p class="cb-welcome-sub">Ask me anything, or choose a common question below.<br>I\'m here to help 24/7!</p>',
        '</div>',
      '</div>',
      // Quick replies (initially hidden — shown after FAQ fetch)
      '<div class="cb-quick" style="display:none">',
        '<p class="cb-quick-label">💡 Common Questions</p>',
        '<div class="cb-quick-list"></div>',
      '</div>',
      // Input bar
      '<div class="cb-input-bar">',
        '<div class="cb-input-form">',
          '<textarea class="cb-textarea" placeholder="Type a message…" rows="1" aria-label="Type your message"></textarea>',
          '<button class="cb-send-btn" disabled aria-label="Send message">' + ICON_SEND + '</button>',
        '</div>',
      '</div>',
    ].join("");
    document.body.appendChild(root);

    // Escalation modal (matches EscalationModal.jsx)
    var modal = document.createElement("div");
    modal.id = "cb-modal";
    modal.className = "cb-hidden";
    modal.innerHTML = [
      '<div class="cb-modal-card">',
        '<div class="cb-modal-hd">',
          '<div class="cb-modal-hd-icon">👤</div>',
          '<div class="cb-modal-title">Talk to a Human</div>',
          '<div class="cb-modal-sub">Our team will contact you within 24 hours</div>',
        '</div>',
        '<div class="cb-modal-body">',
          '<div class="cb-submit-err"></div>',
          '<div class="cb-form-group">',
            '<label class="cb-form-label">Full Name <span>*</span></label>',
            '<input class="cb-form-input cb-esc-name" type="text" placeholder="Jane Smith" autocomplete="name">',
            '<div class="cb-field-err cb-err-name"></div>',
          '</div>',
          '<div class="cb-form-group">',
            '<label class="cb-form-label">Email Address <span>*</span></label>',
            '<input class="cb-form-input cb-esc-email" type="email" placeholder="jane@company.com" autocomplete="email">',
            '<div class="cb-field-err cb-err-email"></div>',
          '</div>',
          '<div class="cb-form-group">',
            '<label class="cb-form-label">Describe your issue</label>',
            '<textarea class="cb-form-textarea cb-esc-issue" placeholder="What can we help you with? The more detail, the better." rows="3"></textarea>',
          '</div>',
          '<div class="cb-modal-actions">',
            '<button class="cb-btn cb-btn-secondary cb-modal-cancel">Cancel</button>',
            '<button class="cb-btn cb-btn-primary cb-modal-submit">📨 Submit Request</button>',
          '</div>',
        '</div>',
      '</div>',
    ].join("");
    document.body.appendChild(modal);

    return {
      launcher: launcher,
      root:     root,
      modal:    modal,
      messages: root.querySelector(".cb-messages"),
      textarea: root.querySelector(".cb-textarea"),
      sendBtn:  root.querySelector(".cb-send-btn"),
      newBtn:   root.querySelector(".cb-new-btn"),
      humanBtn: root.querySelector(".cb-human-btn"),
      closeBtn: root.querySelector(".cb-close-btn"),
      quickWrap: root.querySelector(".cb-quick"),
      quickList: root.querySelector(".cb-quick-list"),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // STATE — mirrors useChat.js state shape exactly
  // ─────────────────────────────────────────────────────────────
  function createState(cfg) {
    return {
      cfg:                cfg,
      api:                makeApi(cfg),
      sessionId:          getOrCreateSessionId(cfg.appId),
      messages:           [],
      conversationHistory: [],  // for AI context (last 10)
      suggestions:        [],
      allFaqs:            [],   // full FAQ list for initial buttons
      isTyping:           false,
      isLoading:          false,
      isOpen:             false,
      historyLoaded:      false,
      userHasSent:        false, // controls "New" button + quick-reply mode
    };
  }

  // ─────────────────────────────────────────────────────────────
  // RENDER HELPERS
  // ─────────────────────────────────────────────────────────────
  function scrollBottom(els) {
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  function setStatusText(els, text) {
    var el = els.root.querySelector(".cb-status-text");
    if (el) el.textContent = text;
  }

  // Render one message row — mirrors MessageBubble.jsx exactly
  function renderMsgRow(state, msg) {
    var isUser = msg.role === "user";
    var row = document.createElement("div");
    row.className = "cb-msg-row " + (isUser ? "user" : "bot");
    row.dataset.msgId = msg.id || "";

    var html = "";
    if (!isUser) {
      // Bot avatar
      html += '<div class="cb-msg-avatar" aria-hidden="true">' + sanitize(state.cfg.bot.avatar) + '</div>';
    }
    html += '<div class="cb-msg-wrap">';

    // Source badge (FAQ / AI) — matches message-source-badge
    if (!isUser && msg.source) {
      html += '<span class="cb-src-badge ' + msg.source + '">';
      html += (msg.source === "faq" ? "📚 FAQ" : "✨ AI");
      html += '</span>';
    }

    // Bubble
    html += '<div class="cb-bubble ' + (isUser ? "user" : "bot") + '"';
    html += ' aria-label="' + (isUser ? "You" : "Bot") + ': ' + sanitize(msg.content) + '">';
    html += formatContent(msg.content);
    html += '</div>';

    // Timestamp
    html += '<span class="cb-time">' + fmtTime(msg.timestamp) + '</span>';
    html += '</div>';

    row.innerHTML = html;
    return row;
  }

  function appendMsg(state, els, msg) {
    els.messages.appendChild(renderMsgRow(state, msg));
    scrollBottom(els);
  }

  function showTyping(state, els) {
    if (els.messages.querySelector(".cb-typing")) return;
    var div = document.createElement("div");
    div.className = "cb-typing";
    div.setAttribute("aria-label", "Bot is typing");
    div.innerHTML =
      '<div class="cb-msg-avatar" aria-hidden="true">' + sanitize(state.cfg.bot.avatar) + '</div>' +
      '<div class="cb-typing-dots"><span></span><span></span><span></span></div>';
    els.messages.appendChild(div);
    scrollBottom(els);
  }

  function hideTyping(els) {
    var el = els.messages.querySelector(".cb-typing");
    if (el) el.remove();
  }

  // Render quick replies — matches QuickReplies.jsx both modes
  function renderQuickReplies(state, els, faqs, label) {
    if (!faqs || faqs.length === 0) {
      els.quickWrap.style.display = "none";
      return;
    }
    els.quickWrap.style.display = "block";
    els.quickWrap.querySelector(".cb-quick-label").textContent = label;
    els.quickList.innerHTML = "";
    faqs.slice(0, 8).forEach(function (faq) {
      var btn = document.createElement("button");
      btn.className = "cb-quick-btn";
      btn.textContent = faq.question;
      btn.title = faq.question;
      btn.addEventListener("click", function () {
        sendMessage(state, els, faq.question);
      });
      els.quickList.appendChild(btn);
    });
  }

  function hideQuickReplies(els) {
    els.quickWrap.style.display = "none";
  }

  // ─────────────────────────────────────────────────────────────
  // LOAD HISTORY — mirrors useChat.js restoreHistory()
  // ─────────────────────────────────────────────────────────────
  function loadHistory(state, els) {
    if (state.historyLoaded) return;
    state.historyLoaded = true;
    state.isLoading = true;
    setStatusText(els, "Restoring your chat…");

    state.api.fetchHistory(state.sessionId, state.cfg.appId)
      .then(function (data) {
        var saved = Array.isArray(data.messages) ? data.messages : [];
        state.isLoading = false;

        if (saved.length > 0) {
          // Remove welcome screen
          var welcome = els.messages.querySelector(".cb-welcome");
          if (welcome) welcome.remove();

          // Show restored banner (matches ChatWindow.jsx)
          var banner = document.createElement("div");
          banner.className = "cb-restored-banner";
          banner.textContent = "💬 Your previous conversation has been restored";
          els.messages.appendChild(banner);

          saved.forEach(function (msg) {
            state.messages.push(msg);
            state.conversationHistory.push({
              role:    msg.role === "bot" ? "assistant" : "user",
              content: msg.content,
            });
            appendMsg(state, els, msg);
          });

          state.userHasSent = saved.some(function (m) { return m.role === "user"; });
          if (state.userHasSent) {
            els.newBtn.style.display = "flex";
          }
        }

        setStatusText(els, state.cfg.bot.status);

        // Load FAQ buttons only for fresh sessions (matches QuickReplies.jsx useEffect)
        if (!state.userHasSent) {
          loadInitialFAQs(state, els);
        }
      })
      .catch(function (err) {
        console.warn("[ChatBot] Could not restore history:", err.message);
        state.isLoading = false;
        setStatusText(els, state.cfg.bot.status);
        loadInitialFAQs(state, els);
      });
  }

  function loadInitialFAQs(state, els) {
    state.api.fetchFAQs()
      .then(function (data) {
        var list = Array.isArray(data.faqs) ? data.faqs : (Array.isArray(data) ? data : []);
        state.allFaqs = list;
        // Only show if user hasn't sent yet (matches QuickReplies.jsx showInitial logic)
        if (!state.userHasSent) {
          renderQuickReplies(state, els, list, "💡 Common Questions");
        }
      })
      .catch(function () {});
  }

  // ─────────────────────────────────────────────────────────────
  // SEND MESSAGE — mirrors useChat.js sendMessage() exactly
  // ─────────────────────────────────────────────────────────────
  function sendMessage(state, els, text) {
    if (!text || !text.trim() || state.isTyping || state.isLoading) return;
    text = text.trim();

    // Remove welcome screen, hide quick replies, show New button
    var welcome = els.messages.querySelector(".cb-welcome");
    if (welcome) welcome.remove();
    hideQuickReplies(els);

    state.userHasSent = true;
    els.newBtn.style.display = "flex";

    // Optimistic user message (matches useChat.js)
    var userMsg = {
      id:        Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      role:      "user",
      content:   text,
      source:    null,
      timestamp: new Date().toISOString(),
    };
    state.messages.push(userMsg);
    state.conversationHistory.push({ role: "user", content: text });
    appendMsg(state, els, userMsg);

    // Lock UI
    state.isTyping = true;
    els.textarea.disabled = true;
    els.sendBtn.disabled = true;
    setStatusText(els, "Typing…");
    showTyping(state, els);

    state.api.sendMessage(
      text,
      state.sessionId,
      state.cfg.appId,
      state.conversationHistory.slice(-10)
    )
      .then(function (data) {
        hideTyping(els);

        // Bot message — matches useChat.js botMsg shape
        var botMsg = {
          id:          data.messageId || (Date.now() + "-b-" + Math.random().toString(36).slice(2, 6)),
          role:        "bot",
          content:     data.reply,
          source:      data.source,
          faqQuestion: data.faqQuestion,
          timestamp:   data.timestamp || new Date().toISOString(),
        };
        state.messages.push(botMsg);
        state.conversationHistory.push({ role: "assistant", content: data.reply });
        appendMsg(state, els, botMsg);

        // Contextual suggestions after reply (matches QuickReplies.jsx contextual mode)
        if (Array.isArray(data.suggestions) && data.suggestions.length > 0) {
          state.suggestions = data.suggestions;
          renderQuickReplies(state, els, data.suggestions, "🔗 You might also want to know");
        } else {
          state.suggestions = [];
        }
      })
      .catch(function () {
        hideTyping(els);
        var errMsg = {
          id:        Date.now() + "-err",
          role:      "bot",
          content:   "⚠️ Sorry, I couldn't process your request. Please try again or click \"Talk to Human\" for help.",
          source:    null,
          timestamp: new Date().toISOString(),
        };
        state.messages.push(errMsg);
        appendMsg(state, els, errMsg);
      })
      .finally(function () {
        state.isTyping = false;
        els.textarea.disabled = false;
        els.sendBtn.disabled = !els.textarea.value.trim();
        setStatusText(els, state.cfg.bot.status);
        els.textarea.focus();
      });
  }

  // ─────────────────────────────────────────────────────────────
  // NEW CHAT — mirrors useChat.js clearMessages() exactly
  // ─────────────────────────────────────────────────────────────
  function newChat(state, els) {
    // Tell backend to clear remote history
    state.api.clearHistory(state.sessionId).catch(function () {});

    // Generate new sessionId and persist it (matches useChat.js)
    var newId = uuid();
    state.sessionId = newId;
    persistSessionId(state.cfg.appId, newId);

    // Reset all state
    state.messages = [];
    state.conversationHistory = [];
    state.suggestions = [];
    state.userHasSent = false;

    // Reset DOM
    els.messages.innerHTML = [
      '<div class="cb-welcome">',
        '<span class="cb-welcome-emoji">👋</span>',
        '<h3 class="cb-welcome-title">Hello! How can I help?</h3>',
        '<p class="cb-welcome-sub">Ask me anything, or choose a common question below.<br>I\'m here to help 24/7!</p>',
      '</div>',
    ].join("");
    els.newBtn.style.display = "none";

    // Show initial FAQ buttons again
    renderQuickReplies(state, els, state.allFaqs, "💡 Common Questions");
  }

  // ─────────────────────────────────────────────────────────────
  // ESCALATION MODAL — mirrors EscalationModal.jsx exactly
  // ─────────────────────────────────────────────────────────────
  function openEscalation(state, els) {
    // Reset to form view (in case previously shown success)
    els.modal.querySelector(".cb-modal-body").innerHTML = [
      '<div class="cb-submit-err"></div>',
      '<div class="cb-form-group">',
        '<label class="cb-form-label">Full Name <span>*</span></label>',
        '<input class="cb-form-input cb-esc-name" type="text" placeholder="Jane Smith" autocomplete="name">',
        '<div class="cb-field-err cb-err-name"></div>',
      '</div>',
      '<div class="cb-form-group">',
        '<label class="cb-form-label">Email Address <span>*</span></label>',
        '<input class="cb-form-input cb-esc-email" type="email" placeholder="jane@company.com" autocomplete="email">',
        '<div class="cb-field-err cb-err-email"></div>',
      '</div>',
      '<div class="cb-form-group">',
        '<label class="cb-form-label">Describe your issue</label>',
        '<textarea class="cb-form-textarea cb-esc-issue" placeholder="What can we help you with? The more detail, the better." rows="3"></textarea>',
      '</div>',
      '<div class="cb-modal-actions">',
        '<button class="cb-btn cb-btn-secondary cb-modal-cancel">Cancel</button>',
        '<button class="cb-btn cb-btn-primary cb-modal-submit">📨 Submit Request</button>',
      '</div>',
    ].join("");

    // Wire cancel
    els.modal.querySelector(".cb-modal-cancel").addEventListener("click", function () {
      els.modal.classList.add("cb-hidden");
    });
    // Wire submit
    els.modal.querySelector(".cb-modal-submit").addEventListener("click", function () {
      submitEscalation(state, els);
    });

    els.modal.classList.remove("cb-hidden");

    // Focus first field
    setTimeout(function () {
      var nameInput = els.modal.querySelector(".cb-esc-name");
      if (nameInput) nameInput.focus();
    }, 100);
  }

  function submitEscalation(state, els) {
    var name  = (els.modal.querySelector(".cb-esc-name").value  || "").trim();
    var email = (els.modal.querySelector(".cb-esc-email").value || "").trim();
    var issue = (els.modal.querySelector(".cb-esc-issue").value || "").trim();

    // Clear previous errors
    ["name", "email"].forEach(function (f) {
      var el = els.modal.querySelector(".cb-err-" + f);
      if (el) { el.textContent = ""; el.style.display = "none"; }
    });
    var submitErr = els.modal.querySelector(".cb-submit-err");
    submitErr.style.display = "none";

    // Validate — matches EscalationModal.jsx validate()
    var valid = true;
    if (!name) {
      var en = els.modal.querySelector(".cb-err-name");
      en.textContent = "⚠ Name is required."; en.style.display = "block"; valid = false;
    }
    if (!email) {
      var ee = els.modal.querySelector(".cb-err-email");
      ee.textContent = "⚠ Email is required."; ee.style.display = "block"; valid = false;
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      var ee2 = els.modal.querySelector(".cb-err-email");
      ee2.textContent = "⚠ Enter a valid email address."; ee2.style.display = "block"; valid = false;
    }
    if (!valid) return;

    var submitBtn = els.modal.querySelector(".cb-modal-submit");
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<div class="cb-spinner"></div> Submitting…';

    state.api.escalate({
      name:                name,
      email:               email,
      issue:               issue || "No specific issue provided",
      conversationHistory: state.conversationHistory,
    })
      .then(function (res) {
        // Success screen — matches EscalationModal.jsx ticketId state
        els.modal.querySelector(".cb-modal-body").innerHTML = [
          '<div class="cb-modal-success">',
            '<span class="cb-success-icon">✅</span>',
            '<h2 class="cb-success-title">You\'re all set!</h2>',
            '<p class="cb-success-text">',
              'A human agent will reach out to <strong>' + sanitize(email) + '</strong> within 24 hours.<br>',
              'Your ticket ID is:',
            '</p>',
            '<div class="cb-ticket-id">' + sanitize(res.ticketId) + '</div>',
            '<div style="margin-top:24px">',
              '<button class="cb-btn cb-btn-primary cb-success-close" style="display:inline-flex;max-width:140px">Close</button>',
            '</div>',
          '</div>',
        ].join("");
        els.modal.querySelector(".cb-success-close").addEventListener("click", function () {
          els.modal.classList.add("cb-hidden");
        });
      })
      .catch(function (err) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = "📨 Submit Request";
        submitErr.textContent = "⚠️ " + (err.message || "Submission failed. Please try again.");
        submitErr.style.display = "block";
      });
  }

  // ─────────────────────────────────────────────────────────────
  // WIRE EVENTS — all interactions
  // ─────────────────────────────────────────────────────────────
  function wireEvents(state, els) {
    // Toggle launcher open/close
    els.launcher.addEventListener("click", function () {
      var willOpen = els.root.classList.contains("cb-hidden");
      if (willOpen) {
        els.root.classList.remove("cb-hidden");
        els.launcher.innerHTML = ICON_CLOSE;
        els.launcher.setAttribute("aria-label", "Close chat");
        els.launcher.setAttribute("aria-expanded", "true");
        state.isOpen = true;
        if (!state.historyLoaded) loadHistory(state, els);
        setTimeout(function () { els.textarea.focus(); }, 200);
      } else {
        els.root.classList.add("cb-hidden");
        els.launcher.innerHTML = ICON_CHAT;
        els.launcher.setAttribute("aria-label", "Open chat");
        els.launcher.setAttribute("aria-expanded", "false");
        state.isOpen = false;
      }
    });

    // Close button in header
    els.closeBtn.addEventListener("click", function () {
      els.root.classList.add("cb-hidden");
      els.launcher.innerHTML = ICON_CHAT;
      els.launcher.setAttribute("aria-label", "Open chat");
      els.launcher.setAttribute("aria-expanded", "false");
      state.isOpen = false;
    });

    // New chat button
    els.newBtn.addEventListener("click", function () {
      newChat(state, els);
    });

    // Human escalation
    els.humanBtn.addEventListener("click", function () {
      openEscalation(state, els);
    });

    // Textarea auto-resize — matches ChatInput.jsx useEffect
    els.textarea.addEventListener("input", function () {
      els.textarea.style.height = "auto";
      els.textarea.style.height = Math.min(els.textarea.scrollHeight, 120) + "px";
      els.sendBtn.disabled = !els.textarea.value.trim() || state.isTyping;
    });

    // Enter to send, Shift+Enter for newline — matches ChatInput.jsx handleKeyDown
    els.textarea.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        var text = els.textarea.value.trim();
        if (text && !state.isTyping) {
          els.textarea.value = "";
          els.textarea.style.height = "auto";
          els.sendBtn.disabled = true;
          sendMessage(state, els, text);
        }
      }
    });

    // Send button
    els.sendBtn.addEventListener("click", function () {
      var text = els.textarea.value.trim();
      if (text && !state.isTyping) {
        els.textarea.value = "";
        els.textarea.style.height = "auto";
        els.sendBtn.disabled = true;
        sendMessage(state, els, text);
      }
    });

    // Click outside modal to close
    els.modal.addEventListener("click", function (e) {
      if (e.target === els.modal) els.modal.classList.add("cb-hidden");
    });

    // Escape key closes modal
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (!els.modal.classList.contains("cb-hidden")) {
          els.modal.classList.add("cb-hidden");
        }
      }
    });
  }

  // ─────────────────────────────────────────────────────────────
  // PUBLIC API — returned from initChatbot()
  // ─────────────────────────────────────────────────────────────
  function initChatbot(userConfig) {
    function boot() {
      var cfg   = mergeConfig(userConfig);
      var state = createState(cfg);
      injectStyles(cfg);
      var els   = buildDOM(cfg);
      wireEvents(state, els);

      console.log(
        "[ChatBot] Ready — appId: \"" + cfg.appId + "\"" +
        (cfg.apiUrl ? ", api: \"" + cfg.apiUrl + "\"" : ", api: same-origin")
      );

      // Public API object — matches original chatbot.js API
      return {
        open: function () {
          els.root.classList.remove("cb-hidden");
          els.launcher.innerHTML = ICON_CLOSE;
          els.launcher.setAttribute("aria-label", "Close chat");
          els.launcher.setAttribute("aria-expanded", "true");
          state.isOpen = true;
          if (!state.historyLoaded) loadHistory(state, els);
        },
        close: function () {
          els.root.classList.add("cb-hidden");
          els.launcher.innerHTML = ICON_CHAT;
          els.launcher.setAttribute("aria-label", "Open chat");
          els.launcher.setAttribute("aria-expanded", "false");
          state.isOpen = false;
        },
        sendMessage: function (text) {
          if (!state.isOpen) this.open();
          setTimeout(function () { sendMessage(state, els, text); }, state.historyLoaded ? 0 : 600);
        },
        clearHistory: function () { newChat(state, els); },
        destroy: function () {
          ["cb-styles", "cb-root", "cb-launcher", "cb-modal"].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.remove();
          });
          global.__chatbotLoaded = false;
        },
      };
    }

    // Wait for DOM if needed
    if (document.readyState === "loading") {
      return new Promise(function (resolve) {
        document.addEventListener("DOMContentLoaded", function () { resolve(boot()); });
      });
    }
    return boot();
  }

  global.initChatbot = initChatbot;

})(window);