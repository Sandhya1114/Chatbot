const axios = require("axios");
const cheerio = require("cheerio");

const USER_AGENT = "Mozilla/5.0 (compatible; ChatbotExtractor/3.0; +https://localhost)";
const REQUEST_TIMEOUT_MS = 15000;

const NOISE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "svg",
  "canvas",
  "iframe",
  "footer",
  "nav",
  "form",
  "button",
  "aside",
  ".cookie",
  ".cookies",
  ".cookie-banner",
  ".popup",
  ".modal",
  ".newsletter",
];

const DESCRIPTION_SELECTORS = [
  "[itemprop='description']",
  "[data-testid*='description']",
  ".product-description",
  ".product__description",
  ".book-description",
  ".description",
  "#description",
  "article p",
  "main p",
  "[role='main'] p",
  "p",
];

const PRICE_SELECTORS = [
  "[itemprop='price']",
  "meta[itemprop='price']",
  "[data-price]",
  "[class*='price']",
  "[id*='price']",
  ".a-price .a-offscreen",
  ".price",
  ".sale-price",
  ".product-price",
];

const BLOCKED_PAGE_PATTERNS = [
  /captcha/i,
  /access denied/i,
  /temporarily unavailable/i,
  /verify you are human/i,
  /sign in to continue/i,
  /login required/i,
];

const IMAGE_POSITIVE_HINTS = /(product|book|cover|hero|main|primary|featured|gallery)/i;
const IMAGE_NEGATIVE_HINTS = /(logo|icon|sprite|avatar|badge|placeholder|loading)/i;

const FALLBACK_TEXT = {
  title: "Title not found on page",
  price: "Price not available on page",
  image: "Image not found on page",
  description: "Description not found on page",
};

function cleanText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateText(value, maxLength = 320) {
  const normalized = cleanText(value);
  if (!normalized || normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3).trim()}...`;
}

function normalizeInputUrl(rawUrl) {
  const candidate = String(rawUrl || "").trim();
  if (!candidate) {
    throw new Error("A public URL is required.");
  }

  const withProtocol = /^[a-z]+:\/\//i.test(candidate)
    ? candidate
    : `https://${candidate}`;

  const parsed = new URL(withProtocol);
  parsed.hash = "";
  return parsed.toString();
}

function makeAbsoluteUrl(rawUrl, baseUrl) {
  const candidate = cleanText(rawUrl);
  if (!candidate || /^data:/i.test(candidate)) return "";

  try {
    return new URL(candidate, baseUrl).toString();
  } catch {
    return "";
  }
}

function normalizeResultValue(value, fallback) {
  const normalized = cleanText(value);
  return normalized || fallback;
}

function buildFailureResult(pageUrl, reason) {
  const normalizedUrl = cleanText(pageUrl) || "URL not provided";

  return {
    success: false,
    reason: cleanText(reason) || "Extraction failed for an unknown reason.",
    data: {
      title: "Unsupported or inaccessible page",
      price: FALLBACK_TEXT.price,
      image: FALLBACK_TEXT.image,
      description: cleanText(reason) || "Unable to extract content from this page.",
      url: normalizedUrl,
    },
  };
}

function parseJsonSafe(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function flattenSchemaNodes(node, output = []) {
  if (!node) return output;

  if (Array.isArray(node)) {
    node.forEach((item) => flattenSchemaNodes(item, output));
    return output;
  }

  if (typeof node !== "object") return output;

  output.push(node);

  if (Array.isArray(node["@graph"])) {
    node["@graph"].forEach((item) => flattenSchemaNodes(item, output));
  }

  return output;
}

function getFirstString(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = getFirstString(item);
      if (candidate) return candidate;
    }
    return "";
  }

  if (value && typeof value === "object") {
    return cleanText(
      value.url ||
      value.contentUrl ||
      value.value ||
      value.name ||
      value.text
    );
  }

  return cleanText(value);
}

function normalizeImageValue(value, pageUrl) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = normalizeImageValue(item, pageUrl);
      if (candidate) return candidate;
    }
    return "";
  }

  if (value && typeof value === "object") {
    return normalizeImageValue(
      value.url || value.contentUrl || value.image || value.thumbnailUrl,
      pageUrl
    );
  }

  return makeAbsoluteUrl(value, pageUrl);
}

function getMetaContent($, selectors) {
  for (const selector of selectors) {
    const value = cleanText($(selector).attr("content"));
    if (value) return value;
  }
  return "";
}

