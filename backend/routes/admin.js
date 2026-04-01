// ============================================================
// routes/admin.js - Admin Dashboard Endpoints
// GET    /api/admin/analytics      → View analytics + escalations list
// GET    /api/admin/faqs           → View all FAQs
// POST   /api/admin/faqs/upload    → Upload/replace FAQ database
// PUT    /api/admin/faqs/:id       → Update a specific FAQ
// DELETE /api/admin/faqs/:id       → Delete a specific FAQ
// ============================================================

const express = require("express");
const router = express.Router();
const multer = require("multer");
const { supabase } = require("../utils/supabase");
const { getAnalytics, getEscalations } = require("../utils/store");
const { loadFAQs, invalidateFAQCache } = require("../utils/faqMatcher");

// Configure multer for file uploads (stores in memory)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype === "application/json" ||
      file.mimetype === "text/csv" ||
      file.originalname.endsWith(".json")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only JSON files are allowed."));
    }
  },
});

// ============================================================
// GET /api/admin/analytics
// Returns analytics counters + full escalations list
// ============================================================
router.get("/analytics", async (req, res) => {
  try {
    // Both functions are async — must await them
    const [data, escalationsList] = await Promise.all([
      getAnalytics(),
      getEscalations(),
    ]);

    res.json({
      totalQueries: data.totalQueries,
      faqAnswered: data.faqAnswered,
      aiAnswered: data.aiAnswered,
      escalations: data.escalations,
      faqAnsweredPercent:
        data.totalQueries > 0
          ? ((data.faqAnswered / data.totalQueries) * 100).toFixed(1)
          : 0,
      aiAnsweredPercent:
        data.totalQueries > 0
          ? ((data.aiAnswered / data.totalQueries) * 100).toFixed(1)
          : 0,
      escalationRate:
        data.totalQueries > 0
          ? ((data.escalations / data.totalQueries) * 100).toFixed(1)
          : 0,
      // Include the full list so the dashboard table works
      escalationsList,
    });
  } catch (err) {
    console.error("[Admin] Analytics error:", err.message);
    res.status(500).json({ error: "Failed to load analytics." });
  }
});

// ============================================================
// GET /api/admin/faqs
// Returns all FAQs from Supabase
// ============================================================
router.get("/faqs", async (req, res) => {
  try {
    const faqs = await loadFAQs();
    res.json({ total: faqs.length, faqs });
  } catch (err) {
    console.error("[Admin] Load FAQs error:", err.message);
    res.status(500).json({ error: "Failed to load FAQs." });
  }
});

// ============================================================
// POST /api/admin/faqs/upload
// Replaces the ENTIRE FAQ table in Supabase.
// Accepts: multipart file OR raw JSON body (array or { faqs: [] })
// ============================================================
router.post("/faqs/upload", upload.single("file"), async (req, res) => {
  try {
    let newFAQs;

    if (req.file) {
      // Multipart file upload
      newFAQs = JSON.parse(req.file.buffer.toString("utf-8"));
    } else if (req.body && Array.isArray(req.body)) {
      newFAQs = req.body;
    } else if (req.body && Array.isArray(req.body.faqs)) {
      newFAQs = req.body.faqs;
    } else {
      return res
        .status(400)
        .json({ error: "Provide a JSON array or { faqs: [] } body." });
    }

    if (!Array.isArray(newFAQs)) {
      return res.status(400).json({ error: "FAQ data must be a JSON array." });
    }

    // Validate each entry
    for (let i = 0; i < newFAQs.length; i++) {
      const faq = newFAQs[i];
      if (!faq.keywords || !faq.question || !faq.answer) {
        return res.status(400).json({
          error: `FAQ at index ${i} is missing required fields: keywords, question, answer.`,
        });
      }
      // Ensure keywords is an array
      if (!Array.isArray(faq.keywords)) {
        faq.keywords = String(faq.keywords)
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean);
      }
      // Assign IDs if missing
      if (!faq.id) faq.id = i + 1;
    }

    // --- Write to Supabase ---
    // 1. Delete all existing FAQs
    const { error: deleteError } = await supabase
      .from("faqs")
      .delete()
      .neq("id", 0); // delete all rows (neq 0 matches every row)

    if (deleteError) {
      console.error("[Admin] FAQ delete error:", deleteError.message);
      return res
        .status(500)
        .json({ error: "Failed to clear existing FAQs: " + deleteError.message });
    }

    // 2. Insert new FAQs
    const rows = newFAQs.map((faq) => ({
      id: faq.id,
      question: faq.question,
      answer: faq.answer,
      keywords: faq.keywords, // Supabase handles JSONB automatically
    }));

    const { error: insertError } = await supabase.from("faqs").insert(rows);

    if (insertError) {
      console.error("[Admin] FAQ insert error:", insertError.message);
      return res
        .status(500)
        .json({ error: "Failed to insert FAQs: " + insertError.message });
    }

    // 3. Bust the in-memory cache so faqMatcher picks up new data immediately
    invalidateFAQCache();

    console.log(`[Admin] FAQ database replaced with ${newFAQs.length} entries`);

    res.json({
      success: true,
      message: `FAQ database updated with ${newFAQs.length} entries.`,
      total: newFAQs.length,
    });
  } catch (err) {
    console.error("[Admin] FAQ upload error:", err.message);
    res
      .status(500)
      .json({ error: "Failed to parse or save FAQ data: " + err.message });
  }
});

// ============================================================
// PUT /api/admin/faqs/:id
// Update a single FAQ in Supabase
// ============================================================
router.put("/faqs/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { question, answer, keywords } = req.body;

    const updateData = {};
    if (question !== undefined) updateData.question = question;
    if (answer !== undefined) updateData.answer = answer;
    if (keywords !== undefined) {
      updateData.keywords = Array.isArray(keywords)
        ? keywords
        : String(keywords)
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean);
    }

    const { data, error } = await supabase
      .from("faqs")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return res.status(404).json({ error: `FAQ ${id} not found or update failed.` });
    }

    invalidateFAQCache();
    res.json({ success: true, message: "FAQ updated.", faq: data });
  } catch (err) {
    console.error("[Admin] FAQ update error:", err.message);
    res.status(500).json({ error: "Failed to update FAQ." });
  }
});

// ============================================================
// DELETE /api/admin/faqs/:id
// Remove a FAQ from Supabase
// ============================================================
router.delete("/faqs/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);

    const { error } = await supabase.from("faqs").delete().eq("id", id);

    if (error) {
      return res.status(404).json({ error: `FAQ ${id} not found.` });
    }

    invalidateFAQCache();
    res.json({ success: true, message: "FAQ deleted." });
  } catch (err) {
    console.error("[Admin] FAQ delete error:", err.message);
    res.status(500).json({ error: "Failed to delete FAQ." });
  }
});

module.exports = router;