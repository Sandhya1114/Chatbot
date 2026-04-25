const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const { supabase } = require("../utils/supabase");
const { invalidateFAQCache } = require("../utils/faqMatcher");

const router = express.Router();

const USER_AGENT = "Mozilla/5.0 (compatible; ChatbotCrawler/2.0; +https://localhost)";
const REQUEST_TIMEOUT_MS = 15000;
const MAX_PAGES = 20;
const MAX_LINKS_PER_PAGE = 30;
const MAX_FAQS_PER_PAGE = 20;
const MAX_TOTAL_FAQS = 250;
const MAX_ANSWER_CHARS = 1800;
const MAX_PAGE_TEXT_CHARS = 5000;
const MAX_KEYWORDS = 12;

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "to", "of", "in", "on", "at", "by",
  "for", "with", "about", "from", "into", "that", "this", "these", "those",
  "i", "me", "my", "mine", "you", "your", "yours", "we", "our", "ours",
  "they", "their", "theirs", "it", "its", "and", "or", "but", "if", "so",
  "what", "how", "when", "where", "why", "who", "which", "as", "than",
  "then", "there", "here", "also", "just", "not", "yes", "no",
]);

const NOISE_SELECTORS = [
  "script",
  "style",
  "svg",
  "canvas",
  "iframe",
  "nav",
  "footer",
  "header",
  "form",
  "button",
  "aside",
  "[role='navigation']",
  "[role='banner']",
  "[role='contentinfo']",
  ".cookie",
  ".cookies",
  ".cookie-banner",
  ".cookie-bar",
  ".newsletter",
  ".popup",
  ".modal",
  ".breadcrumb",
];

const SKIPPED_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".ico",
  ".zip", ".rar", ".7z", ".tar", ".gz",
  ".mp3", ".mp4", ".avi", ".mov", ".wmv",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
]);

function cleanText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeInputUrl(rawUrl) {
  const candidate = String(rawUrl || "").trim();
  if (!candidate) {
    throw new Error("A URL is required.");
  }

  const withProtocol = /^[a-z]+:\/\//i.test(candidate)
    ? candidate
    : `https://${candidate}`;

  const parsed = new URL(withProtocol);
  parsed.hash = "";
  return parsed.toString();
}

function normalizeUrlForQueue(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = "";
    const trackingParams = [];
    parsed.searchParams.forEach((_, key) => {
      if (
        key.startsWith("utm_") ||
        key === "fbclid" ||
        key === "gclid" ||
        key === "ref" ||
        key === "source"
      ) {
        trackingParams.push(key);
      }
    });
    for (const key of trackingParams) {
      parsed.searchParams.delete(key);
    }
    const normalizedPath = parsed.pathname.replace(/\/{2,}/g, "/");
    parsed.pathname = normalizedPath !== "/" ? normalizedPath.replace(/\/$/, "") : "/";
    return parsed.toString();
  } catch {
    return null;
  }
}

function getPathLabel(pageUrl) {
  try {
    const parsed = new URL(pageUrl);
    if (parsed.pathname === "/" || !parsed.pathname) return "home page";
    return parsed.pathname.replace(/^\/+/, "").replace(/[-_/]+/g, " ");
  } catch {
    return "page";
  }
}

function extractKeywords(...sources) {
  const scores = new Map();
  const text = sources
    .filter(Boolean)
    .map((value) => String(value))
    .join(" ")
    .toLowerCase()
    .replace(/[^\w\s/-]/g, " ");

  for (const word of text.split(/\s+/)) {
    const token = word.trim().replace(/^[-/]+|[-/]+$/g, "");
    if (!token || token.length < 3 || STOP_WORDS.has(token)) continue;
    scores.set(token, (scores.get(token) || 0) + 1);
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_KEYWORDS)
    .map(([token]) => token);
}

function dedupeOrdered(items) {
  const seen = new Set();
  const output = [];

  for (const item of items) {
    const normalized = cleanText(item).toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(cleanText(item));
  }

  return output;
}

