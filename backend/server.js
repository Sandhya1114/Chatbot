require("dotenv").config();

const fs = require("fs");
const express = require("express");
const cors = require("cors");
const path = require("path");

const chatRoutes = require("./routes/chat");
const escalationRoutes = require("./routes/escalation");
const adminRoutes = require("./routes/admin");
const extractorRoutes = require("./routes/extractor");
const crawlerRoutes = require("./routes/crawler");
const scrapedDataRoutes = require("./routes/scrapedData");

const app = express();
const PORT = process.env.PORT || 5000;
const publicDir = path.join(__dirname, "public");
const frontendBuildDir = path.resolve(__dirname, "..", "frontend", "build");
const frontendIndexPath = path.join(frontendBuildDir, "index.html");
const publicIndexPath = path.join(publicDir, "index.html");
const publicAdminPath = path.join(publicDir, "admin.html");
const hasFrontendBuild = fs.existsSync(frontendIndexPath);

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

if (process.env.NODE_ENV !== "production") {
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });
}

app.get("/admin.html", (req, res) => {
  res.redirect(302, "/admin");
});

app.use(express.static(publicDir, { index: false }));

if (hasFrontendBuild) {
  app.use(express.static(frontendBuildDir, { index: false }));
}

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.use("/api/admin/crawl", crawlerRoutes);
app.use("/api/extract", extractorRoutes);
app.use("/", scrapedDataRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/escalate", escalationRoutes);
app.use("/api/admin", adminRoutes);

const serveFrontendShell = (req, res) => {
  if (hasFrontendBuild) {
    return res.sendFile(frontendIndexPath);
  }

  if (req.path === "/admin") {
    return res.sendFile(publicAdminPath);
  }

  return res.sendFile(publicIndexPath);
};

app.get(["/", "/admin"], serveFrontendShell);

app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found.` });
});

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({
    error: "Internal server error.",
    details: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

app.listen(PORT, () => {
  console.log("================================================");
  console.log(`  Chatbot backend running on port ${PORT}`);
  console.log(`  Public site:  http://localhost:${PORT}/`);
  console.log(`  Admin page:   http://localhost:${PORT}/admin`);
  console.log(`  Health:       http://localhost:${PORT}/health`);
  console.log("================================================");
});

module.exports = app;
