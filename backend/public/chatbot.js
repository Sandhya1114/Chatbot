/*!
 * chatbot.js — Embed Library v3.0.0
 * Redesigned UI matching modern AI Assistant style.
 * Drop-in chat widget with full functionality preserved.
 *
 * Usage:
 *   <script src="chatbot.js"></script>
 *   <script>
 *     initChatbot({
 *       apiUrl: "https://your-backend.com",
 *       appId:  "my-app",
 *       theme:  { primary: "#0d9488" },
 *       bot:    { name: "Support Team", avatar: "https://i.pravatar.cc/40", status: "Online and ready to help" }
 *     });
 *   </script>
 */

(function (global) {
  "use strict";

  if (global.__chatbotLoaded) return;
  global.__chatbotLoaded = true;

  // ─────────────────────────────────────────────────────────────
  // DEFAULT CONFIG
  // ─────────────────────────────────────────────────────────────
  var DEFAULTS = {
    apiUrl:   "",
    appId:    "default",
    position: "bottom-right",
    bot: {
      name:   "Support Team",
      avatar: "",       // URL for image avatar; falls back to initials
      status: "Online and ready to help",
      poweredBy: "AI ASSISTANT",
    },
    launcher: {
      label: "Chat with us",
      tooltip: "Need help?",
      tooltipSub: "We're online",
    },
    theme: {
      primary:      "#0d9488",   // teal
      primaryDark:  "#0f766e",
      primaryLight: "#14b8a6",
      userBubble:   "#7c3aed",   // purple
      userText:     "#ffffff",
      botBubble:    "#ffffff",
      botText:      "#111827",
      bg:           "#f3f4f6",
      card:         "#ffffff",
      border:       "#e5e7eb",
      textPrimary:  "#111827",
      textSecondary:"#6b7280",
      textMuted:    "#9ca3af",
    },
  };

  // ─────────────────────────────────────────────────────────────
  // UTILS
  // ─────────────────────────────────────────────────────────────
  function mergeConfig(user) {
    var cfg = JSON.parse(JSON.stringify(DEFAULTS));
    if (!user) return cfg;
    if (user.apiUrl)   cfg.apiUrl  = user.apiUrl.replace(/\/$/, "");
    if (user.appId)    cfg.appId   = user.appId;
    if (user.position) cfg.position = user.position;
    if (user.theme)    Object.assign(cfg.theme, user.theme);
    if (user.bot)      Object.assign(cfg.bot, user.bot);
    if (user.launcher) Object.assign(cfg.launcher, user.launcher);
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

  function formatContent(text) {
    if (!text) return "";
    return sanitize(text)
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\n/g, "<br>");
  }

  function getStorageKey(appId) { return "chatbot_session_" + appId; }

  function getOrCreateSessionId(appId) {
    var key = getStorageKey(appId);
    try {
      var existing = localStorage.getItem(key);
      if (existing) return existing;
      var id = uuid();
      localStorage.setItem(key, id);
      return id;
    } catch (e) { return uuid(); }
  }

  function persistSessionId(appId, id) {
    try { localStorage.setItem(getStorageKey(appId), id); } catch (e) {}
  }

  function getHostSiteOrigin() {
    try { return global.location && global.location.origin ? global.location.origin : ""; } catch (e) { return ""; }
  }

  function getHostPageUrl() {
    try { return global.location && global.location.href ? global.location.href : ""; } catch (e) { return ""; }
  }

  // Avatar HTML: image if URL provided, else colored initials
  function avatarHTML(cfg, size) {
    size = size || 40;
    var initials = (cfg.bot.name || "S").split(" ").map(function(w){return w[0];}).join("").slice(0,2).toUpperCase();
    if (cfg.bot.avatar && cfg.bot.avatar.match(/^https?:\/\//)) {
      return '<img src="' + sanitize(cfg.bot.avatar) + '" width="' + size + '" height="' + size + '" style="border-radius:50%;object-fit:cover;" alt="' + sanitize(cfg.bot.name) + '">';
    }
    return '<span style="font-size:' + Math.round(size*0.35) + 'px;font-weight:700;color:#fff;">' + sanitize(initials) + '</span>';
  }

  // ─────────────────────────────────────────────────────────────
  // API LAYER
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
      fetchHistory: function (sessionId, appId) {
        return apiFetch("/api/chat/history?sessionId=" + encodeURIComponent(sessionId) + "&appId=" + encodeURIComponent(appId));
      },
      sendMessage: function (message, sessionId, appId, conversationHistory) {
        return apiFetch("/api/chat", {
          method: "POST",
          body: JSON.stringify({ message, sessionId, appId, conversationHistory, siteOrigin: getHostSiteOrigin(), pageUrl: getHostPageUrl() }),
        });
      },
      fetchFAQs: function (appId) {
        return apiFetch("/api/chat/faqs?appId=" + encodeURIComponent(appId || "default") + "&siteOrigin=" + encodeURIComponent(getHostSiteOrigin()) + "&pageUrl=" + encodeURIComponent(getHostPageUrl()));
      },
      clearHistory: function (sessionId) {
        return apiFetch("/api/chat/history", { method: "DELETE", body: JSON.stringify({ sessionId }) });
      },
      escalate: function (payload) {
        return apiFetch("/api/escalate", { method: "POST", body: JSON.stringify(payload) });
      },
    };
  }

  // ─────────────────────────────────────────────────────────────
  // INJECT STYLES — New teal + white design matching the image
  // ─────────────────────────────────────────────────────────────
  function injectStyles(cfg) {
    if (document.getElementById("cb-styles")) return;
    var t = cfg.theme;
    var isLeft = cfg.position === "bottom-left";
    var side = isLeft ? "left:24px;" : "right:24px;";

    var css = [
      "@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');",

      ":root{",
      "--cb-primary:"       + t.primary       + ";",
      "--cb-primary-dark:"  + t.primaryDark   + ";",
      "--cb-primary-light:" + t.primaryLight  + ";",
      "--cb-user-bubble:"   + t.userBubble    + ";",
      "--cb-user-text:"     + t.userText      + ";",
      "--cb-bot-bubble:"    + t.botBubble     + ";",
      "--cb-bot-text:"      + t.botText       + ";",
      "--cb-bg:"            + t.bg            + ";",
      "--cb-card:"          + t.card          + ";",
      "--cb-border:"        + t.border        + ";",
      "--cb-text:"          + t.textPrimary   + ";",
      "--cb-text-secondary:"+ t.textSecondary + ";",
      "--cb-muted:"         + t.textMuted     + ";",
      "--cb-font:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,sans-serif;",
      "}",

      /* Reset */
      "#cb-launcher,#cb-tooltip,#cb-root,#cb-modal,",
      "#cb-launcher *,#cb-tooltip *,#cb-root *,#cb-modal *{box-sizing:border-box;margin:0;padding:0;font-family:var(--cb-font);}",

      /* ── LAUNCHER ── */
      "#cb-launcher-wrap{position:fixed;bottom:24px;" + side + "z-index:1000;display:flex;flex-direction:column;align-items:" + (isLeft ? "flex-start" : "flex-end") + ";gap:10px;}",

      "#cb-tooltip{",
      "background:#fff;border:1px solid var(--cb-border);border-radius:24px;",
      "padding:8px 16px;display:flex;align-items:center;gap:8px;",
      "box-shadow:0 4px 24px rgba(0,0,0,.10);",
      "animation:cb-fadeIn .3s ease;white-space:nowrap;",
      "}",
      ".cb-tooltip-dot{width:8px;height:8px;border-radius:50%;background:#22c55e;flex-shrink:0;}",
      ".cb-tooltip-label{font-size:13px;font-weight:700;color:var(--cb-text);}",
      ".cb-tooltip-sub{font-size:13px;color:var(--cb-text-secondary);}",

      "#cb-launcher{",
      "width:auto;height:52px;border-radius:26px;padding:0 22px;",
      "background:var(--cb-primary);color:#fff;border:none;cursor:pointer;",
      "display:flex;align-items:center;gap:10px;",
      "box-shadow:0 8px 30px rgba(13,148,136,.35);",
      "font-size:15px;font-weight:700;letter-spacing:-.01em;",
      "transition:transform .2s ease,box-shadow .2s ease;",
      "}",
      "#cb-launcher:hover{transform:translateY(-2px);box-shadow:0 12px 36px rgba(13,148,136,.45);}",
      "#cb-launcher:active{transform:scale(.97);}",
      "#cb-launcher svg{width:20px;height:20px;flex-shrink:0;}",

      /* ── CHAT WINDOW ── */
      "#cb-root{",
      "position:fixed;bottom:90px;" + side,
      "width:380px;height:600px;",
      "background:#fff;border-radius:20px;",
      "border:1px solid var(--cb-border);",
      "box-shadow:0 20px 60px rgba(0,0,0,.14);",
      "display:flex;flex-direction:column;overflow:hidden;",
      "z-index:1000;animation:cb-pop .3s cubic-bezier(.34,1.56,.64,1);}",
      "#cb-root.cb-hidden{display:none;}",

      /* ── HEADER ── */
      ".cb-header{",
      "background:#fff;padding:16px 18px;",
      "display:flex;align-items:center;gap:12px;",
      "border-bottom:1px solid var(--cb-border);flex-shrink:0;}",

      ".cb-avatar-wrap{position:relative;flex-shrink:0;}",
      ".cb-avatar-img{width:44px;height:44px;border-radius:50%;",
      "background:linear-gradient(135deg,var(--cb-primary-light),var(--cb-primary-dark));",
      "display:flex;align-items:center;justify-content:center;overflow:hidden;}",
      ".cb-online-dot{position:absolute;bottom:1px;right:1px;width:11px;height:11px;",
      "border-radius:50%;background:#22c55e;border:2px solid #fff;}",

      ".cb-header-info{flex:1;min-width:0;}",
      ".cb-header-name{font-size:16px;font-weight:700;color:var(--cb-text);line-height:1.2;}",
      ".cb-header-status{font-size:12px;color:var(--cb-text-secondary);margin-top:2px;display:flex;align-items:center;gap:5px;}",
      ".cb-header-status-dot{width:7px;height:7px;border-radius:50%;background:#22c55e;}",

      ".cb-header-actions{display:flex;align-items:center;gap:4px;margin-left:auto;}",
      ".cb-icon-btn{width:32px;height:32px;border-radius:8px;border:none;background:transparent;",
      "cursor:pointer;display:flex;align-items:center;justify-content:center;",
      "color:var(--cb-text-secondary);transition:background .15s;}",
      ".cb-icon-btn:hover{background:var(--cb-bg);}",
      ".cb-icon-btn svg{width:18px;height:18px;}",

      /* ── MESSAGES ── */
      ".cb-messages{flex:1;overflow-y:auto;padding:20px 16px 12px;",
      "display:flex;flex-direction:column;gap:18px;",
      "background:var(--cb-bg);scroll-behavior:smooth;}",
      ".cb-messages::-webkit-scrollbar{width:4px;}",
      ".cb-messages::-webkit-scrollbar-thumb{background:var(--cb-border);border-radius:99px;}",

      /* Welcome */
      ".cb-welcome{text-align:center;padding:20px 12px 10px;}",
      ".cb-welcome-icon{width:56px;height:56px;border-radius:50%;",
      "background:linear-gradient(135deg,var(--cb-primary-light),var(--cb-primary-dark));",
      "display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-size:26px;}",
      ".cb-welcome-title{font-size:18px;font-weight:700;color:var(--cb-text);margin-bottom:6px;}",
      ".cb-welcome-sub{font-size:13px;color:var(--cb-text-secondary);line-height:1.6;}",

      ".cb-restored-banner{text-align:center;font-size:11px;color:var(--cb-muted);padding:4px 0 8px;}",

      /* ── MESSAGE ROWS ── */
      ".cb-msg-row{display:flex;gap:10px;animation:cb-slideUp .25s ease;}",
      ".cb-msg-row.user{flex-direction:row-reverse;}",

      ".cb-msg-bot-avatar{width:32px;height:32px;border-radius:50%;flex-shrink:0;align-self:flex-end;",
      "background:linear-gradient(135deg,var(--cb-primary-light),var(--cb-primary-dark));",
      "display:flex;align-items:center;justify-content:center;overflow:hidden;}",

      ".cb-msg-wrap{max-width:80%;display:flex;flex-direction:column;gap:4px;}",
      ".cb-msg-row.user .cb-msg-wrap{align-items:flex-end;}",

      /* Bubbles */
      ".cb-bubble{padding:12px 15px;border-radius:18px;font-size:14px;line-height:1.7;word-break:break-word;}",
      ".cb-bubble.user{",
      "background:var(--cb-user-bubble);color:var(--cb-user-text);",
      "border-bottom-right-radius:4px;",
      "box-shadow:0 4px 16px rgba(124,58,237,.25);}",
      ".cb-bubble.bot{",
      "background:#fff;color:var(--cb-bot-text);",
      "border-bottom-left-radius:4px;",
      "box-shadow:0 2px 8px rgba(0,0,0,.06);border:1px solid var(--cb-border);}",
      ".cb-bubble.bot strong{font-weight:600;color:var(--cb-primary-dark);}",

      ".cb-time{font-size:10px;color:var(--cb-muted);padding:0 4px;}",

      /* Source badge */
      ".cb-src-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;",
      "border-radius:99px;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;}",
      ".cb-src-badge.faq{background:#ede9fe;color:#6d28d9;}",
      ".cb-src-badge.ai{background:#d1fae5;color:#065f46;}",
      ".cb-source-link{font-size:11px;color:var(--cb-primary);padding:0 4px 2px;text-decoration:none;font-weight:600;}",
      ".cb-source-link:hover{text-decoration:underline;}",

      /* ── TYPING ── */
      ".cb-typing{display:flex;align-items:center;gap:10px;animation:cb-fadeIn .25s ease;}",
      ".cb-typing-dots{display:flex;gap:4px;padding:12px 15px;",
      "background:#fff;border-radius:18px;border-bottom-left-radius:4px;",
      "box-shadow:0 2px 8px rgba(0,0,0,.06);border:1px solid var(--cb-border);}",
      ".cb-typing-dots span{width:6px;height:6px;border-radius:50%;background:var(--cb-muted);",
      "animation:cb-bounce 1.2s ease infinite;}",
      ".cb-typing-dots span:nth-child(2){animation-delay:.2s;}",
      ".cb-typing-dots span:nth-child(3){animation-delay:.4s;}",

      /* ── QUICK REPLIES ── */
      ".cb-quick{padding:8px 16px 10px;border-top:1px solid var(--cb-border);background:#fff;flex-shrink:0;}",
      ".cb-quick-label{font-size:10px;font-weight:700;color:var(--cb-muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;}",
      ".cb-quick-list{display:flex;flex-wrap:wrap;gap:6px;max-height:96px;overflow-y:auto;}",
      ".cb-quick-btn{padding:7px 13px;border-radius:20px;",
      "border:1px solid var(--cb-border);background:#fff;",
      "color:var(--cb-text-secondary);font-size:12px;font-weight:600;cursor:pointer;",
      "white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis;",
      "transition:all .15s;}",
      ".cb-quick-btn:hover{background:var(--cb-bg);border-color:var(--cb-primary);color:var(--cb-primary);}",

      /* ── INPUT BAR ── */
      ".cb-input-bar{padding:10px 14px 14px;border-top:1px solid var(--cb-border);background:#fff;flex-shrink:0;}",
      ".cb-input-row{display:flex;align-items:flex-end;gap:10px;}",
      ".cb-attach-btn{width:36px;height:36px;flex-shrink:0;border:none;background:transparent;cursor:pointer;",
      "color:var(--cb-muted);display:flex;align-items:center;justify-content:center;border-radius:50%;transition:background .15s;}",
      ".cb-attach-btn:hover{background:var(--cb-bg);}",
      ".cb-attach-btn svg{width:20px;height:20px;}",
      ".cb-textarea{flex:1;border:none;background:transparent;resize:none;outline:none;",
      "font-size:14px;color:var(--cb-text);line-height:1.6;",
      "max-height:100px;min-height:36px;padding:6px 0;}",
      ".cb-textarea::placeholder{color:var(--cb-muted);}",
      ".cb-send-btn{width:40px;height:40px;border-radius:50%;",
      "background:var(--cb-primary);color:#fff;border:none;cursor:pointer;",
      "display:flex;align-items:center;justify-content:center;flex-shrink:0;",
      "box-shadow:0 4px 14px rgba(13,148,136,.30);transition:all .15s;}",
      ".cb-send-btn:hover:not(:disabled){background:var(--cb-primary-dark);transform:scale(1.05);}",
      ".cb-send-btn:disabled{background:#d1d5db;box-shadow:none;cursor:not-allowed;}",
      ".cb-send-btn svg{width:18px;height:18px;}",

      /* Powered by */
      ".cb-powered{text-align:center;font-size:10px;font-weight:700;letter-spacing:.12em;",
      "text-transform:uppercase;color:var(--cb-muted);padding:8px 0 2px;}",

      /* Header action buttons */
      ".cb-header-btn{padding:6px 12px;border-radius:20px;",
      "border:1px solid var(--cb-border);background:#fff;",
      "color:var(--cb-text-secondary);font-size:12px;font-weight:600;cursor:pointer;",
      "display:flex;align-items:center;gap:4px;transition:all .15s;}",
      ".cb-header-btn:hover{border-color:var(--cb-primary);color:var(--cb-primary);background:rgba(13,148,136,.05);}",

      /* ── ESCALATION MODAL ── */
      "#cb-modal{position:fixed;inset:0;background:rgba(17,24,39,.45);",
      "backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;",
      "z-index:1100;padding:16px;animation:cb-fadeIn .2s ease;}",
      "#cb-modal.cb-hidden{display:none;}",
      ".cb-modal-card{background:#fff;border-radius:20px;width:100%;max-width:400px;",
      "box-shadow:0 24px 60px rgba(0,0,0,.18);overflow:hidden;animation:cb-pop .3s cubic-bezier(.34,1.56,.64,1);}",
      ".cb-modal-hd{background:linear-gradient(135deg,var(--cb-primary),var(--cb-primary-dark));",
      "padding:24px 28px;color:#fff;}",
      ".cb-modal-hd-icon{font-size:28px;margin-bottom:8px;}",
      ".cb-modal-title{font-size:20px;font-weight:700;letter-spacing:-.02em;}",
      ".cb-modal-sub{font-size:13px;color:rgba(255,255,255,.75);margin-top:4px;}",
      ".cb-modal-body{padding:24px 28px;}",
      ".cb-submit-err{padding:8px 14px;background:#fef2f2;border:1px solid #fecaca;",
      "border-radius:10px;color:#dc2626;font-size:13px;margin-bottom:14px;display:none;}",
      ".cb-form-group{margin-bottom:14px;}",
      ".cb-form-label{display:block;font-size:13px;font-weight:600;color:var(--cb-text-secondary);margin-bottom:4px;}",
      ".cb-form-label span{color:#ef4444;margin-left:2px;}",
      ".cb-form-input,.cb-form-textarea{width:100%;padding:10px 14px;",
      "border:1.5px solid var(--cb-border);border-radius:10px;",
      "font-size:14px;color:var(--cb-text);background:#fff;outline:none;",
      "transition:border-color .15s,box-shadow .15s;font-family:var(--cb-font);}",
      ".cb-form-input:focus,.cb-form-textarea:focus{border-color:var(--cb-primary);",
      "box-shadow:0 0 0 3px rgba(13,148,136,.12);}",
      ".cb-form-textarea{resize:vertical;min-height:80px;line-height:1.5;}",
      ".cb-field-err{font-size:12px;color:#ef4444;margin-top:4px;display:none;}",
      ".cb-modal-actions{display:flex;gap:8px;margin-top:16px;}",
      ".cb-btn{flex:1;padding:10px 16px;border-radius:10px;font-size:14px;font-weight:600;",
      "cursor:pointer;border:none;display:flex;align-items:center;justify-content:center;gap:6px;",
      "transition:all .15s;font-family:var(--cb-font);}",
      ".cb-btn:disabled{opacity:.65;cursor:not-allowed;}",
      ".cb-btn-primary{background:var(--cb-primary);color:#fff;}",
      ".cb-btn-primary:hover:not(:disabled){background:var(--cb-primary-dark);}",
      ".cb-btn-secondary{background:var(--cb-bg);color:var(--cb-text-secondary);border:1.5px solid var(--cb-border);}",
      ".cb-btn-secondary:hover:not(:disabled){background:var(--cb-border);}",
      ".cb-spinner{width:15px;height:15px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:cb-spin .8s linear infinite;}",
      ".cb-modal-success{text-align:center;padding:28px 20px;}",
      ".cb-success-icon{font-size:44px;display:block;margin-bottom:12px;}",
      ".cb-success-title{font-size:20px;font-weight:700;color:var(--cb-text);margin-bottom:8px;}",
      ".cb-success-text{font-size:14px;color:var(--cb-text-secondary);line-height:1.6;}",
      ".cb-ticket-id{display:inline-block;padding:4px 12px;background:#f0fdf4;color:#15803d;",
      "border-radius:8px;font-family:monospace;font-size:13px;font-weight:600;margin-top:8px;}",

      /* ── KEYFRAMES ── */
      "@keyframes cb-fadeIn{from{opacity:0}to{opacity:1}}",
      "@keyframes cb-slideUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}",
      "@keyframes cb-pop{from{opacity:0;transform:translateY(16px) scale(.95)}to{opacity:1;transform:translateY(0) scale(1)}}",
      "@keyframes cb-bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-6px)}}",
      "@keyframes cb-spin{to{transform:rotate(360deg)}}",

      /* ── MOBILE ── */
      "@media(max-width:480px){",
      "#cb-root{width:100%!important;height:100%!important;bottom:0!important;right:0!important;left:0!important;border-radius:0!important;}",
      "#cb-launcher-wrap{bottom:16px;" + (isLeft ? "left:16px;" : "right:16px;") + "}",
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
  var ICON_CHAT = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
  var ICON_DOTS = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
  var ICON_ATTACH = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg>';

  // ─────────────────────────────────────────────────────────────
  // BUILD DOM
  // ─────────────────────────────────────────────────────────────
  function buildDOM(cfg) {
    // Launcher wrapper (tooltip + button)
    var launcherWrap = document.createElement("div");
    launcherWrap.id = "cb-launcher-wrap";

    var tooltip = document.createElement("div");
    tooltip.id = "cb-tooltip";
    tooltip.innerHTML =
      '<span class="cb-tooltip-dot"></span>' +
      '<span class="cb-tooltip-label">' + sanitize(cfg.launcher.tooltip) + '</span>' +
      '<span class="cb-tooltip-sub">' + sanitize(cfg.launcher.tooltipSub) + '</span>';
    launcherWrap.appendChild(tooltip);

    var launcher = document.createElement("button");
    launcher.id = "cb-launcher";
    launcher.setAttribute("aria-label", "Open chat");
    launcher.setAttribute("aria-expanded", "false");
    launcher.innerHTML = ICON_CHAT + '<span>' + sanitize(cfg.launcher.label) + '</span>';
    launcherWrap.appendChild(launcher);
    document.body.appendChild(launcherWrap);

    // Chat window
    var root = document.createElement("div");
    root.id = "cb-root";
    root.className = "cb-hidden";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Customer Support Chat");

    root.innerHTML = [
      // Header
      '<div class="cb-header">',
        '<div class="cb-avatar-wrap">',
          '<div class="cb-avatar-img">' + avatarHTML(cfg, 44) + '</div>',
          '<div class="cb-online-dot"></div>',
        '</div>',
        '<div class="cb-header-info">',
          '<div class="cb-header-name">' + sanitize(cfg.bot.name) + '</div>',
          '<div class="cb-header-status">',
            '<span class="cb-header-status-dot"></span>',
            '<span class="cb-status-text">' + sanitize(cfg.bot.status) + '</span>',
          '</div>',
        '</div>',
        '<div class="cb-header-actions">',
          '<button class="cb-header-btn cb-new-btn" style="display:none" title="New chat">🔄 New</button>',
          '<button class="cb-header-btn cb-human-btn" title="Talk to human">👤 Human</button>',
          '<button class="cb-icon-btn cb-close-btn" aria-label="Close">' + ICON_CLOSE + '</button>',
        '</div>',
      '</div>',

      // Messages
      '<div class="cb-messages" role="log" aria-live="polite">',
        '<div class="cb-welcome">',
          '<div class="cb-welcome-icon">👋</div>',
          '<h3 class="cb-welcome-title">Hi there! How can we help?</h3>',
          '<p class="cb-welcome-sub">Ask anything or pick a common question below. We\'re available 24/7.</p>',
        '</div>',
      '</div>',

      // Quick replies
      '<div class="cb-quick" style="display:none">',
        '<p class="cb-quick-label">Common Questions</p>',
        '<div class="cb-quick-list"></div>',
      '</div>',

      // Input bar
      '<div class="cb-input-bar">',
        '<div class="cb-input-row">',
          '<button class="cb-attach-btn" aria-label="Attach file">' + ICON_ATTACH + '</button>',
          '<textarea class="cb-textarea" placeholder="Type a message…" rows="1" aria-label="Type your message"></textarea>',
          '<button class="cb-send-btn" disabled aria-label="Send">' + ICON_SEND + '</button>',
        '</div>',
      '</div>',

      // Powered by
      '<div class="cb-powered">POWERED BY ' + sanitize(cfg.bot.poweredBy) + '</div>',
    ].join("");

    document.body.appendChild(root);

    // Escalation modal
    var modal = document.createElement("div");
    modal.id = "cb-modal";
    modal.className = "cb-hidden";
    modal.innerHTML = [
      '<div class="cb-modal-card">',
        '<div class="cb-modal-hd">',
          '<div class="cb-modal-hd-icon">👤</div>',
          '<div class="cb-modal-title">Talk to a Human</div>',
          '<div class="cb-modal-sub">Our team will get back within 24 hours</div>',
        '</div>',
        '<div class="cb-modal-body">',
          '<div class="cb-submit-err"></div>',
          '<div class="cb-form-group">',
            '<label class="cb-form-label">Full Name <span>*</span></label>',
            '<input class="cb-form-input cb-esc-name" type="text" placeholder="Jane Smith" autocomplete="name">',
            '<div class="cb-field-err cb-err-name"></div>',
          '</div>',
          '<div class="cb-form-group">',
            '<label class="cb-form-label">Email <span>*</span></label>',
            '<input class="cb-form-input cb-esc-email" type="email" placeholder="jane@company.com" autocomplete="email">',
            '<div class="cb-field-err cb-err-email"></div>',
          '</div>',
          '<div class="cb-form-group">',
            '<label class="cb-form-label">Issue</label>',
            '<textarea class="cb-form-textarea cb-esc-issue" placeholder="Describe your issue in detail…" rows="3"></textarea>',
          '</div>',
          '<div class="cb-modal-actions">',
            '<button class="cb-btn cb-btn-secondary cb-modal-cancel">Cancel</button>',
            '<button class="cb-btn cb-btn-primary cb-modal-submit">📨 Submit</button>',
          '</div>',
        '</div>',
      '</div>',
    ].join("");
    document.body.appendChild(modal);

    return {
      launcher:  launcher,
      tooltip:   tooltip,
      root:      root,
      modal:     modal,
      messages:  root.querySelector(".cb-messages"),
      textarea:  root.querySelector(".cb-textarea"),
      sendBtn:   root.querySelector(".cb-send-btn"),
      newBtn:    root.querySelector(".cb-new-btn"),
      humanBtn:  root.querySelector(".cb-human-btn"),
      closeBtn:  root.querySelector(".cb-close-btn"),
      quickWrap: root.querySelector(".cb-quick"),
      quickList: root.querySelector(".cb-quick-list"),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // STATE
  // ─────────────────────────────────────────────────────────────
  function createState(cfg) {
    return {
      cfg, api: makeApi(cfg),
      sessionId: getOrCreateSessionId(cfg.appId),
      messages: [], conversationHistory: [],
      suggestions: [], allFaqs: [],
      isTyping: false, isLoading: false,
      isOpen: false, historyLoaded: false, userHasSent: false,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // RENDER HELPERS
  // ─────────────────────────────────────────────────────────────
  function scrollBottom(els) { els.messages.scrollTop = els.messages.scrollHeight; }
  function setStatusText(els, text) {
    var el = els.root.querySelector(".cb-status-text");
    if (el) el.textContent = text;
  }

  function renderMsgRow(state, msg) {
    var isUser = msg.role === "user";
    var row = document.createElement("div");
    row.className = "cb-msg-row " + (isUser ? "user" : "bot");
    row.dataset.msgId = msg.id || "";

    var html = "";
    if (!isUser) {
      html += '<div class="cb-msg-bot-avatar">' + avatarHTML(state.cfg, 32) + '</div>';
    }
    html += '<div class="cb-msg-wrap">';

    if (!isUser && msg.source) {
      html += '<span class="cb-src-badge ' + msg.source + '">' + (msg.source === "faq" ? "📚 FAQ" : "✨ AI") + '</span>';
    }

    html += '<div class="cb-bubble ' + (isUser ? "user" : "bot") + '">' + formatContent(msg.content) + '</div>';

    if (!isUser && msg.sourceUrl) {
      html += '<a class="cb-source-link" href="' + sanitize(msg.sourceUrl) + '" target="_blank" rel="noreferrer">View source</a>';
    }

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
    div.innerHTML =
      '<div class="cb-msg-bot-avatar">' + avatarHTML(state.cfg, 32) + '</div>' +
      '<div class="cb-typing-dots"><span></span><span></span><span></span></div>';
    els.messages.appendChild(div);
    scrollBottom(els);
  }

  function hideTyping(els) { var el = els.messages.querySelector(".cb-typing"); if (el) el.remove(); }

  function renderQuickReplies(state, els, faqs, label) {
    if (!faqs || faqs.length === 0) { els.quickWrap.style.display = "none"; return; }
    els.quickWrap.style.display = "block";
    els.quickWrap.querySelector(".cb-quick-label").textContent = label;
    els.quickList.innerHTML = "";
    faqs.slice(0, 8).forEach(function (faq) {
      var btn = document.createElement("button");
      btn.className = "cb-quick-btn";
      btn.textContent = faq.question;
      btn.title = faq.question;
      btn.addEventListener("click", function () { sendMessage(state, els, faq.question); });
      els.quickList.appendChild(btn);
    });
  }

  function hideQuickReplies(els) { els.quickWrap.style.display = "none"; }

  // ─────────────────────────────────────────────────────────────
  // LOAD HISTORY
  // ─────────────────────────────────────────────────────────────
  function loadHistory(state, els) {
    if (state.historyLoaded) return;
    state.historyLoaded = true;
    state.isLoading = true;
    setStatusText(els, "Restoring chat…");

    state.api.fetchHistory(state.sessionId, state.cfg.appId)
      .then(function (data) {
        var saved = Array.isArray(data.messages) ? data.messages : [];
        state.isLoading = false;
        if (saved.length > 0) {
          var welcome = els.messages.querySelector(".cb-welcome");
          if (welcome) welcome.remove();
          var banner = document.createElement("div");
          banner.className = "cb-restored-banner";
          banner.textContent = "💬 Previous conversation restored";
          els.messages.appendChild(banner);
          saved.forEach(function (msg) {
            state.messages.push(msg);
            state.conversationHistory.push({ role: msg.role === "bot" ? "assistant" : "user", content: msg.content });
            appendMsg(state, els, msg);
          });
          state.userHasSent = saved.some(function (m) { return m.role === "user"; });
          if (state.userHasSent) els.newBtn.style.display = "flex";
        }
        setStatusText(els, state.cfg.bot.status);
        if (!state.userHasSent) loadInitialFAQs(state, els);
      })
      .catch(function (err) {
        console.warn("[ChatBot] History restore failed:", err.message);
        state.isLoading = false;
        setStatusText(els, state.cfg.bot.status);
        loadInitialFAQs(state, els);
      });
  }

  function loadInitialFAQs(state, els) {
    state.api.fetchFAQs(state.cfg.appId)
      .then(function (data) {
        var list = Array.isArray(data.faqs) ? data.faqs : (Array.isArray(data) ? data : []);
        state.allFaqs = list;
        if (!state.userHasSent) renderQuickReplies(state, els, list, "Suggested questions");
      })
      .catch(function () {});
  }

  // ─────────────────────────────────────────────────────────────
  // SEND MESSAGE
  // ─────────────────────────────────────────────────────────────
  function sendMessage(state, els, text) {
    if (!text || !text.trim() || state.isTyping || state.isLoading) return;
    text = text.trim();

    var welcome = els.messages.querySelector(".cb-welcome");
    if (welcome) welcome.remove();
    hideQuickReplies(els);
    state.userHasSent = true;
    els.newBtn.style.display = "flex";

    var userMsg = {
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      role: "user", content: text, source: null, timestamp: new Date().toISOString(),
    };
    state.messages.push(userMsg);
    state.conversationHistory.push({ role: "user", content: text });
    appendMsg(state, els, userMsg);

    state.isTyping = true;
    els.textarea.disabled = true;
    els.sendBtn.disabled = true;
    setStatusText(els, "Typing…");
    showTyping(state, els);

    state.api.sendMessage(text, state.sessionId, state.cfg.appId, state.conversationHistory.slice(-10))
      .then(function (data) {
        hideTyping(els);
        var botMsg = {
          id: data.messageId || (Date.now() + "-b-" + Math.random().toString(36).slice(2, 6)),
          role: "bot", content: data.reply, source: data.source,
          sourceUrl: data.sourceUrl || null, faqQuestion: data.faqQuestion,
          timestamp: data.timestamp || new Date().toISOString(),
        };
        state.messages.push(botMsg);
        state.conversationHistory.push({ role: "assistant", content: data.reply });
        appendMsg(state, els, botMsg);
        if (Array.isArray(data.suggestions) && data.suggestions.length > 0) {
          state.suggestions = data.suggestions;
          renderQuickReplies(state, els, data.suggestions, "You might also ask");
        } else {
          state.suggestions = [];
        }
      })
      .catch(function () {
        hideTyping(els);
        appendMsg(state, els, {
          id: Date.now() + "-err", role: "bot",
          content: "⚠️ Something went wrong. Please try again or click \"Human\" for support.",
          source: null, timestamp: new Date().toISOString(),
        });
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
  // NEW CHAT
  // ─────────────────────────────────────────────────────────────
  function newChat(state, els) {
    state.api.clearHistory(state.sessionId).catch(function () {});
    var newId = uuid();
    state.sessionId = newId;
    persistSessionId(state.cfg.appId, newId);
    state.messages = []; state.conversationHistory = [];
    state.suggestions = []; state.userHasSent = false;
    els.messages.innerHTML =
      '<div class="cb-welcome">' +
        '<div class="cb-welcome-icon">👋</div>' +
        '<h3 class="cb-welcome-title">Hi there! How can we help?</h3>' +
        '<p class="cb-welcome-sub">Ask anything or pick a common question below.</p>' +
      '</div>';
    els.newBtn.style.display = "none";
    renderQuickReplies(state, els, state.allFaqs, "Suggested questions");
  }

  // ─────────────────────────────────────────────────────────────
  // ESCALATION MODAL
  // ─────────────────────────────────────────────────────────────
  function openEscalation(state, els) {
    els.modal.querySelector(".cb-modal-body").innerHTML = [
      '<div class="cb-submit-err"></div>',
      '<div class="cb-form-group"><label class="cb-form-label">Full Name <span>*</span></label>',
      '<input class="cb-form-input cb-esc-name" type="text" placeholder="Jane Smith" autocomplete="name">',
      '<div class="cb-field-err cb-err-name"></div></div>',
      '<div class="cb-form-group"><label class="cb-form-label">Email <span>*</span></label>',
      '<input class="cb-form-input cb-esc-email" type="email" placeholder="jane@company.com" autocomplete="email">',
      '<div class="cb-field-err cb-err-email"></div></div>',
      '<div class="cb-form-group"><label class="cb-form-label">Issue</label>',
      '<textarea class="cb-form-textarea cb-esc-issue" placeholder="Describe your issue…" rows="3"></textarea></div>',
      '<div class="cb-modal-actions">',
      '<button class="cb-btn cb-btn-secondary cb-modal-cancel">Cancel</button>',
      '<button class="cb-btn cb-btn-primary cb-modal-submit">📨 Submit</button>',
      '</div>',
    ].join("");
    els.modal.querySelector(".cb-modal-cancel").addEventListener("click", function () { els.modal.classList.add("cb-hidden"); });
    els.modal.querySelector(".cb-modal-submit").addEventListener("click", function () { submitEscalation(state, els); });
    els.modal.classList.remove("cb-hidden");
    setTimeout(function () { var n = els.modal.querySelector(".cb-esc-name"); if (n) n.focus(); }, 100);
  }

  function submitEscalation(state, els) {
    var name  = (els.modal.querySelector(".cb-esc-name").value  || "").trim();
    var email = (els.modal.querySelector(".cb-esc-email").value || "").trim();
    var issue = (els.modal.querySelector(".cb-esc-issue").value || "").trim();
    ["name","email"].forEach(function(f){ var el = els.modal.querySelector(".cb-err-"+f); if(el){el.textContent="";el.style.display="none";} });
    var submitErr = els.modal.querySelector(".cb-submit-err");
    submitErr.style.display = "none";
    var valid = true;
    if (!name)   { var en=els.modal.querySelector(".cb-err-name"); en.textContent="⚠ Name is required."; en.style.display="block"; valid=false; }
    if (!email)  { var ee=els.modal.querySelector(".cb-err-email"); ee.textContent="⚠ Email is required."; ee.style.display="block"; valid=false; }
    else if (!/\S+@\S+\.\S+/.test(email)) { var ee2=els.modal.querySelector(".cb-err-email"); ee2.textContent="⚠ Valid email required."; ee2.style.display="block"; valid=false; }
    if (!valid) return;

    var btn = els.modal.querySelector(".cb-modal-submit");
    btn.disabled = true; btn.innerHTML = '<div class="cb-spinner"></div> Submitting…';

    state.api.escalate({ name, email, issue: issue || "No details provided", conversationHistory: state.conversationHistory })
      .then(function (res) {
        els.modal.querySelector(".cb-modal-body").innerHTML =
          '<div class="cb-modal-success"><span class="cb-success-icon">✅</span>' +
          '<h2 class="cb-success-title">You\'re all set!</h2>' +
          '<p class="cb-success-text">We\'ll reach out to <strong>' + sanitize(email) + '</strong> within 24 hours.<br>Ticket ID:</p>' +
          '<div class="cb-ticket-id">' + sanitize(res.ticketId) + '</div>' +
          '<div style="margin-top:20px"><button class="cb-btn cb-btn-primary cb-success-close" style="display:inline-flex;max-width:130px">Close</button></div></div>';
        els.modal.querySelector(".cb-success-close").addEventListener("click", function () { els.modal.classList.add("cb-hidden"); });
      })
      .catch(function (err) {
        btn.disabled = false; btn.innerHTML = "📨 Submit";
        submitErr.textContent = "⚠️ " + (err.message || "Submission failed. Try again.");
        submitErr.style.display = "block";
      });
  }

  // ─────────────────────────────────────────────────────────────
  // WIRE EVENTS
  // ─────────────────────────────────────────────────────────────
  function wireEvents(state, els) {
    els.launcher.addEventListener("click", function () {
      var willOpen = els.root.classList.contains("cb-hidden");
      if (willOpen) {
        els.root.classList.remove("cb-hidden");
        state.isOpen = true;
        if (!state.historyLoaded) loadHistory(state, els);
        setTimeout(function () { els.textarea.focus(); }, 200);
        // Hide tooltip after open
        if (els.tooltip) els.tooltip.style.display = "none";
      } else {
        els.root.classList.add("cb-hidden");
        state.isOpen = false;
        if (els.tooltip) els.tooltip.style.display = "flex";
      }
    });

    els.closeBtn.addEventListener("click", function () {
      els.root.classList.add("cb-hidden");
      state.isOpen = false;
      if (els.tooltip) els.tooltip.style.display = "flex";
    });

    els.newBtn.addEventListener("click", function () { newChat(state, els); });
    els.humanBtn.addEventListener("click", function () { openEscalation(state, els); });

    els.textarea.addEventListener("input", function () {
      els.textarea.style.height = "auto";
      els.textarea.style.height = Math.min(els.textarea.scrollHeight, 100) + "px";
      els.sendBtn.disabled = !els.textarea.value.trim() || state.isTyping;
    });

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

    els.sendBtn.addEventListener("click", function () {
      var text = els.textarea.value.trim();
      if (text && !state.isTyping) {
        els.textarea.value = "";
        els.textarea.style.height = "auto";
        els.sendBtn.disabled = true;
        sendMessage(state, els, text);
      }
    });

    els.modal.addEventListener("click", function (e) { if (e.target === els.modal) els.modal.classList.add("cb-hidden"); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !els.modal.classList.contains("cb-hidden")) els.modal.classList.add("cb-hidden"); });
  }

  // ─────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────
  function createDeferredApi() {
    var resolvedApi = null, queuedCalls = [], readyResolve;
    var ready = new Promise(function (resolve) { readyResolve = resolve; });
    function invoke(method, args) {
      if (resolvedApi) return resolvedApi[method].apply(resolvedApi, args);
      queuedCalls.push({ method, args });
    }
    return {
      api: {
        open: function () { return invoke("open", arguments); },
        close: function () { return invoke("close", arguments); },
        sendMessage: function () { return invoke("sendMessage", arguments); },
        clearHistory: function () { return invoke("clearHistory", arguments); },
        destroy: function () { return invoke("destroy", arguments); },
        ready,
      },
      resolve: function (api) {
        resolvedApi = api; readyResolve(api);
        while (queuedCalls.length) { var c = queuedCalls.shift(); resolvedApi[c.method].apply(resolvedApi, c.args); }
      },
    };
  }

  function initChatbot(userConfig) {
    var deferred = createDeferredApi();
    function boot() {
      var cfg   = mergeConfig(userConfig);
      var state = createState(cfg);
      injectStyles(cfg);
      var els   = buildDOM(cfg);
      wireEvents(state, els);
      console.log('[ChatBot] Ready — appId: "' + cfg.appId + '"' + (cfg.apiUrl ? ', api: "' + cfg.apiUrl + '"' : ', api: same-origin'));
      return {
        open: function () {
          els.root.classList.remove("cb-hidden");
          state.isOpen = true;
          if (!state.historyLoaded) loadHistory(state, els);
          if (els.tooltip) els.tooltip.style.display = "none";
        },
        close: function () {
          els.root.classList.add("cb-hidden");
          state.isOpen = false;
          if (els.tooltip) els.tooltip.style.display = "flex";
        },
        sendMessage: function (text) {
          if (!state.isOpen) this.open();
          setTimeout(function () { sendMessage(state, els, text); }, state.historyLoaded ? 0 : 600);
        },
        clearHistory: function () { newChat(state, els); },
        destroy: function () {
          ["cb-styles", "cb-root", "cb-launcher-wrap", "cb-modal"].forEach(function (id) {
            var el = document.getElementById(id); if (el) el.remove();
          });
          global.__chatbotLoaded = false;
        },
      };
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { deferred.resolve(boot()); });
      return deferred.api;
    }
    deferred.resolve(boot());
    return deferred.api;
  }

  global.initChatbot = initChatbot;

})(window);