function chunkText(text, maxChars) {
  const normalized = cleanText(text);
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const chunks = [];
  const sentences = normalized.split(/(?<=[.!?])\s+/);
  let current = "";

  for (const sentence of sentences) {
    if (!sentence) continue;
    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = "";
    }

    if (sentence.length <= maxChars) {
      current = sentence;
      continue;
    }

    for (let start = 0; start < sentence.length; start += maxChars) {
      chunks.push(sentence.slice(start, start + maxChars).trim());
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function trimAnswerWithSource(pageUrl, text) {
  const availableChars = Math.max(400, MAX_ANSWER_CHARS - pageUrl.length - 18);
  const chunks = chunkText(text, availableChars);
  return chunks.map((chunk) => `Source URL: ${pageUrl}\n${chunk}`.trim());
}

function parseRobotsTxt(rawText) {
  const groups = [];
  let current = null;

  for (const rawLine of String(rawText || "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    if (!value) continue;

    if (key === "user-agent") {
      current = { agents: [value.toLowerCase()], rules: [] };
      groups.push(current);
      continue;
    }

    if (!current) continue;
    if (key === "allow" || key === "disallow") {
      current.rules.push({ type: key, path: value });
    }
  }

  return groups;
}

async function fetchRobotsRules(origin) {
  try {
    const response = await axios.get(`${origin}/robots.txt`, {
      timeout: REQUEST_TIMEOUT_MS,
      responseType: "text",
      headers: { "User-Agent": USER_AGENT },
      validateStatus: (status) => status >= 200 && status < 400,
    });
    return parseRobotsTxt(response.data);
  } catch {
    return [];
  }
}

function isAllowedByRobots(pageUrl, groups) {
  if (!groups.length) return true;

  let pathname;
  try {
    pathname = new URL(pageUrl).pathname || "/";
  } catch {
    return true;
  }

  const relevant = groups.filter((group) =>
    group.agents.includes("*") ||
    group.agents.includes("chatbotcrawler") ||
    group.agents.includes("mozilla/5.0")
  );

  if (!relevant.length) return true;

  let winner = null;
  for (const group of relevant) {
    for (const rule of group.rules) {
      if (rule.path === "/") {
        const candidate = { matched: true, length: 1, allow: rule.type === "allow" };
        if (!winner || candidate.length >= winner.length) {
          winner = candidate;
        }
        continue;
      }

      if (!pathname.startsWith(rule.path)) continue;
      const candidate = {
        matched: true,
        length: rule.path.length,
        allow: rule.type === "allow",
      };
      if (
        !winner ||
        candidate.length > winner.length ||
        (candidate.length === winner.length && candidate.allow)
      ) {
        winner = candidate;
      }
    }
  }

  return !winner || winner.allow;
}

async function fetchResource(url) {
  const response = await axios.get(url, {
    timeout: REQUEST_TIMEOUT_MS,
    responseType: "arraybuffer",
    maxRedirects: 5,
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8",
    },
    validateStatus: (status) => status >= 200 && status < 400,
  });

  const finalUrl = response.request?.res?.responseUrl || url;
  const contentType = String(response.headers["content-type"] || "").toLowerCase();
  const buffer = Buffer.from(response.data);
  const text = contentType.includes("pdf") ? "" : buffer.toString("utf8");

  return {
    url: normalizeUrlForQueue(finalUrl) || finalUrl,
    contentType,
    buffer,
    text,
  };
}

function isPdfResource(resource, requestedUrl) {
  if (resource.contentType.includes("application/pdf")) return true;
  try {
    return new URL(resource.url || requestedUrl).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return String(requestedUrl || "").toLowerCase().endsWith(".pdf");
  }
}

function isHtmlResource(resource) {
  return (
    resource.contentType.includes("text/html") ||
    resource.contentType.includes("application/xhtml+xml") ||
    !resource.contentType
  );
}

function parseJsonSafe(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractSchemaEntries($, pageUrl) {
  const items = [];

  $("script[type='application/ld+json']").each((_, el) => {
    const parsed = parseJsonSafe($(el).contents().text());
    if (!parsed) return;

    const roots = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed["@graph"])
      ? parsed["@graph"]
      : [parsed];

    for (const item of roots) {
      if (!item || typeof item !== "object") continue;
      const type = Array.isArray(item["@type"]) ? item["@type"].join(",") : item["@type"];

      if (String(type || "").toLowerCase().includes("faqpage") && Array.isArray(item.mainEntity)) {
        for (const entity of item.mainEntity) {
          const question = cleanText(entity.name);
          const answer = cleanText(entity.acceptedAnswer?.text || entity.acceptedAnswer?.name);
          if (!question || !answer) continue;
          items.push({
            question,
            answer: `Source URL: ${pageUrl}\n${answer}`,
            keywords: extractKeywords(question, answer),
          });
        }
      }

      if (String(type || "").toLowerCase().includes("product")) {
        const productName = cleanText(item.name);
        const description = cleanText(item.description);
        const price = cleanText(
          item.offers?.price ||
          item.offers?.[0]?.price ||
          item.offers?.lowPrice ||
          item.offers?.highPrice
        );
        const currency = cleanText(
          item.offers?.priceCurrency ||
          item.offers?.[0]?.priceCurrency
        );
        const rating = cleanText(item.aggregateRating?.ratingValue);

        if (productName && description) {
          items.push({
            question: `What are the details of ${productName}?`,
            answer: `Source URL: ${pageUrl}\n${description}`,
            keywords: extractKeywords(productName, description, "product details"),
          });
        }

        if (productName && price) {
          items.push({
            question: `What is the price of ${productName}?`,
            answer: `Source URL: ${pageUrl}\n${currency ? `${currency} ` : ""}${price}`,
            keywords: extractKeywords(productName, price, currency, "price cost"),
          });
        }

        if (productName && rating) {
          items.push({
            question: `What rating does ${productName} have?`,
            answer: `Source URL: ${pageUrl}\n${productName} has a rating of ${rating}.`,
            keywords: extractKeywords(productName, rating, "rating reviews"),
          });
        }
      }
    }
  });

  return items;
}

function extractDefinitionListFAQs($, pageUrl) {
  const faqs = [];

  $("dl").each((_, dl) => {
    const terms = $(dl).find("dt");
    terms.each((__, dt) => {
      const question = cleanText($(dt).text());
      const answer = cleanText($(dt).next("dd").text());
      if (!question || !answer || answer.length < 10) return;
      faqs.push({
        question: question.endsWith("?") ? question : `${question}?`,
        answer: `Source URL: ${pageUrl}\n${answer}`,
        keywords: extractKeywords(question, answer),
      });
    });
  });

  return faqs;
}

function extractAccordionFAQs($, pageUrl) {
  const faqs = [];

  $("details").each((_, el) => {
    const question = cleanText($(el).find("summary").first().text());
    const answer = cleanText($(el).clone().find("summary").remove().end().text());
    if (!question || !answer || answer.length < 10) return;
    faqs.push({
      question,
      answer: `Source URL: ${pageUrl}\n${answer}`,
      keywords: extractKeywords(question, answer),
    });
  });

  return faqs;
}

function extractHeadingSections($, scope, pageTitle) {
  const sections = [];
  let current = null;

  $(scope)
    .find("h1, h2, h3, h4, h5, h6, p, li, td, th, blockquote")
    .each((_, el) => {
      const tagName = (el.tagName || "").toLowerCase();
      const text = cleanText($(el).text());
      if (!text || text.length < 3) return;

      if (/^h[1-6]$/.test(tagName)) {
        if (current && current.content.length) {
          sections.push({
            heading: current.heading,
            content: dedupeOrdered(current.content).join(" "),
          });
        }
        current = { heading: text, content: [] };
        return;
      }

      if (!current) {
        current = { heading: pageTitle || "Page content", content: [] };
      }

      current.content.push(text);
    });

  if (current && current.content.length) {
    sections.push({
      heading: current.heading,
      content: dedupeOrdered(current.content).join(" "),
    });
  }

  return sections
    .map((section) => ({
      heading: cleanText(section.heading),
      content: cleanText(section.content),
    }))
    .filter((section) => section.heading && section.content && section.content.length > 40);
}

function buildSectionFAQs(pageUrl, pageTitle, sections) {
  const entries = [];

  for (const section of sections.slice(0, MAX_FAQS_PER_PAGE)) {
    const answers = trimAnswerWithSource(pageUrl, section.content);
    answers.forEach((answer, index) => {
      const questionBase = section.heading.endsWith("?")
        ? section.heading
        : `What does "${section.heading}" say on ${pageTitle}?`;

      const question = answers.length > 1
        ? `${questionBase} (part ${index + 1})`
        : questionBase;

      entries.push({
        question,
        answer,
        keywords: extractKeywords(section.heading, section.content, pageTitle),
      });
    });
  }

  return entries;
}

function discoverLinks($, pageUrl, origin) {
  const links = [];

  $("a[href]").each((_, anchor) => {
    const href = String($(anchor).attr("href") || "").trim();
    if (!href || href.startsWith("#")) return;
    if (/^(mailto|tel|javascript):/i.test(href)) return;

    let absolute;
    try {
      absolute = new URL(href, pageUrl);
    } catch {
      return;
    }

    absolute.hash = "";
    if (absolute.origin !== origin) return;

    const pathname = absolute.pathname.toLowerCase();
    if ([...SKIPPED_EXTENSIONS].some((ext) => pathname.endsWith(ext))) return;

    const normalized = normalizeUrlForQueue(absolute.toString());
    if (!normalized) return;
    links.push(normalized);
  });

  return dedupeOrdered(links).slice(0, MAX_LINKS_PER_PAGE);
}

function extractMetaProductFAQs($, pageUrl) {
  const name = cleanText(
    $("meta[property='og:title']").attr("content") ||
    $("meta[name='twitter:title']").attr("content")
  );
  const description = cleanText(
    $("meta[property='og:description']").attr("content") ||
    $("meta[name='description']").attr("content")
  );
  const price = cleanText(
    $("meta[property='product:price:amount']").attr("content") ||
    $("meta[property='og:price:amount']").attr("content")
  );
  const currency = cleanText(
    $("meta[property='product:price:currency']").attr("content") ||
    $("meta[property='og:price:currency']").attr("content")
  );

  const faqs = [];
  if (name && description) {
    faqs.push({
      question: `What are the details of ${name}?`,
      answer: `Source URL: ${pageUrl}\n${description}`,
      keywords: extractKeywords(name, description, "product details"),
    });
  }

  if (name && price) {
    faqs.push({
      question: `What is the price of ${name}?`,
      answer: `Source URL: ${pageUrl}\n${currency ? `${currency} ` : ""}${price}`,
      keywords: extractKeywords(name, price, currency, "price"),
    });
  }

  return faqs;
}

function extractPageData(html, pageUrl, origin) {
  const $ = cheerio.load(html);
  $(NOISE_SELECTORS.join(", ")).remove();

  const pageTitle = cleanText(
    $("meta[property='og:title']").attr("content") ||
    $("title").first().text() ||
    $("h1").first().text() ||
    getPathLabel(pageUrl)
  );
  const metaDescription = cleanText(
    $("meta[name='description']").attr("content") ||
    $("meta[property='og:description']").attr("content")
  );

  const scope =
    $("main").first().length
      ? $("main").first()
      : $("article").first().length
      ? $("article").first()
      : $("[role='main']").first().length
      ? $("[role='main']").first()
      : $("body");

  const pageText = cleanText(scope.text()).slice(0, MAX_PAGE_TEXT_CHARS);
  const sections = extractHeadingSections($, scope, pageTitle);
  const discoveredLinks = discoverLinks($, pageUrl, origin);

  const faqs = [];
  const routeLabel = getPathLabel(pageUrl);

  if (pageText.length > 60) {
    trimAnswerWithSource(pageUrl, pageText).forEach((answer, index) => {
      const question = index === 0
        ? `What information is available on the ${routeLabel}?`
        : `What other information is available on the ${routeLabel}? (part ${index + 1})`;

      faqs.push({
        question,
        answer,
        keywords: extractKeywords(pageTitle, metaDescription, routeLabel, pageText),
      });
    });
  }

  if (metaDescription) {
    faqs.push({
      question: `What is ${pageTitle} about?`,
      answer: `Source URL: ${pageUrl}\n${metaDescription}`,
      keywords: extractKeywords(pageTitle, metaDescription, routeLabel),
    });
  }

  faqs.push(...extractAccordionFAQs($, pageUrl));
  faqs.push(...extractDefinitionListFAQs($, pageUrl));
  faqs.push(...extractSchemaEntries($, pageUrl));
  faqs.push(...extractMetaProductFAQs($, pageUrl));
  faqs.push(...buildSectionFAQs(pageUrl, pageTitle, sections));

  return {
    pageTitle,
    pageText,
    links: discoveredLinks,
    faqs,
  };
}

async function extractTextFromPDFBuffer(buffer) {
  try {
    const pdfParse = require("pdf-parse");
    const result = await pdfParse(buffer);
    return cleanText(result.text);
  } catch (err) {
    throw new Error(
      "PDF crawling needs the optional dependency pdf-parse. Run `npm install pdf-parse` in backend. " +
      err.message
    );
  }
}

function buildPdfFAQs(pdfUrl, text) {
  const chunks = trimAnswerWithSource(pdfUrl, text);
  const fileName = (() => {
    try {
      return decodeURIComponent(new URL(pdfUrl).pathname.split("/").pop() || "document");
    } catch {
      return "document";
    }
  })();

  return chunks.map((answer, index) => ({
    question: chunks.length > 1
      ? `What does ${fileName} contain? (part ${index + 1})`
      : `What does ${fileName} contain?`,
    answer,
    keywords: extractKeywords(fileName, text, "pdf document"),
  }));
}

function dedupeFAQs(faqs) {
  const seen = new Set();
  const output = [];

  for (const faq of faqs) {
    const question = cleanText(faq.question);
    const answer = cleanText(faq.answer);
    if (!question || !answer) continue;

    const key = `${question.toLowerCase()}::${answer.slice(0, 250).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    output.push({
      question,
      answer,
      keywords: dedupeOrdered(Array.isArray(faq.keywords) ? faq.keywords : []),
    });

    if (output.length >= MAX_TOTAL_FAQS) break;
  }

  return output;
}

async function getNextFaqId() {
  const { data, error } = await supabase
    .from("faqs")
    .select("id")
    .order("id", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Failed to read existing FAQs: ${error.message}`);
  }

  return data?.[0]?.id ? data[0].id + 1 : 1;
}

async function saveFAQsToDatabase(faqs) {
  if (!faqs.length) return 0;

  let nextId = await getNextFaqId();
  const rows = faqs.map((faq) => ({
    id: nextId++,
    question: faq.question,
    answer: faq.answer,
    keywords: faq.keywords || [],
  }));

  const { error } = await supabase.from("faqs").insert(rows);
  if (error) {
    throw new Error(`Failed to insert FAQs: ${error.message}`);
  }

  invalidateFAQCache();
  return rows.length;
}

async function discoverSitemapUrls(origin) {
  try {
    const response = await axios.get(`${origin}/sitemap.xml`, {
      timeout: REQUEST_TIMEOUT_MS,
      responseType: "text",
      headers: { "User-Agent": USER_AGENT },
      validateStatus: (status) => status >= 200 && status < 400,
    });

    const matches = [...String(response.data).matchAll(/<loc>([^<]+)<\/loc>/gi)];
    return dedupeOrdered(
      matches
        .map((match) => normalizeUrlForQueue(match[1]))
        .filter(Boolean)
    ).slice(0, MAX_LINKS_PER_PAGE);
  } catch {
    return [];
  }
}

router.post("/", async (req, res) => {
  const { url, appId = "default" } = req.body;

  if (!url) {
    return res.status(400).json({ error: "A website or document URL is required." });
  }

  let startUrl;
  try {
    startUrl = normalizeInputUrl(url);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
  const safeEnd = () => {
    if (!res.writableEnded) res.end();
  };

  send({
    status: "started",
    message: `Starting crawl for ${startUrl}...`,
    appId,
  });

  try {
    const origin = new URL(startUrl).origin;
    const robotsRules = await fetchRobotsRules(origin);
    const queue = [normalizeUrlForQueue(startUrl)];
    const visited = new Set();
    const allFAQs = [];

    send({
      status: "crawling",
      message: "Respecting robots.txt and preparing internal link discovery...",
    });

    if (queue[0] && !queue[0].toLowerCase().endsWith(".pdf")) {
      const sitemapUrls = await discoverSitemapUrls(origin);
      for (const sitemapUrl of sitemapUrls) {
        if (queue.length >= MAX_LINKS_PER_PAGE) break;
        if (sitemapUrl && !queue.includes(sitemapUrl)) {
          queue.push(sitemapUrl);
        }
      }
    }

    while (queue.length > 0 && visited.size < MAX_PAGES) {
      const currentUrl = queue.shift();
      if (!currentUrl || visited.has(currentUrl)) continue;

      if (!isAllowedByRobots(currentUrl, robotsRules)) {
        visited.add(currentUrl);
        send({
          status: "skipped",
          message: `Skipped ${currentUrl} because robots.txt disallows it.`,
        });
        continue;
      }

      visited.add(currentUrl);
      send({
        status: "crawling",
        message: `Fetching ${currentUrl} (${visited.size}/${MAX_PAGES})...`,
      });

      let resource;
      try {
        resource = await fetchResource(currentUrl);
      } catch (err) {
        send({
          status: "warning",
          message: `Could not fetch ${currentUrl}: ${err.message}`,
        });
        continue;
      }

      if (new URL(resource.url).origin !== origin) {
        send({
          status: "skipped",
          message: `Skipped redirect outside the original domain: ${resource.url}`,
        });
        continue;
      }

      if (isPdfResource(resource, currentUrl)) {
        send({
          status: "crawling",
          message: `Extracting PDF content from ${resource.url}...`,
        });
        const pdfText = await extractTextFromPDFBuffer(resource.buffer);
        if (pdfText) {
          allFAQs.push(...buildPdfFAQs(resource.url, pdfText));
        }
        continue;
      }

      if (!isHtmlResource(resource)) {
        send({
          status: "skipped",
          message: `Skipped unsupported content type at ${resource.url}: ${resource.contentType || "unknown"}`,
        });
        continue;
      }

      const pageData = extractPageData(resource.text, resource.url, origin);
      allFAQs.push(...pageData.faqs);

      send({
        status: "crawling",
        message: `Captured ${pageData.faqs.length} entries from ${pageData.pageTitle || resource.url}.`,
      });

      for (const link of pageData.links) {
        if (visited.size + queue.length >= MAX_PAGES) break;
        if (!visited.has(link) && !queue.includes(link)) {
          queue.push(link);
        }
      }
    }

    const finalFAQs = dedupeFAQs(allFAQs);

    if (finalFAQs.length === 0) {
      send({
        status: "done",
        message: "No usable content was extracted from that input. Try a page with visible text content or a PDF.",
        added: 0,
      });
      return safeEnd();
    }

    send({
      status: "saving",
      message: `Saving ${finalFAQs.length} extracted entries to the FAQ database...`,
    });

    const added = await saveFAQsToDatabase(finalFAQs);

    send({
      status: "done",
      message: `Successfully added ${added} route-aware entries from ${startUrl}.`,
      added,
      crawledPages: visited.size,
    });

    return safeEnd();
  } catch (err) {
    console.error("[Crawler] Error:", err.message);
    send({
      status: "error",
      message: err.message || "Crawler failed.",
    });
    return safeEnd();
  }
});

module.exports = router;
