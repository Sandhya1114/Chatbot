// ============================================================
// routes/escalation.js - Human Escalation Endpoint
// POST /api/escalate  → Log escalation + email agent
// GET  /api/escalate  → Fetch all escalation records (admin)
// ============================================================

const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const nodemailer = require("nodemailer");
const { increment, addEscalation, getEscalations } = require("../utils/store");

// ============================================================
// Email transporter — reused across requests (singleton)
// ============================================================
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

// ============================================================
// sendAgentAlert — fires after ticket is saved
// Non-blocking: errors are logged but never crash the request
// ============================================================
async function sendAgentAlert(ticket) {
  const { id, name, email, issue, conversationHistory, createdAt } = ticket;

  // Build a readable chat transcript
  const transcript = conversationHistory.length
    ? conversationHistory
      .map((m) => `[${m.role === "bot" ? "Bot" : "User"}] ${m.content}`)
      .join("\n")
    : "No conversation history.";

  const mailOptions = {
    from: `"Chatbot Alerts" <${process.env.GMAIL_USER}>`,
    to: process.env.SUPPORT_EMAIL,
    subject: `🎫 New Support Ticket ${id.slice(0, 8).toUpperCase()} — ${name}`,
    text: [
      `New escalation request received.`,
      ``,
      `Ticket ID : ${id}`,
      `Name      : ${name}`,
      `Email     : ${email}`,
      `Submitted : ${new Date(createdAt).toLocaleString()}`,
      ``,
      `Issue:`,
      issue,
      ``,
      `Chat Transcript:`,
      transcript,
      ``,
      `Reply directly to this email to contact the user.`,
    ].join("\n"),
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#4f46e5;color:white;padding:20px 24px;border-radius:8px 8px 0 0">
          <h2 style="margin:0;font-size:18px">🎫 New Support Ticket</h2>
          <p style="margin:4px 0 0;opacity:.85;font-size:13px">Ticket ${id.slice(0, 8).toUpperCase()}</p>
        </div>
        <div style="background:#f8fafc;padding:20px 24px;border:1px solid #e2e8f0;border-top:0">
          <table style="width:100%;font-size:14px;border-collapse:collapse">
            <tr><td style="color:#64748b;padding:6px 0;width:90px">Name</td>
                <td style="font-weight:600;color:#0f172a">${name}</td></tr>
            <tr><td style="color:#64748b;padding:6px 0">Email</td>
                <td><a href="mailto:${email}" style="color:#4f46e5">${email}</a></td></tr>
            <tr><td style="color:#64748b;padding:6px 0">Submitted</td>
                <td style="color:#0f172a">${new Date(createdAt).toLocaleString()}</td></tr>
          </table>

          <div style="margin-top:16px">
            <p style="font-size:12px;color:#64748b;margin:0 0 6px;text-transform:uppercase;letter-spacing:.05em">Issue</p>
            <div style="background:white;border:1px solid #e2e8f0;border-radius:6px;padding:12px;font-size:14px;color:#0f172a;white-space:pre-wrap">${issue}</div>
          </div>

          <div style="margin-top:16px">
            <p style="font-size:12px;color:#64748b;margin:0 0 6px;text-transform:uppercase;letter-spacing:.05em">Chat Transcript</p>
            <div style="background:white;border:1px solid #e2e8f0;border-radius:6px;padding:12px;font-size:13px;color:#334155;white-space:pre-wrap;max-height:300px;overflow:auto">${conversationHistory.length
        ? conversationHistory
          .map((m) =>
            `<span style="color:${m.role === "bot" ? "#4f46e5" : "#0f172a"};font-weight:600">${m.role === "bot" ? "Bot" : "User"}:</span> ${m.content}`
          )
          .join("\n")
        : "No conversation history."
      }</div>
          </div>

          <div style="margin-top:20px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:13px;color:#64748b">
            Reply to this email to contact <strong>${name}</strong> directly at ${email}.
          </div>
        </div>
      </div>
    `,
    // Makes "Reply" in Gmail go straight to the user
    replyTo: email,
  };

  await transporter.sendMail(mailOptions);
  console.log(`[Escalation] Alert email sent for ticket ${id}`);
}

// ============================================================
// POST /api/escalate
// ============================================================
router.post("/", async (req, res) => {
  const { name, email, issue, conversationHistory = [] } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: "Name and email are required." });
  }

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
    await addEscalation(escalationRecord);
    increment("escalations").catch(() => { });

    // Send alert email — non-blocking so a mail failure never blocks the user
    sendAgentAlert(escalationRecord).catch((err) =>
      console.error("[Escalation] Email alert failed:", err.message)
    );

    console.log(`[ESCALATION] New request from ${name} (${email}) — ID: ${escalationRecord.id}`);

    return res.status(201).json({
      success: true,
      message: "Your request has been received. A human agent will contact you within 24 hours.",
      ticketId: escalationRecord.id,
      timestamp: escalationRecord.createdAt,
    });
  } catch (err) {
    console.error("[Escalation] Failed to save:", err.message);
    return res.status(500).json({ error: "Failed to submit escalation. Please try again." });
  }
});

// ============================================================
// GET /api/escalate  (admin)
// ============================================================
router.get("/", async (req, res) => {
  try {
    const escalations = await getEscalations();
    res.json({
      total: escalations.length,
      escalations: escalations.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    });
  } catch (err) {
    console.error("[Escalation] Fetch error:", err.message);
    res.status(500).json({ error: "Failed to fetch escalations." });
  }
});

module.exports = router;