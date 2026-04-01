// ============================================================
// hooks/useChat.js - Custom Hook for All Chat Logic
// ============================================================

import { useState, useCallback, useRef } from 'react';

const createMessage = (role, content, source = null, extra = {}) => ({
  id: Date.now() + Math.random(),
  role,           // 'user' or 'bot'
  content,
  source,         // 'faq', 'ai', or null
  timestamp: new Date().toISOString(),
  ...extra,
});

export function useChat() {
  const [messages, setMessages] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState(null);

  // ── NEW: contextual suggestions returned by the last bot reply ──
  // These are shown as quick-reply buttons AFTER a response.
  const [suggestions, setSuggestions] = useState([]);

  const conversationHistory = useRef([]);

  const sendMessage = useCallback(async (text) => {
    if (!text.trim()) return;

    setError(null);
    // Clear suggestions while waiting for the new response
    setSuggestions([]);

    const userMsg = createMessage('user', text);
    setMessages(prev => [...prev, userMsg]);
    conversationHistory.current.push({ role: 'user', content: text });

    setIsTyping(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversationHistory: conversationHistory.current.slice(-10),
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Server error');
      }

      const data = await response.json();

      const botMsg = createMessage('bot', data.reply, data.source, {
        faqQuestion: data.faqQuestion,
      });
      setMessages(prev => [...prev, botMsg]);

      conversationHistory.current.push({ role: 'assistant', content: data.reply });

      // ── Store contextual suggestions from this response ──
      if (Array.isArray(data.suggestions) && data.suggestions.length > 0) {
        setSuggestions(data.suggestions);
      } else {
        setSuggestions([]);
      }

    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
      const errMsg = createMessage(
        'bot',
        '⚠️ Sorry, I couldn\'t process your request. Please try again or click "Talk to Human" for help.',
        null
      );
      setMessages(prev => [...prev, errMsg]);
      setSuggestions([]);
    } finally {
      setIsTyping(false);
    }
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setSuggestions([]);
    conversationHistory.current = [];
  }, []);

  return {
    messages,
    isTyping,
    error,
    suggestions,          // ← contextual suggestions after each reply
    sendMessage,
    clearMessages,
    conversationHistory: conversationHistory.current,
  };
}