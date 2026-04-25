import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchAnalytics,
  deleteFAQ,
  formatDateTime,
} from '../../utils/api';
import '../../styles/AdminDashboard.css';

// ============================================================
// API helpers
// ============================================================
async function getAdminFAQs() {
  const res = await fetch('/api/admin/faqs');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.faqs)) return data.faqs;
  return [];
}

/**
 * Upload FAQs to the server.
 * @param {Array}   faqArray  - parsed FAQ objects
 * @param {boolean} replace   - true = wipe existing, false = append
 */
async function uploadFAQsToServer(faqArray, replace = false) {
  const url = `/api/admin/faqs/upload${replace ? '?replace=true' : ''}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(faqArray),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data;
}

// ============================================================
// Analytics Tab
// ============================================================
function AnalyticsTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const result = await fetchAnalytics();
      setData(result);
    } catch (err) {
      console.error('Analytics error:', err);
      setError(err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  if (loading) return (
    <div className="loading-wrap">
      <div className="loading-spinner" />
      Loading analytics...
    </div>
  );

  if (error) return (
    <div className="alert alert--error" style={{ margin: '24px 0' }}>
      ⚠️ Failed to load analytics: {error}
    </div>
  );

  const cards = [
    { icon: '💬', label: 'Total Queries',  value: data?.totalQueries ?? 0, colorClass: 'total',    percent: null },
    { icon: '📚', label: 'FAQ Answered',   value: data?.faqAnswered  ?? 0, colorClass: 'faq',      percent: data?.faqAnsweredPercent },
    { icon: '✨', label: 'AI Answered',    value: data?.aiAnswered   ?? 0, colorClass: 'ai',       percent: data?.aiAnsweredPercent },
    { icon: '👤', label: 'Escalations',    value: data?.escalations  ?? 0, colorClass: 'escalate', percent: data?.escalationRate },
  ];

  const escalationsList = data?.escalationsList ?? [];

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">Analytics Overview</h2>
        <p className="section-subtitle">Live stats · Auto-refreshes every 30 seconds</p>
      </div>

      <div className="analytics-grid">
        {cards.map(card => (
          <div className="analytics-card" key={card.label}>
            <div className={`analytics-card__icon analytics-card__icon--${card.colorClass}`}>{card.icon}</div>
            <div className="analytics-card__value">{card.value}</div>
            <div className="analytics-card__label">{card.label}</div>
            {card.percent !== null && card.percent !== undefined && (
              <div className="analytics-card__percent">{card.percent}% of total</div>
            )}
          </div>
        ))}
      </div>

      <div className="table-container">
        <div className="table-header">
          <span className="table-title">Recent Escalation Requests</span>
          <span className="table-count">{escalationsList.length} total</span>
        </div>
        {escalationsList.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state__icon">🎉</span>
            No escalations yet — all queries handled by the bot!
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Email</th><th>Issue</th><th>Status</th><th>Date</th>
              </tr>
            </thead>
            <tbody>
              {escalationsList.map(e => (
                <tr key={e.id}>
                  <td><strong>{e.name}</strong></td>
                  <td>{e.email}</td>
                  <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.issue}
                  </td>
                  <td>
                    <span className={`status-badge status-badge--${e.status === 'in-progress' ? 'progress' : e.status}`}>
                      {e.status}
                    </span>
                  </td>
                  <td>{formatDateTime(e.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ============================================================
// FAQ Manager Tab
// ============================================================
function FAQManagerTab() {
  const [faqs, setFaqs]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [alert, setAlert]         = useState(null);
  const [uploading, setUploading] = useState(false);

  // FIX 1: Upload mode toggle — "append" (default) or "replace"
  const [uploadMode, setUploadMode] = useState('append');

  const fileInputRef = useRef(null);

  const showAlert = useCallback((type, message) => {
    setAlert({ type, message });
    setTimeout(() => setAlert(null), 6000);
  }, []);

  const loadFAQs = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getAdminFAQs();
      setFaqs(list);
    } catch (err) {
      showAlert('error', 'Failed to load FAQs: ' + err.message);
      setFaqs([]);
    } finally {
      setLoading(false);
    }
  }, [showAlert]);

  useEffect(() => { loadFAQs(); }, [loadFAQs]);

  // ============================================================
  // handleFileUpload
  // FIX 2: Accepts JSON, CSV, and PDF.
  //   - JSON: parsed client-side as before
  //   - CSV:  sent as JSON after client-side parse
  //   - PDF:  sent directly as multipart/form-data so the server
  //           can use pdf-parse on the binary buffer
  // ============================================================
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const filename = file.name.toLowerCase();

    try {
      const isReplace = uploadMode === 'replace';

      // ---- PDF: send as FormData so server can parse binary ----
      if (filename.endsWith('.pdf')) {
        const formData = new FormData();
        formData.append('file', file);
        const url = `/api/admin/faqs/upload${isReplace ? '?replace=true' : ''}`;
        const res = await fetch(url, { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        showAlert('success', data.message || `PDF uploaded successfully!`);
        loadFAQs();
        return;
      }

      // ---- JSON / CSV: read as text, parse client-side, send as JSON ----
      const text = await file.text();
      let faqArray;

      if (filename.endsWith('.json')) {
        let parsed;
        try { parsed = JSON.parse(text); } catch { throw new Error('Invalid JSON file.'); }
        faqArray = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.faqs) ? parsed.faqs : null;
        if (!faqArray) throw new Error('JSON must be an array or { faqs: [] }.');

      } else if (filename.endsWith('.csv')) {
        faqArray = parseCSVClient(text);

      } else {
        throw new Error('Unsupported file type. Please upload a .json, .csv, or .pdf file.');
      }

      if (!faqArray || faqArray.length === 0) {
        throw new Error('No valid FAQ entries found in the file.');
      }

      const result = await uploadFAQsToServer(faqArray, isReplace);
      showAlert('success', result.message || `Successfully uploaded ${faqArray.length} FAQs!`);
      loadFAQs();

    } catch (err) {
      showAlert('error', 'Upload failed: ' + err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (id, question) => {
    if (!window.confirm(`Delete FAQ: "${question}"?`)) return;
    try {
      await deleteFAQ(id);
      showAlert('success', 'FAQ deleted successfully.');
      loadFAQs();
    } catch (err) {
      showAlert('error', 'Delete failed: ' + err.message);
    }
  };

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">FAQ Manager</h2>
        <p className="section-subtitle">
          Upload JSON, CSV, or PDF · Choose Append or Replace mode
        </p>
      </div>

      {alert && (
        <div className={`alert alert--${alert.type}`}>
          {alert.type === 'success' ? '✅' : '⚠️'} {alert.message}
        </div>
      )}

      {/* ── Upload Mode Toggle ── */}
      <div style={{
        display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center',
        background: 'white', border: '1px solid #e2e8f0', borderRadius: 12,
        padding: '12px 16px',
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>Upload mode:</span>
        {['append', 'replace'].map(mode => (
          <label key={mode} style={{
            display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
            fontSize: 13, fontWeight: uploadMode === mode ? 700 : 400,
            color: uploadMode === mode ? 'var(--color-primary)' : '#64748b',
          }}>
            <input
              type="radio"
              name="uploadMode"
              value={mode}
              checked={uploadMode === mode}
              onChange={() => setUploadMode(mode)}
              style={{ accentColor: 'var(--color-primary)' }}
            />
            {mode === 'append' ? '➕ Append (add to existing)' : '🔄 Replace (wipe & reload)'}
          </label>
        ))}
        <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto' }}>
          {uploadMode === 'append'
            ? 'New FAQs will be added alongside existing ones'
            : '⚠️ This will DELETE all current FAQs first'}
        </span>
      </div>

      {/* ── Upload Area ── */}
      <label className="upload-area" htmlFor="faq-upload">
        <span className="upload-area__icon">{uploading ? '⏳' : '📁'}</span>
        <p className="upload-area__title">
          {uploading
            ? 'Uploading to Supabase...'
            : 'Click to upload FAQ file (JSON, CSV, or PDF)'}
        </p>
        <p className="upload-area__hint">
          Accepts .json · .csv · .pdf · Max 10MB ·{' '}
          {uploadMode === 'append' ? 'Appends to existing FAQs' : 'Replaces entire FAQ database'}
        </p>
        <input
          id="faq-upload"
          ref={fileInputRef}
          type="file"
          accept=".json,.csv,.pdf,application/json,text/csv,application/pdf"
          onChange={handleFileUpload}
          disabled={uploading}
        />
      </label>

      {/* ── Format hints ── */}
      <div style={{
        background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12,
        padding: '12px 16px', marginBottom: 20, fontSize: 12, color: '#64748b',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        <div>
          <strong style={{ color: '#475569' }}>JSON:</strong>{' '}
          <code style={{ background: '#e2e8f0', padding: '1px 6px', borderRadius: 4 }}>
            {'[{ "question": "...", "answer": "...", "keywords": ["kw1"] }]'}
          </code>
        </div>
        <div>
          <strong style={{ color: '#475569' }}>CSV:</strong>{' '}
          <code style={{ background: '#e2e8f0', padding: '1px 6px', borderRadius: 4 }}>
            {'question,answer,keywords (header row required; keywords separated by semicolons)'}
          </code>
        </div>
        <div>
          <strong style={{ color: '#475569' }}>PDF:</strong>{' '}
          <code style={{ background: '#e2e8f0', padding: '1px 6px', borderRadius: 4 }}>
            {'Q: question text A: answer text — or numbered 1. Question\\nAnswer blocks'}
          </code>
        </div>
      </div>

      {/* ── FAQ Table ── */}
      <div className="faq-table-wrap">
        <div className="table-header">
          <span className="table-title">Current FAQ Knowledge Base (Supabase)</span>
          <span className="table-count">{faqs.length} entries</span>
        </div>

        {loading ? (
          <div className="loading-wrap">
            <div className="loading-spinner" /> Loading FAQs from Supabase...
          </div>
        ) : faqs.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state__icon">📭</span>
            No FAQs found in Supabase. Upload a file above to get started.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Question</th>
                <th>Keywords</th>
                <th style={{ width: 80 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {faqs.map(faq => {
                const keywords = Array.isArray(faq.keywords) ? faq.keywords : [];
                return (
                  <tr key={faq.id}>
                    <td style={{ color: 'var(--color-text-muted)' }}>{faq.id}</td>
                    <td><strong>{faq.question}</strong></td>
                    <td style={{ maxWidth: 200 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {keywords.slice(0, 4).map(kw => (
                          <span key={kw} style={{
                            background: 'var(--color-bg-chat)', padding: '1px 7px',
                            borderRadius: 'var(--radius-full)', fontSize: 11,
                            color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)',
                          }}>{kw}</span>
                        ))}
                        {keywords.length > 4 && (
                          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                            +{keywords.length - 4} more
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <button
                        onClick={() => handleDelete(faq.id, faq.question)}
                        style={{
                          padding: '4px 10px', borderRadius: 'var(--radius-sm)',
                          border: '1px solid #fecaca', background: '#fef2f2',
                          color: 'var(--color-danger)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Client-side CSV parser (mirrors the server-side one)
// ============================================================
function parseCSVClient(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row.');

  function parseLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());
    return fields;
  }

  const headers = parseLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z]/g, ''));
  const qIdx = headers.indexOf('question');
  const aIdx = headers.indexOf('answer');
  const kIdx = headers.indexOf('keywords');

  if (qIdx === -1 || aIdx === -1) throw new Error('CSV must contain "question" and "answer" columns.');

  const faqs = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const fields = parseLine(line);
    const question = fields[qIdx]?.replace(/^"|"$/g, '').trim();
    const answer   = fields[aIdx]?.replace(/^"|"$/g, '').trim();
    if (!question || !answer) continue;

    let keywords = [];
    if (kIdx !== -1 && fields[kIdx]) {
      const raw = fields[kIdx].replace(/^"|"$/g, '').trim();
      keywords = raw.split(/[;,|]/).map(k => k.trim()).filter(Boolean);
    }

    faqs.push({ question, answer, keywords });
  }

  if (faqs.length === 0) throw new Error('No valid rows found in CSV.');
  return faqs;
}

function CrawlTab() {
  const [url, setUrl] = useState("");
  const [logs, setLogs] = useState([]);
  const [crawling, setCrawling] = useState(false);
  const [done, setDone] = useState(false);

  const startCrawl = async () => {
    if (!url.trim()) return;
    setCrawling(true);
    setDone(false);
    setLogs([{ message: "Connecting to crawler...", status: "started" }]);

    try {
      const response = await fetch("/api/admin/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });

      if (!response.ok || !response.body) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const event of events) {
          const line = event.split("\n").find((entry) => entry.startsWith("data:"));
          if (!line) continue;

          try {
            const data = JSON.parse(line.replace(/^data:\s*/, ""));
            setLogs((prev) => [...prev, data]);
            if (data.status === "done" || data.status === "error") {
              setCrawling(false);
              setDone(true);
            }
          } catch {}
        }
      }
    } catch (err) {
      setLogs((prev) => [...prev, { status: "error", message: err.message }]);
      setDone(true);
    } finally {
      setCrawling(false);
    }
  };

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">Universal Crawl</h2>
        <p className="section-subtitle">
          Paste any website or PDF URL and we&apos;ll crawl route content into your FAQ database
        </p>
      </div>

      {/* URL Input */}
      <div style={{
        background: "white", borderRadius: 16, padding: 24,
        border: "1px solid #e2e8f0", marginBottom: 24,
      }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: "#475569", display: "block", marginBottom: 8 }}>
          Website or Document URL
        </label>
        <div style={{ display: "flex", gap: 12 }}>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com or https://example.com/file.pdf"
            disabled={crawling}
            style={{
              flex: 1, padding: "10px 16px", borderRadius: 10,
              border: "1.5px solid #e2e8f0", fontSize: 14, outline: "none",
            }}
          />
          <button
            onClick={startCrawl}
            disabled={crawling || !url.trim()}
            style={{
              padding: "10px 24px", borderRadius: 10,
              background: crawling ? "#e2e8f0" : "#4f46e5",
              color: crawling ? "#94a3b8" : "white",
              fontWeight: 700, fontSize: 14, border: "none", cursor: crawling ? "not-allowed" : "pointer",
            }}
          >
            {crawling ? "Crawling..." : "Start Crawl"}
          </button>
        </div>
        <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 8 }}>
          We&apos;ll follow internal links, extract route text, and store clean entries automatically
        </p>
      </div>

      {/* Live Logs */}
      {logs.length > 0 && (
        <div style={{
          background: "#0f172a", borderRadius: 16, padding: 24,
          fontFamily: "monospace", fontSize: 13,
        }}>
          <p style={{ color: "#94a3b8", marginBottom: 12, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Live Progress
          </p>
          {logs.map((log, i) => (
            <div key={i} style={{
              color: log.status === "error" ? "#f87171"
                   : log.status === "done"  ? "#4ade80"
                   : "#e2e8f0",
              marginBottom: 6, display: "flex", gap: 8,
            }}>
              <span style={{ color: "#475569" }}>→</span>
              {log.message}
            </div>
          ))}
          {crawling && (
            <div style={{ color: "#818cf8", marginTop: 8 }}>
              Working...
            </div>
          )}
        </div>
      )}

      {/* Success */}
      {done && logs[logs.length - 1]?.status === "done" && (
        <div style={{
          marginTop: 16, padding: 16, background: "#d1fae5",
          borderRadius: 12, color: "#065f46", fontWeight: 600, fontSize: 14,
        }}>
          {logs[logs.length - 1].message} - Go to FAQ Manager to review them.
        </div>
      )}
    </div>
  );
}

// ============================================================
// Main AdminDashboard Component
// ============================================================
function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('analytics');

  const tabs = [
    { id: 'analytics', label: '📊 Analytics' },
    { id: 'crawl',     label: 'Crawl' },
    { id: 'faqs',      label: '📚 FAQ Manager' },
  ];

  return (
    <div className="admin-page">
      <nav className="admin-nav">
        <div className="admin-nav__brand">
          <div className="admin-nav__logo">🤖</div>
          <div>
            <div className="admin-nav__title">ChatBot Admin</div>
            <div className="admin-nav__subtitle">Dashboard</div>
          </div>
        </div>
        <div className="admin-nav__tabs">
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`admin-tab ${activeTab === tab.id ? 'admin-tab--active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>
      <main className="admin-content">
        {activeTab === 'analytics' && <AnalyticsTab />}
        {activeTab === 'crawl'     && <CrawlTab />}
        {activeTab === 'faqs'      && <FAQManagerTab />}
      </main>
    </div>
  );
}

export default AdminDashboard;
