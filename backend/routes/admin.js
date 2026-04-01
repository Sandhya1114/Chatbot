// ============================================================
// routes/admin.js - Admin Dashboard Endpoints
// GET  /api/admin/analytics    → View analytics data
// POST /api/admin/faqs/upload  → Upload new FAQ (JSON)
// PUT  /api/admin/faqs/:id     → Update a specific FAQ
// DELETE /api/admin/faqs/:id   → Delete a specific FAQ
// GET  /api/admin/faqs         → View all FAQs with full details
// ============================================================

const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { getAnalytics } = require("../utils/store");
const { loadFAQs } = require("../utils/faqMatcher");

const FAQ_FILE = path.join(__dirname, "../data/faqs.json");

// Configure multer for file uploads (stores in memory)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    // Accept only JSON and CSV files
    if (file.mimetype === "application/json" || file.mimetype === "text/csv" || file.originalname.endsWith(".json")) {
      cb(null, true);
    } else {
      cb(new Error("Only JSON and CSV files are allowed."));
    }
  },
});

// ============================================================
// GET /api/admin/analytics
// Returns all analytics data
// ============================================================
router.get("/analytics", (req, res) => {
  const data = getAnalytics();
  res.json({
    ...data,
    faqAnsweredPercent: data.totalQueries > 0 ? ((data.faqAnswered / data.totalQueries) * 100).toFixed(1) : 0,
    aiAnsweredPercent: data.totalQueries > 0 ? ((data.aiAnswered / data.totalQueries) * 100).toFixed(1) : 0,
    escalationRate: data.totalQueries > 0 ? ((data.escalations / data.totalQueries) * 100).toFixed(1) : 0,
  });
});

// ============================================================
// GET /api/admin/faqs
// Returns all FAQs with full details (for admin view)
// ============================================================
router.get("/faqs", (req, res) => {
  try {
    const faqs = loadFAQs();
    res.json({ total: faqs.length, faqs });
  } catch (err) {
    res.status(500).json({ error: "Failed to load FAQs." });
  }
});

// ============================================================
// POST /api/admin/faqs/upload
// Upload a new FAQ JSON file — replaces the entire FAQ database
// Accepts: multipart file OR raw JSON body
// ============================================================
router.post("/faqs/upload", upload.single("file"), (req, res) => {
  try {
    let newFAQs;

    if (req.file) {
      // Parse uploaded JSON file
      newFAQs = JSON.parse(req.file.buffer.toString("utf-8"));
    } else if (req.body && Array.isArray(req.body)) {
      // Accept raw JSON body as well
      newFAQs = req.body;
    } else if (req.body && req.body.faqs) {
      newFAQs = req.body.faqs;
    } else {
      return res.status(400).json({ error: "Please provide a valid JSON file or JSON array in the request body." });
    }

    // Validate structure: each FAQ must have keywords, question, answer
    if (!Array.isArray(newFAQs)) {
      return res.status(400).json({ error: "FAQ data must be a JSON array." });
    }

    for (let i = 0; i < newFAQs.length; i++) {
      const faq = newFAQs[i];
      if (!faq.keywords || !faq.question || !faq.answer) {
        return res.status(400).json({
          error: `FAQ at index ${i} is missing required fields: keywords, question, answer.`,
        });
      }
      // Assign IDs if missing
      if (!faq.id) faq.id = i + 1;
    }

    // Save to file
    fs.writeFileSync(FAQ_FILE, JSON.stringify(newFAQs, null, 2), "utf-8");

    res.json({
      success: true,
      message: `FAQ database updated successfully with ${newFAQs.length} entries.`,
      total: newFAQs.length,
    });

  } catch (err) {
    console.error("FAQ upload error:", err.message);
    res.status(500).json({ error: "Failed to parse or save FAQ data. " + err.message });
  }
});

// ============================================================
// PUT /api/admin/faqs/:id
// Update a specific FAQ entry
// ============================================================
router.put("/faqs/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const faqs = loadFAQs();
    const index = faqs.findIndex((f) => f.id === id);

    if (index === -1) {
      return res.status(404).json({ error: `FAQ with ID ${id} not found.` });
    }

    // Merge updated fields
    faqs[index] = { ...faqs[index], ...req.body, id }; // Keep original ID
    fs.writeFileSync(FAQ_FILE, JSON.stringify(faqs, null, 2), "utf-8");

    res.json({ success: true, message: "FAQ updated successfully.", faq: faqs[index] });
  } catch (err) {
    res.status(500).json({ error: "Failed to update FAQ." });
  }
});

// ============================================================
// DELETE /api/admin/faqs/:id
// Remove a FAQ entry
// ============================================================
router.delete("/faqs/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const faqs = loadFAQs();
    const newFAQs = faqs.filter((f) => f.id !== id);

    if (newFAQs.length === faqs.length) {
      return res.status(404).json({ error: `FAQ with ID ${id} not found.` });
    }

    fs.writeFileSync(FAQ_FILE, JSON.stringify(newFAQs, null, 2), "utf-8");
    res.json({ success: true, message: "FAQ deleted successfully.", remaining: newFAQs.length });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete FAQ." });
  }
});

module.exports = router;
