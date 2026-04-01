// ============================================================
// hooks/useChat.js - Custom Hook for All Chat Logic
// Separates business logic from UI components
// ============================================================

import { useState, useCallback, useRef } from 'react';

// Helper: create a message object with consistent shape
const createMessage = (role, content, source = null, extra = {}) => ({
  id: Date.now() + Math.random(), // Simple unique ID
  role,           // 'user' or 'bot'
  content,
  source,         // 'faq', 'ai', or null (for user messages)
  timestamp: new Date().toISOString(),
  ...extra,
});

export function useChat() {
  const [messages, setMessages] = useState([]);         // All chat messages
  const [isTyping, setIsTyping] = useState(false);     // Bot typing indicator
  const [error, setError] = useState(null);             // Error state

  // We keep conversationHistory separately for the AI API context
  // It only contains user/assistant pairs (not system messages)
  const conversationHistory = useRef([]);

  // ---- Send a message to the backend ----
  const sendMessage = useCallback(async (text) => {
    if (!text.trim()) return;

    setError(null);

    // Add user message to the UI immediately (optimistic UI)
    const userMsg = createMessage('user', text);
    setMessages(prev => [...prev, userMsg]);

    // Add to conversation history for AI context
    conversationHistory.current.push({ role: 'user', content: text });

    // Show typing indicator
    setIsTyping(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversationHistory: conversationHistory.current.slice(-10), // last 10 turns
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Server error');
      }

      const data = await response.json();

      // Add bot reply to UI
      const botMsg = createMessage('bot', data.reply, data.source, {
        faqQuestion: data.faqQuestion,
      });
      setMessages(prev => [...prev, botMsg]);

      // Add to conversation history
      conversationHistory.current.push({ role: 'assistant', content: data.reply });

    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
      // Add error message in the chat
      const errMsg = createMessage('bot', '⚠️ Sorry, I couldn\'t process your request. Please try again or click "Talk to Human" for help.', null);
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setIsTyping(false);
    }
  }, []);

  // ---- Clear all messages ----
  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    conversationHistory.current = [];
  }, []);

  return {
    messages,
    isTyping,
    error,
    sendMessage,
    clearMessages,
    conversationHistory: conversationHistory.current,
  };
}
