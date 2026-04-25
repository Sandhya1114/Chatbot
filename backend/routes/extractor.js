const express = require("express");
const { scrapePublicPage } = require("../utils/pageExtractor");

const router = express.Router();

router.post("/", async (req, res) => {
  const { url } = req.body || {};

  const result = await scrapePublicPage(url);
  const statusCode = result.success ? 200 : 422;

  return res.status(statusCode).json(result);
});

module.exports = router;
