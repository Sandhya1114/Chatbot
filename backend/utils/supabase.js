// ============================================================
// utils/supabase.js - Supabase Client (Singleton)
// This file creates ONE shared Supabase connection used by
// all routes. Import { supabase } wherever you need the DB.
// ============================================================

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Validate that credentials exist before creating client
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env file.");
  console.error("   Copy backend/.env.example to backend/.env and fill in your Supabase credentials.");
  process.exit(1); // Stop server immediately — can't run without a database
}

// Create the Supabase client
// auth.persistSession: false → server-side apps don't need session persistence
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

console.log("✅ Supabase client initialized");

module.exports = { supabase };