function getMetaOrText($, selectors) {
  for (const selector of selectors) {
    const element = $(selector).first();
    if (!element.length) continue;

    const contentValue = cleanText(element.attr("content"));
    if (contentValue) return contentValue;

    const textValue = cleanText(element.text());
    if (textValue) return textValue;
  }

  return "";
}

function getScope($) {
  const candidates = [
    $("main").first(),
    $("article").first(),
    $("[role='main']").first(),
    $("#main").first(),
    $(".main").first(),
    $("body").first(),
  ];

  return candidates.find((candidate) => candidate.length) || $("body");
}

function looksBlockedPage(text) {
  const sample = cleanText(text).slice(0, 2000);
  return BLOCKED_PAGE_PATTERNS.some((pattern) => pattern.test(sample));
}

function parseWidthHeight(rawValue) {
  const match = String(rawValue || "").match(/(\d{2,4})/);
  return match ? Number(match[1]) : 0;
}

function getImageSource($img) {
  const srcset = cleanText(
    $img.attr("srcset") ||
    $img.attr("data-srcset") ||
    $img.attr("data-lazy-srcset")
  );

  if (srcset) {
    const sources = srcset
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const [url, descriptor] = item.split(/\s+/);
        return {
          url,
          score: descriptor && /\d+w/i.test(descriptor)
            ? Number(descriptor.replace(/[^\d]/g, ""))
            : 0,
        };
      })
      .sort((a, b) => b.score - a.score);

    if (sources[0]?.url) {
      return sources[0].url;
    }
  }

  return cleanText(
    $img.attr("src") ||
    $img.attr("data-src") ||
    $img.attr("data-lazy-src") ||
    $img.attr("data-original")
  );
}

function scoreImageCandidate($, element, scope, index) {
  const $img = $(element);
  const rawSource = getImageSource($img);
  if (!rawSource) return null;

  const alt = cleanText($img.attr("alt"));
  const title = cleanText($img.attr("title"));
  const className = cleanText($img.attr("class"));
  const id = cleanText($img.attr("id"));
  const contextText = `${alt} ${title} ${className} ${id}`;

  if (IMAGE_NEGATIVE_HINTS.test(rawSource) || IMAGE_NEGATIVE_HINTS.test(contextText)) {
    return null;
  }

  const width = parseWidthHeight($img.attr("width")) || parseWidthHeight($img.attr("style"));
  const height = parseWidthHeight($img.attr("height")) || parseWidthHeight($img.attr("style"));
  const insideScope = scope.find(element).length > 0 || scope.is(element);

  let score = 0;
  score += Math.min(width, 1200) / 20;
  score += Math.min(height, 1200) / 20;
  score += Math.max(0, 25 - index);

  if (insideScope) score += 25;
  if (IMAGE_POSITIVE_HINTS.test(rawSource) || IMAGE_POSITIVE_HINTS.test(contextText)) score += 35;
  if (alt && alt.length > 4) score += 10;
  if (width && width < 80) score -= 30;
  if (height && height < 80) score -= 30;
  if (/\.svg($|\?)/i.test(rawSource)) score -= 25;
  if (/\.gif($|\?)/i.test(rawSource)) score -= 10;

  return {
    rawSource,
    score,
  };
}

function extractLargestImage($, pageUrl, scope) {
  const candidates = [];

  $("img").each((index, element) => {
    const scored = scoreImageCandidate($, element, scope, index);
    if (!scored) return;

    const absoluteUrl = makeAbsoluteUrl(scored.rawSource, pageUrl);
    if (!absoluteUrl) return;

    candidates.push({
      url: absoluteUrl,
      score: scored.score,
    });
  });

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.url || "";
}

function extractMeaningfulParagraph($, scope) {
  const selector = DESCRIPTION_SELECTORS.join(", ");
  const candidates = [];

  scope.find(selector).each((index, element) => {
    const text = cleanText($(element).text());
    if (!text || text.length < 50) return;
    if (/cookie|subscribe|sign up|javascript|enable cookies/i.test(text)) return;

    let score = 0;
    score += Math.min(text.length, 500);
    if (index < 3) score += 120;
    if (/description|summary|overview|about/i.test(cleanText($(element).attr("class")))) score += 80;

    candidates.push({ text, score });
  });

  candidates.sort((a, b) => b.score - a.score);
  return truncateText(candidates[0]?.text || "", 320);
}

function extractTitleFromHtml($, scope) {
  const h1 = cleanText(scope.find("h1").first().text()) || cleanText($("h1").first().text());
  if (h1) return h1;

  const h2 = cleanText(scope.find("h2").first().text()) || cleanText($("h2").first().text());
  if (h2) return h2;

  return cleanText($("title").first().text());
}

