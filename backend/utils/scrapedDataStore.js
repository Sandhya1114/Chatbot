const { supabase } = require("./supabase");

const TABLE_NAME = "scraped_data";
const TRACKING_QUERY_PARAMS = [
  "fbclid",
  "gclid",
  "ref",
  "source",
];

function stripHtmlTags(value) {
  return String(value || "").replace(/<[^>]*>/g, " ");
}

function sanitizeText(value, { maxLength = 500, preserveLines = false } = {}) {
  const cleaned = stripHtmlTags(value)
    .replace(/\u00a0/g, " ")
    .replace(preserveLines ? /\r\n/g : /\s+/g, preserveLines ? "\n" : " ")
    .trim();

  if (!preserveLines) {
    return cleaned.slice(0, maxLength);
  }

  return cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, maxLength);
}

function normalizeUrl(rawUrl) {
  const candidate = String(rawUrl || "").trim();
  if (!candidate) return "";

  const withProtocol = /^[a-z]+:\/\//i.test(candidate)
    ? candidate
    : `https://${candidate}`;

  const parsed = new URL(withProtocol);
  parsed.hash = "";

  const removableParams = [];
  parsed.searchParams.forEach((_, key) => {
    if (key.startsWith("utm_") || TRACKING_QUERY_PARAMS.includes(key)) {
      removableParams.push(key);
    }
  });

  removableParams.forEach((key) => parsed.searchParams.delete(key));

  if (parsed.pathname !== "/") {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }

  return parsed.toString();
}

function sanitizeImageUrl(value) {
  if (!value) return "";

  try {
    return normalizeUrl(value);
  } catch {
    return "";
  }
}

function mapRow(row) {
  return {
    id: row.id,
    title: row.title,
    price: row.price,
    image: row.image,
    description: row.description,
    source_url: row.source_url,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function buildPayload(input = {}) {
  let normalizedSourceUrl = "";

  try {
    normalizedSourceUrl = normalizeUrl(input.source_url);
  } catch {
    normalizedSourceUrl = "";
  }

  return {
    title: sanitizeText(input.title, { maxLength: 300 }),
    price: sanitizeText(input.price, { maxLength: 120 }),
    image: sanitizeImageUrl(input.image),
    description: sanitizeText(input.description, {
      maxLength: 5000,
      preserveLines: true,
    }),
    source_url: normalizedSourceUrl,
  };
}

function validateScrapedData(input = {}) {
  const payload = buildPayload(input);
  const errors = [];

  if (!payload.title) {
    errors.push("title is required.");
  }

  if (!payload.source_url) {
    errors.push("source_url must be a valid URL.");
  }

  return {
    isValid: errors.length === 0,
    errors,
    payload,
  };
}

async function saveScrapedData(input) {
  const { isValid, errors, payload } = validateScrapedData(input);

  if (!isValid) {
    const error = new Error(errors.join(" "));
    error.statusCode = 400;
    throw error;
  }

  const { data: existingRecord, error: lookupError } = await supabase
    .from(TABLE_NAME)
    .select("id")
    .eq("source_url", payload.source_url)
    .maybeSingle();

  if (lookupError) {
    throw new Error(`Failed to check duplicate source_url: ${lookupError.message}`);
  }

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .upsert(payload, { onConflict: "source_url" })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to save scraped data: ${error.message}`);
  }

  return {
    action: existingRecord ? "updated" : "created",
    record: mapRow(data),
  };
}

async function getAllScrapedData() {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch scraped data: ${error.message}`);
  }

  return (data || []).map(mapRow);
}

async function getScrapedDataById(id) {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch scraped data record: ${error.message}`);
  }

  return data ? mapRow(data) : null;
}

module.exports = {
  getAllScrapedData,
  getScrapedDataById,
  saveScrapedData,
  validateScrapedData,
};
