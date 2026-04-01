// ============================================================
// routes/admin.js - Admin Dashboard Endpoints
// GET    /api/admin/analytics      → View analytics + escalations list
// GET    /api/admin/faqs           → View all FAQs
// POST   /api/admin/faqs/upload    → Upload FAQs (APPEND mode by default)
// PUT    /api/admin/faqs/:id       → Update a specific FAQ
// DELETE /api/admin/faqs/:id       → Delete a specific FAQ
// ============================================================

const express = require("express");
const router = express.Router();
const multer = require("multer");
const { supabase } = require("../utils/supabase");
const { getAnalytics, getEscalations } = require("../utils/store");
const { loadFAQs, invalidateFAQCache } = require("../utils/faqMatcher");

// ============================================================
// PDF text extraction helper (uses pdf-parse if installed)
// ============================================================
async function extractTextFromPDF(buffer) {
  try {
    const pdfParse = require("pdf-parse");
    const result = await pdfParse(buffer);
    return result.text;
  } catch (err) {
    throw new Error(
      "pdf-parse is required for PDF uploads. Run: npm install pdf-parse\n" + err.message
    );
  }
}

// ============================================================
// CSV parser — no external dependency needed
// Handles quoted fields, commas inside quotes, multi-line answers
// Expected columns: id (opt), question, answer, keywords
// ============================================================
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length < 2) throw new Error("CSV must have a header row and at least one data row.");

  // Parse a single CSV line respecting quoted fields
  function parseLine(line) {
    const fields = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());
    return fields;
  }

  const headers = parseLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  const qIdx = headers.indexOf("question");
  const aIdx = headers.indexOf("answer");
  const kIdx = headers.indexOf("keywords");
  const idIdx = headers.indexOf("id");

  if (qIdx === -1 || aIdx === -1) {
    throw new Error('CSV must contain "question" and "answer" columns.');
  }

  const faqs = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const fields = parseLine(line);
    const question = fields[qIdx]?.replace(/^"|"$/g, "").trim();
    const answer = fields[aIdx]?.replace(/^"|"$/g, "").trim();
    if (!question || !answer) continue;

    let keywords = [];
    if (kIdx !== -1 && fields[kIdx]) {
      const raw = fields[kIdx].replace(/^"|"$/g, "").trim();
      keywords = raw.split(/[;,|]/).map((k) => k.trim()).filter(Boolean);
    }

    faqs.push({
      id: idIdx !== -1 ? parseInt(fields[idIdx]) || null : null,
      question,
      answer,
      keywords,
    });
  }

  return faqs;
}

// ============================================================
// PDF → FAQ parser
// Tries to extract structured FAQ pairs from raw PDF text.
// Looks for patterns like "Q: ..." / "A: ..." or numbered items.
// ============================================================
function parsePDFTextToFAQs(rawText) {
  const faqs = [];

  // Strategy 1: Q: / A: pattern
  const qaPattern = /Q[:\.\)]\s*(.+?)\s*A[:\.\)]\s*([\s\S]+?)(?=Q[:\.\)]|$)/gi;
  let match;
  while ((match = qaPattern.exec(rawText)) !== null) {
    const question = match[1].trim();
    const answer = match[2].trim();
    if (question && answer) {
      const keywords = question
        .toLowerCase()
        .replace(/[^\w\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 3);
      faqs.push({ question, answer, keywords });
    }
  }

  if (faqs.length > 0) return faqs;

  // Strategy 2: Numbered questions (1. Question\nAnswer)
  const numbered = rawText.split(/\n(?=\d+[\.\)])/);
  for (const block of numbered) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length >= 2) {
      const question = lines[0].replace(/^\d+[\.\)]\s*/, "").trim();
      const answer = lines.slice(1).join(" ").trim();
      if (question && answer) {
        const keywords = question
          .toLowerCase()
          .replace(/[^\w\s]/g, "")
          .split(/\s+/)
          .filter((w) => w.length > 3);
        faqs.push({ question, answer, keywords });
      }
    }
  }

  if (faqs.length === 0) {
    throw new Error(
      "Could not parse FAQs from PDF. Ensure the PDF contains Q:/A: pairs or numbered Q&A blocks."
    );
  }

  return faqs;
}

// ============================================================
// Multer config — accepts JSON, CSV, and PDF
// ============================================================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const allowed =
      file.mimetype === "application/json" ||
      file.mimetype === "text/csv" ||
      file.mimetype === "application/pdf" ||
      file.originalname.endsWith(".json") ||
      file.originalname.endsWith(".csv") ||
      file.originalname.endsWith(".pdf");
    if (allowed) cb(null, true);
    else cb(new Error("Only JSON, CSV, and PDF files are allowed."));
  },
});

// ============================================================
// GET /api/admin/analytics
// ============================================================
router.get("/analytics", async (req, res) => {
  try {
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
      escalationsList,
    });
  } catch (err) {
    console.error("[Admin] Analytics error:", err.message);
    res.status(500).json({ error: "Failed to load analytics." });
  }
});