function currencyCodeToSymbol(code) {
  const normalized = String(code || "").toUpperCase();
  const map = {
    INR: "₹",
    USD: "$",
    EUR: "€",
    GBP: "£",
  };
  return map[normalized] || normalized;
}

function formatPrice(price, currency) {
  const cleanPrice = cleanText(price);
  const cleanCurrency = cleanText(currency);
  if (!cleanPrice) return "";
  if (!cleanCurrency) return cleanPrice;

  const symbol = currencyCodeToSymbol(cleanCurrency);
  if (/[₹$€£]/.test(symbol)) {
    return `${symbol}${cleanPrice}`;
  }

  return `${symbol} ${cleanPrice}`.trim();
}

function normalizePriceMatch(value) {
  const match = String(value || "").match(
    /((?:₹|Rs\.?|INR|USD|\$|EUR|€|GBP|£)\s*[0-9][0-9,]*(?:\.\d{1,2})?)/i
  );

  return cleanText(match ? match[1] : value);
}

function extractPriceFromHtml($, scope) {
  const metaPrice = getMetaContent($, [
    "meta[property='product:price:amount']",
    "meta[property='product:sale_price:amount']",
    "meta[property='og:price:amount']",
    "meta[itemprop='price']",
  ]);
  const metaCurrency = getMetaContent($, [
    "meta[property='product:price:currency']",
    "meta[property='product:sale_price:currency']",
    "meta[property='og:price:currency']",
    "meta[itemprop='priceCurrency']",
  ]);

  if (metaPrice) {
    return formatPrice(metaPrice, metaCurrency);
  }

  const candidates = [];
  const selector = PRICE_SELECTORS.join(", ");

  scope.find(selector).each((index, element) => {
    const text = cleanText(
      $(element).attr("content") ||
      $(element).attr("data-price") ||
      $(element).text()
    );
    if (!text || text.length > 120) return;

    const normalized = normalizePriceMatch(text);
    if (!normalized) return;

    let score = 0;
    score += 120 - index;
    if (/price|mrp|sale|buy|offer|deal/i.test(text)) score += 80;
    if (/[₹$€£]|INR|USD|EUR|GBP/i.test(text)) score += 100;
    if (/rating|review/i.test(text)) score -= 80;

    candidates.push({ value: normalized, score });
  });

  if (candidates.length) {
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].value;
  }

  const bodyText = cleanText(scope.text()).slice(0, 15000);
  const keywordMatch = bodyText.match(
    /(?:price|mrp|sale price|our price|list price|buy for|starting at)[^₹$€£0-9]{0,20}((?:₹|Rs\.?|INR|USD|\$|EUR|€|GBP|£)\s*[0-9][0-9,]*(?:\.\d{1,2})?)/i
  );

  if (keywordMatch?.[1]) {
    return cleanText(keywordMatch[1]);
  }

  const currencyMatch = bodyText.match(
    /((?:₹|Rs\.?|INR|USD|\$|EUR|€|GBP|£)\s*[0-9][0-9,]*(?:\.\d{1,2})?)/i
  );

  return currencyMatch?.[1] ? cleanText(currencyMatch[1]) : "";
}

function extractSchemaCandidates($, pageUrl) {
  const candidates = [];

  $("script[type='application/ld+json']").each((_, element) => {
    const parsed = parseJsonSafe($(element).contents().text());
    if (!parsed) return;

    const nodes = flattenSchemaNodes(parsed);

    for (const node of nodes) {
      const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
      const normalizedTypes = types.map((item) => String(item || "").toLowerCase());

      const title = cleanText(node.name || node.headline || node.title);
      const description = cleanText(node.description);
      const image = normalizeImageValue(node.image || node.thumbnailUrl, pageUrl);
      const offer = Array.isArray(node.offers) ? node.offers[0] : node.offers;
      const price = cleanText(
        node.price ||
        offer?.price ||
        offer?.lowPrice ||
        offer?.highPrice
      );
      const currency = cleanText(node.priceCurrency || offer?.priceCurrency);

      const hasUsefulField = title || description || image || price;
      if (!hasUsefulField) continue;

      let typeScore = 0;
      if (normalizedTypes.some((type) => type.includes("product"))) typeScore += 60;
      if (normalizedTypes.some((type) => type.includes("book"))) typeScore += 50;
      if (normalizedTypes.some((type) => type.includes("article"))) typeScore += 30;
      if (normalizedTypes.some((type) => type.includes("webpage"))) typeScore += 20;

      candidates.push({
        title,
        description,
        image,
        price: formatPrice(price, currency),
        score: typeScore + (title ? 25 : 0) + (description ? 20 : 0) + (image ? 20 : 0) + (price ? 20 : 0),
      });
    }
  });

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

async function fetchPublicPage(url) {
  const response = await axios.get(url, {
    timeout: REQUEST_TIMEOUT_MS,
    responseType: "arraybuffer",
    maxRedirects: 5,
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    },
    validateStatus: (status) => status >= 200 && status < 500,
  });

  const finalUrl = response.request?.res?.responseUrl || url;
  const status = response.status;
  const contentType = String(response.headers["content-type"] || "").toLowerCase();
  const body = Buffer.from(response.data).toString("utf8");

  return {
    status,
    url: finalUrl,
    contentType,
    html: body,
  };
}

