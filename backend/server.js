// ============================================================
// server.js - Main Express Server Entry Point
// Run with: node server.js  OR  npm run dev (with nodemon)
// ============================================================

require("dotenv").config(); // Load environment variables from .env file

const express = require("express");
const cors = require("cors");
const path = require("path");

// Import route handlers
const chatRoutes = require("./routes/chat");
const escalationRoutes = require("./routes/escalation");
const adminRoutes = require("./routes/admin");

const app = express();
const PORT = process.env.PORT || 5000;

// ============================================================
// MIDDLEWARE
// ============================================================

// Enable CORS — allows frontend (React on port 3000) to call this API
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

// Parse JSON request bodies
app.use(express.json({ limit: "10mb" }));

// Parse URL-encoded form bodies (for file uploads)
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Request logger — logs every incoming request in development
if (process.env.NODE_ENV !== "production") {
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });
}

// ============================================================
// ROUTES
// ============================================================

// Health check — useful for deployment platforms (Render, Railway etc.)
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString(), uptime: process.uptime() });
});

// Main API routes
app.use("/api/chat", chatRoutes);          // Chat + FAQ endpoints
app.use("/api/escalate", escalationRoutes); // Human escalation
app.use("/api/admin", adminRoutes);         // Admin dashboard

// 404 handler — for any unmatched routes
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found.` });
});

// Global error handler — catches any uncaught errors
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({
    error: "Internal server error.",
    details: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, () => {
  console.log("================================================");
  console.log(`  🤖 Chatbot Backend running on port ${PORT}`);
  console.log(`  📖 Health: http://localhost:${PORT}/health`);
  console.log(`  💬 Chat:   http://localhost:${PORT}/api/chat`);
  console.log(`  📊 Admin:  http://localhost:${PORT}/api/admin/analytics`);
  console.log("================================================");
});

module.exports = app;
