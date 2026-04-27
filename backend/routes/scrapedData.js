const express = require("express");
const {
  getAllScrapedData,
  getScrapedDataById,
  saveScrapedData,
  validateScrapedData,
} = require("../utils/scrapedDataStore");

const router = express.Router();

// POST /save
// Flow: receive data -> validate -> dedupe by source_url -> insert/update
router.post("/save", async (req, res) => {
  const validation = validateScrapedData(req.body);

  if (!validation.isValid) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: validation.errors,
    });
  }

  try {
    const result = await saveScrapedData(req.body);

    return res.status(result.action === "created" ? 201 : 200).json({
      success: true,
      message: result.action === "created"
        ? "Data saved successfully"
        : "Data updated successfully",
      data: result.record,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || "Failed to save scraped data",
    });
  }
});

// GET /data
router.get("/data", async (req, res) => {
  try {
    const records = await getAllScrapedData();

    return res.json({
      success: true,
      total: records.length,
      data: records,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to fetch scraped data",
    });
  }
});

// GET /data/:id
router.get("/data/:id", async (req, res) => {
  try {
    const record = await getScrapedDataById(req.params.id);

    if (!record) {
      return res.status(404).json({
        success: false,
        message: "Record not found",
      });
    }

    return res.json({
      success: true,
      data: record,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to fetch scraped data record",
    });
  }
});

module.exports = router;