function extractPageData(html, pageUrl) {
  const $ = cheerio.load(html);
  $(NOISE_SELECTORS.join(", ")).remove();

  const scope = getScope($);
  const pageText = cleanText($("body").text());

  if (looksBlockedPage(`${$("title").first().text()} ${pageText}`)) {
    return buildFailureResult(
      pageUrl,
      "The page appears to be protected by login, CAPTCHA, or bot blocking."
    );
  }

  const schemaCandidates = extractSchemaCandidates($, pageUrl);
  const bestSchema = schemaCandidates[0] || {};

  const ogTitle = getMetaContent($, ["meta[property='og:title']"]);
  const metaDescription = getMetaContent($, [
    "meta[name='description']",
    "meta[property='og:description']",
    "meta[name='twitter:description']",
  ]);
  const ogImage = normalizeImageValue(
    getMetaContent($, [
      "meta[property='og:image']",
      "meta[property='og:image:url']",
    ]),
    pageUrl
  );

  const htmlTitle = extractTitleFromHtml($, scope);
  const paragraphDescription = extractMeaningfulParagraph($, scope);
  const domImage = extractLargestImage($, pageUrl, scope);
  const htmlPrice = extractPriceFromHtml($, scope);

  const extracted = {
    title: normalizeResultValue(
      ogTitle || bestSchema.title || htmlTitle,
      FALLBACK_TEXT.title
    ),
    price: normalizeResultValue(
      bestSchema.price || htmlPrice,
      FALLBACK_TEXT.price
    ),
    image: normalizeResultValue(
      ogImage || bestSchema.image || domImage,
      FALLBACK_TEXT.image
    ),
    description: normalizeResultValue(
      metaDescription || bestSchema.description || paragraphDescription,
      FALLBACK_TEXT.description
    ),
    url: normalizeResultValue(pageUrl, "URL not provided"),
  };

  const meaningfulFields = ["title", "price", "image", "description"].filter(
    (key) => extracted[key] !== FALLBACK_TEXT[key]
  );

  return {
    success: meaningfulFields.length >= 2,
    data: {
      title: extracted.title,
      price: extracted.price,
      image: extracted.image,
      description: truncateText(extracted.description, 320) || FALLBACK_TEXT.description,
      url: extracted.url,
    },
  };
}

async function scrapePublicPage(rawUrl) {
  let normalizedUrl;
  try {
    normalizedUrl = normalizeInputUrl(rawUrl);
  } catch (error) {
    return buildFailureResult(rawUrl, error.message);
  }

  let resource;
  try {
    resource = await fetchPublicPage(normalizedUrl);
  } catch (error) {
    return buildFailureResult(
      normalizedUrl,
      `Unable to fetch the public page: ${error.message}`
    );
  }

  if ([401, 403, 429].includes(resource.status)) {
    return buildFailureResult(
      resource.url || normalizedUrl,
      `The site returned HTTP ${resource.status} and may require authentication or block automated access.`
    );
  }

  if (resource.status >= 400) {
    return buildFailureResult(
      resource.url || normalizedUrl,
      `The site returned HTTP ${resource.status}.`
    );
  }

  if (!resource.contentType.includes("text/html") && !resource.contentType.includes("application/xhtml+xml")) {
    return buildFailureResult(
      resource.url || normalizedUrl,
      `Unsupported content type: ${resource.contentType || "unknown"}. Only public HTML pages are supported.`
    );
  }

  return extractPageData(resource.html, resource.url || normalizedUrl);
}

module.exports = {
  scrapePublicPage,
  extractPageData,
  normalizeInputUrl,
  buildFailureResult,
};