// ============================================================
// GET /api/admin/faqs
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
//
// FIX 1: APPEND mode by default — pass ?replace=true to overwrite all
// FIX 2: Accepts JSON, CSV, and PDF files
//
// Query params:
//   ?replace=true  → wipe existing FAQs then insert (old behaviour)
//   (default)      → APPEND new FAQs alongside existing ones
// ============================================================
router.post("/faqs/upload", upload.single("file"), async (req, res) => {
  try {
    const replaceMode = req.query.replace === "true";
    let newFAQs = [];

    // ---- 1. Parse incoming data ----
    if (req.file) {
      const filename = req.file.originalname.toLowerCase();
      const mime = req.file.mimetype;

      if (mime === "application/json" || filename.endsWith(".json")) {
        // --- JSON ---
        const text = req.file.buffer.toString("utf-8");
        const parsed = JSON.parse(text);
        newFAQs = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed?.faqs)
          ? parsed.faqs
          : null;
        if (!newFAQs) throw new Error("JSON must be an array or { faqs: [] }.");

      } else if (mime === "text/csv" || filename.endsWith(".csv")) {
        // --- CSV ---
        const text = req.file.buffer.toString("utf-8");
        newFAQs = parseCSV(text);

      } else if (mime === "application/pdf" || filename.endsWith(".pdf")) {
        // --- PDF ---
        const rawText = await extractTextFromPDF(req.file.buffer);
        newFAQs = parsePDFTextToFAQs(rawText);

      } else {
        return res.status(400).json({ error: "Unsupported file type." });
      }

    } else if (req.body) {
      // Raw JSON body (no file)
      const body = req.body;
      newFAQs = Array.isArray(body)
        ? body
        : Array.isArray(body?.faqs)
        ? body.faqs
        : null;
      if (!newFAQs) {
        return res.status(400).json({ error: "Provide a JSON array or { faqs: [] } body." });
      }
    } else {
      return res.status(400).json({ error: "No file or body provided." });
    }

    if (!Array.isArray(newFAQs) || newFAQs.length === 0) {
      return res.status(400).json({ error: "No valid FAQ entries found in the uploaded file." });
    }

    // ---- 2. Validate & normalise each entry ----
    for (let i = 0; i < newFAQs.length; i++) {
      const faq = newFAQs[i];
      if (!faq.question || !faq.answer) {
        return res.status(400).json({
          error: `FAQ at index ${i} is missing required fields: question, answer.`,
        });
      }
      if (!Array.isArray(faq.keywords)) {
        faq.keywords = faq.keywords
          ? String(faq.keywords).split(/[,;|]/).map((k) => k.trim()).filter(Boolean)
          : [];
      }
    }

    // ---- 3. APPEND vs REPLACE ----
    if (replaceMode) {
      // Wipe all existing rows first
      const { error: deleteError } = await supabase
        .from("faqs")
        .delete()
        .neq("id", 0);
      if (deleteError) {
        return res.status(500).json({ error: "Failed to clear existing FAQs: " + deleteError.message });
      }

      // Assign fresh sequential IDs starting from 1
      const rows = newFAQs.map((faq, idx) => ({
        id: faq.id || idx + 1,
        question: faq.question,
        answer: faq.answer,
        keywords: faq.keywords,
      }));

      const { error: insertError } = await supabase.from("faqs").insert(rows);
      if (insertError) {
        return res.status(500).json({ error: "Failed to insert FAQs: " + insertError.message });
      }

      invalidateFAQCache();
      console.log(`[Admin] FAQ database REPLACED with ${rows.length} entries`);
      return res.json({
        success: true,
        mode: "replace",
        message: `FAQ database replaced with ${rows.length} entries.`,
        total: rows.length,
      });

    } else {
      // ---- APPEND mode (default) ----
      // Fetch the current highest ID so we don't collide
      const { data: existing, error: fetchError } = await supabase
        .from("faqs")
        .select("id")
        .order("id", { ascending: false })
        .limit(1);

      if (fetchError) {
        return res.status(500).json({ error: "Failed to read existing FAQs: " + fetchError.message });
      }

      let nextId = existing && existing.length > 0 ? existing[0].id + 1 : 1;

      // Build rows — give new IDs only where missing or colliding
      const rows = newFAQs.map((faq) => ({
        id: nextId++,            // always assign a safe new ID to avoid PK conflicts
        question: faq.question,
        answer: faq.answer,
        keywords: faq.keywords,
      }));

      const { error: insertError } = await supabase.from("faqs").insert(rows);
      if (insertError) {
        return res.status(500).json({ error: "Failed to insert FAQs: " + insertError.message });
      }

      invalidateFAQCache();
      console.log(`[Admin] APPENDED ${rows.length} FAQs to Supabase`);

      // Return updated total
      const { count } = await supabase
        .from("faqs")
        .select("id", { count: "exact", head: true });

      return res.json({
        success: true,
        mode: "append",
        message: `Successfully appended ${rows.length} FAQs. Total in database: ${count ?? "?"}`,
        added: rows.length,
        total: count ?? rows.length,
      });
    }

  } catch (err) {
    console.error("[Admin] FAQ upload error:", err.message);
    res.status(500).json({ error: "Failed to parse or save FAQ data: " + err.message });
  }
});

// ============================================================
// PUT /api/admin/faqs/:id
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
        : String(keywords).split(",").map((k) => k.trim()).filter(Boolean);
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