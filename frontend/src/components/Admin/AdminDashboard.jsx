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
    { icon: '💬', label: 'Total Queries', value: data?.totalQueries ?? 0, colorClass: 'total', percent: null },
    { icon: '📚', label: 'FAQ Answered', value: data?.faqAnswered ?? 0, colorClass: 'faq', percent: data?.faqAnsweredPercent },
    { icon: '✨', label: 'AI Answered', value: data?.aiAnswered ?? 0, colorClass: 'ai', percent: data?.aiAnsweredPercent },
    { icon: '👤', label: 'Escalations', value: data?.escalations ?? 0, colorClass: 'escalate', percent: data?.escalationRate },
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
  const [faqs, setFaqs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState(null);
  const [uploading, setUploading] = useState(false);
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

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const filename = file.name.toLowerCase();

    try {
      const isReplace = uploadMode === 'replace';

      if (filename.endsWith('.pdf')) {
        const formData = new FormData();
        formData.append('file', file);
        const url = `/api/admin/faqs/upload${isReplace ? '?replace=true' : ''}`;
        const res = await fetch(url, { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        showAlert('success', data.message || 'PDF uploaded successfully!');
        loadFAQs();
        return;
      }

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

      if (!faqArray || faqArray.length === 0) throw new Error('No valid FAQ entries found in the file.');

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
        <p className="section-subtitle">Upload JSON, CSV, or PDF · Choose Append or Replace mode</p>
      </div>

      {alert && (
        <div className={`alert alert--${alert.type}`}>
          {alert.type === 'success' ? '✅' : '⚠️'} {alert.message}
        </div>
      )}

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

      <label className="upload-area" htmlFor="faq-upload">
        <span className="upload-area__icon">{uploading ? '⏳' : '📁'}</span>
        <p className="upload-area__title">
          {uploading ? 'Uploading to Supabase...' : 'Click to upload FAQ file (JSON, CSV, or PDF)'}
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
// Client-side CSV parser
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
    const answer = fields[aIdx]?.replace(/^"|"$/g, '').trim();
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

// ============================================================
// Web Crawler Tab — single-page and deep (multi-link) crawl
// ============================================================
const CRAWLER_STEPS = {
  IDLE: 'idle',
  FETCHING_LINKS: 'fetching_links',
  SELECT_LINKS: 'select_links',
  CRAWLING: 'crawling',
  PREVIEW: 'preview',
  SAVING: 'saving',
  DONE: 'done',
};

const EXAMPLE_URLS = [
  'https://help.shopify.com/en/manual/your-account',
  'https://support.google.com/accounts/faq',
  'https://www.notion.so/help',
  'https://zapier.com/help/create/basics',
];

function WebCrawlerTab() {
  const [step, setStep] = useState(CRAWLER_STEPS.IDLE);
  const [mode, setMode] = useState('single');
  const [url, setUrl] = useState('');
  const [saveMode, setSaveMode] = useState('append');

  const [discoveredLinks, setDiscoveredLinks] = useState([]);
  const [selectedLinks, setSelectedLinks] = useState(new Set());
  const [crawlProgress, setCrawlProgress] = useState({ done: 0, total: 0, current: '' });

  const [extractedFAQs, setExtracted] = useState([]);
  const [selectedFAQIds, setSelectedFAQIds] = useState(new Set());

  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [savedCount, setSavedCount] = useState(0);
  const inputRef = useRef(null);

  const handleReset = () => {
    setStep(CRAWLER_STEPS.IDLE);
    setUrl('');
    setDiscoveredLinks([]);
    setSelectedLinks(new Set());
    setExtracted([]);
    setSelectedFAQIds(new Set());
    setCrawlProgress({ done: 0, total: 0, current: '' });
    setError(null);
    setSuccessMsg(null);
    setSavedCount(0);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleSingleCrawl = async () => {
    if (!url.trim()) return;
    setError(null);
    setStep(CRAWLER_STEPS.CRAWLING);
    try {
      const res = await fetch('/api/admin/crawl/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Crawl failed');
      setExtracted(data.faqs);
      setSelectedFAQIds(new Set(data.faqs.map((_, i) => i)));
      setStep(CRAWLER_STEPS.PREVIEW);
    } catch (err) {
      setError(err.message);
      setStep(CRAWLER_STEPS.IDLE);
    }
  };

  const handleFetchLinks = async () => {
    if (!url.trim()) return;
    setError(null);
    setStep(CRAWLER_STEPS.FETCHING_LINKS);
    try {
      const res = await fetch('/api/admin/crawl/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Link extraction failed');
      setDiscoveredLinks(data.links);

      const PRIORITY = /faq|help|support|question|knowledge/i;
      const priorityIdxs = data.links
        .map((l, i) => ({ ...l, i }))
        .filter(l => PRIORITY.test(l.path))
        .map(l => l.i);
      setSelectedLinks(
        new Set(priorityIdxs.length > 0 ? priorityIdxs : data.links.map((_, i) => i).slice(0, 10))
      );
      setStep(CRAWLER_STEPS.SELECT_LINKS);
    } catch (err) {
      setError(err.message);
      setStep(CRAWLER_STEPS.IDLE);
    }
  };

  const handleDeepCrawl = async () => {
    const linksToScrape = discoveredLinks.filter((_, i) => selectedLinks.has(i));
    if (linksToScrape.length === 0) { setError('Select at least one page to crawl.'); return; }

    setError(null);
    setStep(CRAWLER_STEPS.CRAWLING);
    setCrawlProgress({ done: 0, total: linksToScrape.length, current: '' });

    const allFAQs = [];
    const seenQuestions = new Set();

    for (let i = 0; i < linksToScrape.length; i++) {
      const link = linksToScrape[i];
      setCrawlProgress({ done: i, total: linksToScrape.length, current: link.path });

      try {
        const res = await fetch('/api/admin/crawl/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: link.href }),
        });
        if (!res.ok) continue;

        const data = await res.json();
        for (const faq of (data.faqs || [])) {
          const key = faq.question.toLowerCase().slice(0, 80);
          if (!seenQuestions.has(key)) {
            seenQuestions.add(key);
            allFAQs.push({ ...faq, _source: link.path });
          }
        }
      } catch {
        // skip individual page errors silently
      }

      await new Promise(r => setTimeout(r, 300));
    }

    setCrawlProgress(p => ({ ...p, done: p.total, current: '' }));

    if (allFAQs.length === 0) {
      setError('No FAQ content found across the selected pages.');
      setStep(CRAWLER_STEPS.SELECT_LINKS);
      return;
    }

    setExtracted(allFAQs);
    setSelectedFAQIds(new Set(allFAQs.map((_, i) => i)));
    setStep(CRAWLER_STEPS.PREVIEW);
  };

  const toggleFAQ = (idx) => setSelectedFAQIds(prev => { const n = new Set(prev); n.has(idx) ? n.delete(idx) : n.add(idx); return n; });
  const selectAllFAQs = () => setSelectedFAQIds(new Set(extractedFAQs.map((_, i) => i)));
  const deselectAllFAQs = () => setSelectedFAQIds(new Set());
  const toggleLink = (idx) => setSelectedLinks(prev => { const n = new Set(prev); n.has(idx) ? n.delete(idx) : n.add(idx); return n; });
  const selectAllLinks = () => setSelectedLinks(new Set(discoveredLinks.map((_, i) => i)));
  const deselectAllLinks = () => setSelectedLinks(new Set());

  const handleSave = async () => {
    const toSave = extractedFAQs.filter((_, i) => selectedFAQIds.has(i));
    if (toSave.length === 0) { setError('Select at least one FAQ to save.'); return; }
    setError(null);
    setStep(CRAWLER_STEPS.SAVING);
    try {
      const res = await fetch('/api/admin/crawl/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ faqs: toSave, mode: saveMode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setSavedCount(data.added);
      setSuccessMsg(data.message);
      setStep(CRAWLER_STEPS.DONE);
    } catch (err) {
      setError(err.message);
      setStep(CRAWLER_STEPS.PREVIEW);
    }
  };

  const s = {
    card: { background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', padding: 24, marginBottom: 20 },
    btnPrimary: { padding: '10px 22px', borderRadius: 10, background: 'var(--color-primary)', color: 'white', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' },
    btnSecondary: { padding: '10px 18px', borderRadius: 10, background: '#f1f5f9', color: '#475569', fontWeight: 600, fontSize: 14, border: '1px solid #e2e8f0', cursor: 'pointer', whiteSpace: 'nowrap' },
    spinner: { width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.4)', borderTopColor: 'white', animation: 'spin 0.7s linear infinite', display: 'inline-block' },
    kwTag: { display: 'inline-block', padding: '1px 7px', borderRadius: 99, background: '#e0e7ff', color: '#4f46e5', fontSize: 11, marginRight: 4, marginTop: 4 },
    checkbox: (checked) => ({ width: 18, height: 18, borderRadius: 4, flexShrink: 0, border: `2px solid ${checked ? 'var(--color-primary)' : '#d1d5db'}`, background: checked ? 'var(--color-primary)' : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 150ms' }),
  };

  const isBusy = [CRAWLER_STEPS.FETCHING_LINKS, CRAWLER_STEPS.CRAWLING, CRAWLER_STEPS.SAVING].includes(step);
  const CheckIcon = () => (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
      <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">🌐 Website FAQ Crawler</h2>
        <p className="section-subtitle">Single page or deep crawl · Extracts Q&amp;A pairs · Save directly to your chatbot</p>
      </div>

      {error && <div className="alert alert--error" style={{ marginBottom: 16 }}>⚠️ {error}</div>}

      {(step === CRAWLER_STEPS.IDLE || step === CRAWLER_STEPS.FETCHING_LINKS) && (
        <div style={s.card}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            {[['single', '🔍 Single page'], ['deep', '🕸️ Deep crawl (follow links)']].map(([id, label]) => (
              <button key={id} onClick={() => setMode(id)} style={{ ...s.btnSecondary, background: mode === id ? 'var(--color-primary)' : '#f1f5f9', color: mode === id ? 'white' : '#475569', border: mode === id ? 'none' : '1px solid #e2e8f0' }}>
                {label}
              </button>
            ))}
          </div>

          <p style={{ fontSize: 13, fontWeight: 600, color: '#475569', marginBottom: 10 }}>
            {mode === 'single' ? '🔗 Enter a specific FAQ/help page URL:' : '🏠 Enter the homepage URL to discover all internal links:'}
          </p>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input
              ref={inputRef}
              style={{ flex: 1, minWidth: 200, padding: '10px 14px', borderRadius: 10, border: '1.5px solid #e2e8f0', fontSize: 14, outline: 'none', fontFamily: 'inherit' }}
              type="url"
              placeholder={mode === 'single' ? 'https://yoursite.com/faq' : 'https://yoursite.com'}
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (mode === 'single' ? handleSingleCrawl() : handleFetchLinks())}
              disabled={isBusy}
            />
            <button style={{ ...s.btnPrimary, opacity: isBusy ? 0.7 : 1, cursor: isBusy ? 'not-allowed' : 'pointer' }} onClick={mode === 'single' ? handleSingleCrawl : handleFetchLinks} disabled={isBusy || !url.trim()}>
              {isBusy ? <><span style={s.spinner} /> Working...</> : mode === 'single' ? '🕷️ Crawl Page' : '🔎 Find Links'}
            </button>
          </div>

          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>💡 Try an example:</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {EXAMPLE_URLS.map(ex => (
                <button key={ex} onClick={() => setUrl(ex)} title={ex} style={{ padding: '3px 10px', borderRadius: 99, background: '#f1f5f9', border: '1px solid #e2e8f0', fontSize: 11, color: '#64748b', cursor: 'pointer', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ex.replace('https://', '')}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 20, padding: '14px 16px', background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 8 }}>🔍 How it works:</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
              {(mode === 'single' ? [
                { icon: '1️⃣', text: 'Fetches the page HTML' },
                { icon: '2️⃣', text: 'Detects FAQ patterns (JSON-LD, accordions, headings, dl/dt)' },
                { icon: '3️⃣', text: 'Extracts Q&A pairs with auto-keywords' },
                { icon: '4️⃣', text: 'You review and save selected FAQs' },
              ] : [
                { icon: '1️⃣', text: 'Fetches homepage and extracts all internal links' },
                { icon: '2️⃣', text: 'You select which pages to crawl (FAQ pages pre-selected)' },
                { icon: '3️⃣', text: 'Each page is crawled and FAQs extracted & deduplicated' },
                { icon: '4️⃣', text: 'Unified review — save selected FAQs to Supabase' },
              ]).map(item => (
                <div key={item.icon} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  <span>{item.icon}</span>
                  <span style={{ fontSize: 12, color: '#64748b', lineHeight: 1.4 }}>{item.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === CRAWLER_STEPS.CRAWLING && (
        <div style={{ ...s.card, textAlign: 'center', padding: '40px 24px' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🕷️</div>
          {crawlProgress.total > 1 ? (
            <>
              <p style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>Crawling {crawlProgress.done} / {crawlProgress.total} pages...</p>
              <div style={{ background: '#e2e8f0', borderRadius: 99, height: 6, margin: '12px auto', maxWidth: 400 }}>
                <div style={{ background: 'var(--color-primary)', borderRadius: 99, height: '100%', width: `${(crawlProgress.done / crawlProgress.total) * 100}%`, transition: 'width 0.3s' }} />
              </div>
              <p style={{ fontSize: 12, color: '#94a3b8' }}>{crawlProgress.current ? `Fetching: ${crawlProgress.current}` : 'Starting...'}</p>
            </>
          ) : (
            <p style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>Crawling page...</p>
          )}
        </div>
      )}

      {step === CRAWLER_STEPS.SELECT_LINKS && (
        <div>
          <div style={{ ...s.card, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 20 }}>🌐</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 2 }}>Found <strong>{discoveredLinks.length}</strong> internal links on <span style={{ color: 'var(--color-primary)' }}>{url}</span></p>
              <p style={{ fontSize: 12, color: '#64748b' }}><strong style={{ color: 'var(--color-primary)' }}>{selectedLinks.size}</strong> selected · FAQ/help pages pre-selected automatically</p>
            </div>
            <button style={s.btnSecondary} onClick={handleReset}>← Back</button>
          </div>

          <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', overflow: 'hidden', marginBottom: 16 }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', flex: 1 }}>Select pages to crawl for FAQs</span>
              <button style={{ ...s.btnSecondary, padding: '5px 12px', fontSize: 12 }} onClick={selectAllLinks}>All</button>
              <button style={{ ...s.btnSecondary, padding: '5px 12px', fontSize: 12 }} onClick={deselectAllLinks}>None</button>
            </div>
            <div style={{ maxHeight: 360, overflowY: 'auto' }}>
              {discoveredLinks.map((link, idx) => {
                const checked = selectedLinks.has(idx);
                const isPriority = /faq|help|support|question|knowledge/i.test(link.path);
                return (
                  <div key={idx} onClick={() => toggleLink(idx)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', background: checked ? '#fafbff' : 'white' }}>
                    <div style={s.checkbox(checked)}>{checked && <CheckIcon />}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {link.text || link.path}
                        {isPriority && <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 99, background: '#d1fae5', color: '#065f46' }}>FAQ</span>}
                      </p>
                      <p style={{ fontSize: 11, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{link.href}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button style={s.btnSecondary} onClick={handleReset}>← New URL</button>
            <button style={{ ...s.btnPrimary, opacity: selectedLinks.size === 0 ? 0.6 : 1, cursor: selectedLinks.size === 0 ? 'not-allowed' : 'pointer' }} onClick={handleDeepCrawl} disabled={selectedLinks.size === 0}>
              🕷️ Crawl {selectedLinks.size} page{selectedLinks.size !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}

      {(step === CRAWLER_STEPS.PREVIEW || step === CRAWLER_STEPS.SAVING) && (
        <div>
          <div style={{ ...s.card, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 20 }}>🌐</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 2 }}>
                {mode === 'deep' ? `Crawled ${selectedLinks.size} page${selectedLinks.size !== 1 ? 's' : ''} from ${url}` : `Crawled: ${url}`}
              </p>
              <p style={{ fontSize: 12, color: '#64748b' }}>Found <strong>{extractedFAQs.length}</strong> unique FAQ{extractedFAQs.length !== 1 ? 's' : ''} · <strong style={{ color: 'var(--color-primary)' }}>{selectedFAQIds.size}</strong> selected to save</p>
            </div>
            <button style={s.btnSecondary} onClick={handleReset}>← New URL</button>
          </div>

          <div style={{ ...s.card, padding: '14px 18px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>Save mode:</span>
            {['append', 'replace'].map(m => (
              <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, fontWeight: saveMode === m ? 700 : 400, color: saveMode === m ? 'var(--color-primary)' : '#64748b' }}>
                <input type="radio" name="crawlSaveMode" value={m} checked={saveMode === m} onChange={() => setSaveMode(m)} style={{ accentColor: 'var(--color-primary)' }} />
                {m === 'append' ? '➕ Append' : '🔄 Replace all'}
              </label>
            ))}
            <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
              <button style={{ ...s.btnSecondary, padding: '6px 12px', fontSize: 12 }} onClick={selectAllFAQs}>✅ All</button>
              <button style={{ ...s.btnSecondary, padding: '6px 12px', fontSize: 12 }} onClick={deselectAllFAQs}>☐ None</button>
              <button style={{ ...s.btnPrimary, opacity: step === CRAWLER_STEPS.SAVING || selectedFAQIds.size === 0 ? 0.7 : 1, cursor: step === CRAWLER_STEPS.SAVING || selectedFAQIds.size === 0 ? 'not-allowed' : 'pointer' }} onClick={handleSave} disabled={step === CRAWLER_STEPS.SAVING || selectedFAQIds.size === 0}>
                {step === CRAWLER_STEPS.SAVING ? <><span style={s.spinner} /> Saving...</> : `💾 Save ${selectedFAQIds.size} FAQ${selectedFAQIds.size !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>

          <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Extracted FAQs — Review before saving</span>
              <span style={{ fontSize: 12, padding: '2px 10px', background: '#f1f5f9', borderRadius: 99, color: '#64748b' }}>{extractedFAQs.length} found</span>
            </div>
            {extractedFAQs.map((faq, idx) => {
              const checked = selectedFAQIds.has(idx);
              return (
                <div key={idx} onClick={() => toggleFAQ(idx)} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px', borderBottom: '1px solid #f1f5f9', background: checked ? '#fafbff' : 'white', cursor: 'pointer' }}>
                  <div style={{ ...s.checkbox(checked), marginTop: 2 }}>{checked && <CheckIcon />}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {faq._source && <p style={{ fontSize: 10, color: '#94a3b8', marginBottom: 3 }}>from {faq._source}</p>}
                    <p style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>Q: {faq.question}</p>
                    <p style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5, marginBottom: 6, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>A: {faq.answer}</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {(faq.keywords || []).slice(0, 5).map(kw => <span key={kw} style={s.kwTag}>{kw}</span>)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {step === CRAWLER_STEPS.DONE && (
        <div style={{ ...s.card, textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>🎉</div>
          <h3 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>FAQs saved successfully!</h3>
          <p style={{ fontSize: 15, color: '#64748b', marginBottom: 6 }}>{successMsg || `${savedCount} FAQs are now live in your chatbot's knowledge base.`}</p>
          <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 28 }}>Your chatbot will use these in the next query automatically.</p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button style={s.btnPrimary} onClick={handleReset}>🌐 Crawl Another URL</button>
            <button style={s.btnSecondary} onClick={() => window._adminSwitchTab && window._adminSwitchTab('faqs')}>📚 View FAQ Manager</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Auto-Crawl Settings Tab  ← NEW
// Lets admins configure and test the embed auto-crawl feature.
// ============================================================
function AutoCrawlTab() {
  const DEFAULT_SETTINGS = {
    enabled: false,
    urls: '',
    mode: 'append',
    saveToDb: true,
    ttlHours: 24,
    deepLinks: false,
    maxPages: 10,
    onlyFAQPaths: false,
    silent: true,
  };

  const STORAGE_KEY = 'chatbot_autocrawl_settings';

  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch { return DEFAULT_SETTINGS; }
  });

  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testUrl, setTestUrl] = useState('');

  const set = (key, val) => setSettings(prev => ({ ...prev, [key]: val }));

  const saveSettings = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { }
  };

  const runTest = async () => {
    const urlToTest = testUrl.trim() || window.location.origin;
    setTesting(true);
    setTestResult(null);
    try {
      const urls = settings.urls
        ? settings.urls.split('\n').map(u => u.trim()).filter(Boolean)
        : [urlToTest];

      const res = await fetch('/api/admin/crawl/auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls,
          mode: settings.mode,
          saveToDb: settings.saveToDb,
          appId: 'admin-test',
        }),
      });
      const data = await res.json();
      setTestResult({ ok: res.ok || res.status === 207, data });
    } catch (err) {
      setTestResult({ ok: false, data: { error: err.message } });
    } finally {
      setTesting(false);
    }
  };

  const urlList = settings.urls
    ? settings.urls.split('\n').map(u => u.trim()).filter(Boolean)
    : [];

  const embedCode = `<script src="chatbot.js"></script>
<script>
  initChatbot({
    apiUrl: "https://your-backend.com",
    appId:  "my-app",
    bot:    { name: "Support Assistant" },

    // ── Auto-Crawl ──────────────────────────────
    autoCrawl:           ${settings.enabled},
    autoCrawlUrls:       ${urlList.length > 0 ? JSON.stringify(urlList) : '[]  // [] = crawl current page'},
    autoCrawlMode:       "${settings.mode}",
    autoCrawlSaveToDb:   ${settings.saveToDb},
    autoCrawlTTLHours:   ${settings.ttlHours},
    autoCrawlDeepLinks:  ${settings.deepLinks},
    autoCrawlMaxPages:   ${settings.maxPages},
    autoCrawlOnlyFAQPaths: ${settings.onlyFAQPaths},
    autoCrawlSilent:     ${settings.silent},
  });
</script>`;

  const cardStyle = { background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: 24, marginBottom: 20 };
  const labelStyle = { fontSize: 13, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 6 };
  const inputStyle = { width: '100%', padding: '8px 12px', borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: 13, outline: 'none', fontFamily: 'inherit' };
  const rowStyle = { display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 };
  const toggleStyle = (on) => ({
    position: 'relative', width: 40, height: 22, borderRadius: 99,
    background: on ? 'var(--color-primary, #4f46e5)' : '#cbd5e1',
    cursor: 'pointer', flexShrink: 0, transition: 'background 200ms', border: 'none',
  });
  const knobStyle = (on) => ({
    position: 'absolute', top: 3, left: on ? 20 : 3,
    width: 16, height: 16, borderRadius: '50%', background: 'white',
    transition: 'left 200ms', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
  });

  const Toggle = ({ value, onChange }) => (
    <button type="button" onClick={() => onChange(!value)} style={toggleStyle(value)} aria-checked={value} role="switch">
      <span style={knobStyle(value)} />
    </button>
  );

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">🤖 Auto-Crawl Settings</h2>
        <p className="section-subtitle">Configure the chatbot embed to auto-index your site's FAQs on page load</p>
      </div>

      {/* How it works */}
      <div style={{ ...cardStyle, background: 'linear-gradient(135deg, #eff6ff, #f0fdf4)', border: '1px solid #bfdbfe' }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: '#1e40af', marginBottom: 10 }}>💡 How Auto-Crawl works</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          {[
            { icon: '1️⃣', title: 'Embed fires', desc: 'When your page loads with the chatbot script, it silently calls your backend' },
            { icon: '2️⃣', title: 'Backend crawls', desc: 'Your server fetches the page HTML and extracts FAQ patterns' },
            { icon: '3️⃣', title: 'FAQs indexed', desc: 'Extracted Q&A pairs are saved to Supabase (or session-only)' },
            { icon: '4️⃣', title: 'TTL cache', desc: 'Won\'t re-crawl the same URL until the TTL window expires' },
          ].map(item => (
            <div key={item.icon} style={{ display: 'flex', gap: 8 }}>
              <span style={{ fontSize: 18, flexShrink: 0 }}>{item.icon}</span>
              <div>
                <p style={{ fontSize: 12, fontWeight: 700, color: '#1e40af' }}>{item.title}</p>
                <p style={{ fontSize: 12, color: '#3b82f6', lineHeight: 1.4 }}>{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Settings form */}
      <div style={cardStyle}>
        <p style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 20 }}>⚙️ Configuration</p>

        {/* Enable toggle */}
        <div style={rowStyle}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Enable Auto-Crawl</label>
            <p style={{ fontSize: 12, color: '#94a3b8' }}>When enabled, the embedded chatbot will crawl and index FAQs automatically on page load.</p>
          </div>
          <Toggle value={settings.enabled} onChange={v => set('enabled', v)} />
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid #f1f5f9', margin: '16px 0' }} />

        {/* URLs */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>URLs to crawl <span style={{ fontWeight: 400, color: '#94a3b8' }}>(one per line · leave blank to use current page)</span></label>
          <textarea
            value={settings.urls}
            onChange={e => set('urls', e.target.value)}
            placeholder={'https://yoursite.com/faq\nhttps://yoursite.com/help\nhttps://yoursite.com/shipping'}
            style={{ ...inputStyle, minHeight: 90, resize: 'vertical', lineHeight: 1.6 }}
          />
        </div>

        {/* Mode */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Save mode</label>
          <div style={{ display: 'flex', gap: 12 }}>
            {['append', 'replace'].map(m => (
              <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, fontWeight: settings.mode === m ? 700 : 400, color: settings.mode === m ? 'var(--color-primary, #4f46e5)' : '#64748b' }}>
                <input type="radio" name="acMode" value={m} checked={settings.mode === m} onChange={() => set('mode', m)} style={{ accentColor: 'var(--color-primary, #4f46e5)' }} />
                {m === 'append' ? '➕ Append (add to existing FAQs)' : '🔄 Replace (wipe & reload)'}
              </label>
            ))}
          </div>
        </div>

        {/* Save to DB toggle */}
        <div style={rowStyle}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Save to database</label>
            <p style={{ fontSize: 12, color: '#94a3b8' }}>ON = persist to Supabase permanently. OFF = session-only (FAQs lost on page reload).</p>
          </div>
          <Toggle value={settings.saveToDb} onChange={v => set('saveToDb', v)} />
        </div>

        {/* TTL */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Re-crawl interval (hours) <span style={{ fontWeight: 400, color: '#94a3b8' }}>· 0 = always re-crawl</span></label>
          <input type="number" min={0} max={720} value={settings.ttlHours} onChange={e => set('ttlHours', parseInt(e.target.value) || 0)} style={{ ...inputStyle, maxWidth: 120 }} />
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid #f1f5f9', margin: '16px 0' }} />

        {/* Deep links toggle */}
        <div style={rowStyle}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Deep link discovery</label>
            <p style={{ fontSize: 12, color: '#94a3b8' }}>Discover and crawl internal links found on each base URL (up to Max Pages).</p>
          </div>
          <Toggle value={settings.deepLinks} onChange={v => set('deepLinks', v)} />
        </div>

        {settings.deepLinks && (
          <>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Max pages per deep crawl</label>
              <input type="number" min={1} max={50} value={settings.maxPages} onChange={e => set('maxPages', parseInt(e.target.value) || 10)} style={{ ...inputStyle, maxWidth: 100 }} />
            </div>

            <div style={rowStyle}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Only crawl FAQ/help paths</label>
                <p style={{ fontSize: 12, color: '#94a3b8' }}>Only deep-crawl pages whose path matches <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: 4 }}>/faq|help|support/</code>.</p>
              </div>
              <Toggle value={settings.onlyFAQPaths} onChange={v => set('onlyFAQPaths', v)} />
            </div>
          </>
        )}

        <hr style={{ border: 'none', borderTop: '1px solid #f1f5f9', margin: '16px 0' }} />

        {/* Silent mode */}
        <div style={rowStyle}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Silent mode</label>
            <p style={{ fontSize: 12, color: '#94a3b8' }}>Suppress auto-crawl console logs in the browser. Recommended for production.</p>
          </div>
          <Toggle value={settings.silent} onChange={v => set('silent', v)} />
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button
            onClick={saveSettings}
            style={{ padding: '10px 20px', borderRadius: 10, background: saved ? '#10b981' : 'var(--color-primary, #4f46e5)', color: 'white', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer', transition: 'background 200ms' }}
          >
            {saved ? '✅ Saved!' : '💾 Save Settings'}
          </button>
        </div>
      </div>

      {/* Test crawl */}
      <div style={cardStyle}>
        <p style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>🧪 Test Auto-Crawl</p>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>Run a test crawl using your current settings to verify extraction before going live.</p>

        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <input
            type="url"
            placeholder="https://yoursite.com/faq (or leave blank to use URLs above)"
            value={testUrl}
            onChange={e => setTestUrl(e.target.value)}
            style={{ ...inputStyle, flex: 1, minWidth: 200 }}
          />
          <button
            onClick={runTest}
            disabled={testing}
            style={{ padding: '10px 20px', borderRadius: 10, background: testing ? '#94a3b8' : '#0f172a', color: 'white', fontWeight: 700, fontSize: 14, border: 'none', cursor: testing ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}
          >
            {testing ? '⏳ Testing...' : '▶ Run Test'}
          </button>
        </div>

        {testResult && (
          <div style={{ background: testResult.ok ? '#f0fdf4' : '#fef2f2', border: `1px solid ${testResult.ok ? '#bbf7d0' : '#fecaca'}`, borderRadius: 10, padding: 16 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: testResult.ok ? '#065f46' : '#991b1b', marginBottom: 8 }}>
              {testResult.ok ? `✅ Success! Extracted ${testResult.data.faqs?.length ?? 0} FAQs` : `❌ Failed: ${testResult.data.error}`}
            </p>
            {testResult.ok && testResult.data.faqs?.length > 0 && (
              <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                {testResult.data.faqs.slice(0, 5).map((faq, i) => (
                  <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid #d1fae5' }}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: '#065f46' }}>Q: {faq.question}</p>
                    <p style={{ fontSize: 11, color: '#047857', lineHeight: 1.4, marginTop: 2 }}>A: {faq.answer.slice(0, 120)}{faq.answer.length > 120 ? '…' : ''}</p>
                  </div>
                ))}
                {testResult.data.faqs.length > 5 && (
                  <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>…and {testResult.data.faqs.length - 5} more FAQs</p>
                )}
              </div>
            )}
            {testResult.data.saved && (
              <p style={{ fontSize: 12, color: '#065f46', marginTop: 8 }}>💾 Saved {testResult.data.added} FAQs to database (total: {testResult.data.total})</p>
            )}
          </div>
        )}
      </div>

      {/* Generated embed code */}
      <div style={cardStyle}>
        <p style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>📋 Your Embed Code</p>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>Copy this snippet and paste it before the closing <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: 4 }}>&lt;/body&gt;</code> tag on any page where you want the chatbot.</p>
        <div style={{ position: 'relative' }}>
          <pre style={{ background: '#0f172a', color: '#e2e8f0', padding: 20, borderRadius: 12, fontSize: 12, lineHeight: 1.7, overflowX: 'auto', margin: 0 }}>
            {embedCode}
          </pre>
          <button
            onClick={() => { navigator.clipboard?.writeText(embedCode); }}
            style={{ position: 'absolute', top: 10, right: 10, padding: '4px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.1)', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.2)', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
          >
            Copy
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Main AdminDashboard Component
// ============================================================
function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('analytics');

  useEffect(() => {
    window._adminSwitchTab = (tab) => setActiveTab(tab);
    return () => { delete window._adminSwitchTab; };
  }, []);

  const tabs = [
    { id: 'analytics', label: '📊 Analytics' },
    { id: 'faqs', label: '📚 FAQ Manager' },
    { id: 'crawler', label: '🌐 Web Crawler' },
    { id: 'autocrawl', label: '🤖 Auto-Crawl' },   // NEW
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
        {activeTab === 'faqs' && <FAQManagerTab />}
        {activeTab === 'crawler' && <WebCrawlerTab />}
        {activeTab === 'autocrawl' && <AutoCrawlTab />}
      </main>
    </div>
  );
}

export default AdminDashboard;