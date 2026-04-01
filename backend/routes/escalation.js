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
router.post("/", async (req, res) => {
  const { name, email, issue, conversationHistory = [] } = req.body;

  // Basic validation
  if (!name || !email) {
    return res
      .status(400)
      .json({ error: "Name and email are required to connect with a human agent." });
  }

  // Email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: "Please provide a valid email address." });
  }

  const escalationRecord = {
    id: uuidv4(),
    name: name.trim(),
    email: email.trim().toLowerCase(),
    issue: issue?.trim() || "No specific issue provided",
    status: "pending",
    conversationHistory,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  };

  try {
    // addEscalation is async — must await it
    await addEscalation(escalationRecord);

    // Fire-and-forget analytics increment
    increment("escalations").catch(() => {});

    console.log(
      `[ESCALATION] New request from ${name} (${email}) - ID: ${escalationRecord.id}`
    );

    return res.status(201).json({
      success: true,
      message:
        "Your request has been received. A human agent will contact you within 24 hours.",
      ticketId: escalationRecord.id,
      timestamp: escalationRecord.createdAt,
    });
  } catch (err) {
    console.error("[Escalation] Failed to save:", err.message);
    return res
      .status(500)
      .json({ error: "Failed to submit escalation. Please try again." });
  }
});

// ============================================================
// GET /api/escalate
// Admin endpoint to view all escalation requests
// ============================================================
router.get("/", async (req, res) => {
  try {
    // getEscalations is async — must await it
    const escalations = await getEscalations();
    res.json({
      total: escalations.length,
      escalations: escalations.sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
      ),
    });
  } catch (err) {
    console.error("[Escalation] Fetch error:", err.message);
    res.status(500).json({ error: "Failed to fetch escalations." });
  }
});

module.exports = router;