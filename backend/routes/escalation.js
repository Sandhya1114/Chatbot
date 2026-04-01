// ============================================================
// routes/escalation.js - Human Escalation Endpoint
// POST /api/escalate  → Log an escalation request
// GET  /api/escalate  → Fetch all escalation records (admin)
// ============================================================

const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const { increment, addEscalation, getEscalations } = require("../utils/store");

// ============================================================
// POST /api/escalate
// Called when user clicks "Talk to Human" button
// Body: { name, email, issue, conversationHistory }
// ============================================================
router.post("/", (req, res) => {
  const { name, email, issue, conversationHistory = [] } = req.body;

  // Basic validation
  if (!name || !email) {
    return res.status(400).json({ error: "Name and email are required to connect with a human agent." });
  }

  // Email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: "Please provide a valid email address." });
  }

  // Create an escalation record
  const escalationRecord = {
    id: uuidv4(),               // Unique ID for tracking
    name: name.trim(),
    email: email.trim().toLowerCase(),
    issue: issue?.trim() || "No specific issue provided",
    status: "pending",          // pending | in-progress | resolved
    conversationHistory,        // Save the chat history for context
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  };

  // Save to in-memory store (replace with DB in production)
  addEscalation(escalationRecord);
  increment("escalations");

  console.log(`[ESCALATION] New request from ${name} (${email}) - ID: ${escalationRecord.id}`);

  return res.status(201).json({
    success: true,
    message: "Your request has been received. A human agent will contact you within 24 hours.",
    ticketId: escalationRecord.id,
    timestamp: escalationRecord.createdAt,
  });
});

// ============================================================
// GET /api/escalate
// Admin endpoint to view all escalation requests
// ============================================================
router.get("/", (req, res) => {
  const escalations = getEscalations();
  res.json({
    total: escalations.length,
    escalations: escalations.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)), // newest first
  });
});

module.exports = router;
