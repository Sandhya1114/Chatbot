import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from "react-router-dom";
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
// Web Crawler Tab
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
// Auto-Crawl Settings Tab
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

      <div style={cardStyle}>
        <p style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 20 }}>⚙️ Configuration</p>

        <div style={rowStyle}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Enable Auto-Crawl</label>
            <p style={{ fontSize: 12, color: '#94a3b8' }}>When enabled, the embedded chatbot will crawl and index FAQs automatically on page load.</p>
          </div>
          <Toggle value={settings.enabled} onChange={v => set('enabled', v)} />
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid #f1f5f9', margin: '16px 0' }} />

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>URLs to crawl <span style={{ fontWeight: 400, color: '#94a3b8' }}>(one per line · leave blank to use current page)</span></label>
          <textarea
            value={settings.urls}
            onChange={e => set('urls', e.target.value)}
            placeholder={'https://yoursite.com/faq\nhttps://yoursite.com/help\nhttps://yoursite.com/shipping'}
            style={{ ...inputStyle, minHeight: 90, resize: 'vertical', lineHeight: 1.6 }}
          />
        </div>

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

        <div style={rowStyle}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Save to database</label>
            <p style={{ fontSize: 12, color: '#94a3b8' }}>ON = persist to Supabase permanently. OFF = session-only (FAQs lost on page reload).</p>
          </div>
          <Toggle value={settings.saveToDb} onChange={v => set('saveToDb', v)} />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Re-crawl interval (hours) <span style={{ fontWeight: 400, color: '#94a3b8' }}>· 0 = always re-crawl</span></label>
          <input type="number" min={0} max={720} value={settings.ttlHours} onChange={e => set('ttlHours', parseInt(e.target.value) || 0)} style={{ ...inputStyle, maxWidth: 120 }} />
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid #f1f5f9', margin: '16px 0' }} />

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
          </div>
        )}
      </div>

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
// 🖼️ Image FAQ Extractor Tab  ← NEW
// Uses Claude Vision API to extract FAQs from screenshots/images
// ============================================================

const IMG_STEPS = {
  IDLE: 'idle',
  PROCESSING: 'processing',
  PREVIEW: 'preview',
  SAVING: 'saving',
  DONE: 'done',
};

function ImageExtractTab() {
  const [step, setStep] = useState(IMG_STEPS.IDLE);
  const [images, setImages] = useState([]); // [{ file, dataUrl, name }]
  const [extractedFAQs, setExtractedFAQs] = useState([]);
  const [selectedFAQIds, setSelectedFAQIds] = useState(new Set());
  const [saveMode, setSaveMode] = useState('append');
  const [error, setError] = useState(null);
  const [progressMsg, setProgressMsg] = useState('');
  const [savedCount, setSavedCount] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [editingFAQ, setEditingFAQ] = useState(null); // index of FAQ being edited
  const [editValues, setEditValues] = useState({});
  const fileInputRef = useRef(null);

  // ── helpers ──────────────────────────────────────────────
  const s = {
    card: {
      background: 'white', borderRadius: 16, border: '1px solid #e2e8f0',
      boxShadow: '0 1px 3px rgba(0,0,0,0.05)', padding: 24, marginBottom: 20,
    },
    btnPrimary: {
      padding: '10px 22px', borderRadius: 10, background: 'var(--color-primary, #4f46e5)',
      color: 'white', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
    },
    btnSecondary: {
      padding: '10px 18px', borderRadius: 10, background: '#f1f5f9', color: '#475569',
      fontWeight: 600, fontSize: 14, border: '1px solid #e2e8f0', cursor: 'pointer',
      whiteSpace: 'nowrap',
    },
    spinner: {
      width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.4)',
      borderTopColor: 'white', animation: 'spin 0.7s linear infinite', display: 'inline-block',
    },
    kwTag: {
      display: 'inline-block', padding: '2px 8px', borderRadius: 99,
      background: '#e0e7ff', color: '#4f46e5', fontSize: 11, marginRight: 4, marginTop: 4,
    },
    checkbox: (checked) => ({
      width: 18, height: 18, borderRadius: 4, flexShrink: 0,
      border: `2px solid ${checked ? 'var(--color-primary, #4f46e5)' : '#d1d5db'}`,
      background: checked ? 'var(--color-primary, #4f46e5)' : 'white',
      display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 150ms',
    }),
  };

  const CheckIcon = () => (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
      <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  // ── file reading ─────────────────────────────────────────
  const readFileAsBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result); // full data URL
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const addFiles = async (fileList) => {
    const valid = Array.from(fileList).filter(f => f.type.startsWith('image/'));
    if (valid.length === 0) { setError('Please upload image files (PNG, JPG, GIF, WebP).'); return; }
    setError(null);
    const loaded = await Promise.all(
      valid.map(async (file) => ({
        file,
        name: file.name,
        dataUrl: await readFileAsBase64(file),
      }))
    );
    setImages(prev => [...prev, ...loaded]);
  };

  const handleFileChange = (e) => { if (e.target.files?.length) addFiles(e.target.files); };
  const handleDrop = (e) => {
    e.preventDefault(); setIsDragOver(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };
  const removeImage = (idx) => setImages(prev => prev.filter((_, i) => i !== idx));

  // ── Claude Vision extraction ─────────────────────────────
  const extractFAQsFromImages = async () => {
    if (images.length === 0) { setError('Please add at least one image.'); return; }
    setError(null);
    setStep(IMG_STEPS.PROCESSING);

    const allFAQs = [];
    const seen = new Set();

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      setProgressMsg(`Analysing image ${i + 1} of ${images.length}: ${img.name}…`);

      try {
        // Convert data URL to base64 only (strip the "data:image/xxx;base64," prefix)
        const [header, base64Data] = img.dataUrl.split(',');
        const mediaType = header.match(/data:(.*);base64/)?.[1] || 'image/png';

        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1000,
            system: `You are an expert at extracting FAQ content from images and screenshots.
Your job is to identify every question-and-answer pair visible in the image.
Respond ONLY with a valid JSON array — no preamble, no markdown fences, no extra text.
Each element must have exactly these fields:
  "question"  – the full question text (string)
  "answer"    – the complete answer text (string)
  "keywords"  – 3-6 relevant lowercase keywords derived from the Q&A (array of strings)

If the image contains no FAQ content, return an empty array: []
Never include anything outside the JSON array.`,
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'image',
                    source: { type: 'base64', media_type: mediaType, data: base64Data },
                  },
                  {
                    type: 'text',
                    text: 'Extract all FAQ question-and-answer pairs from this image as a JSON array.',
                  },
                ],
              },
            ],
          }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData?.error?.message || `API error ${response.status}`);
        }

        const data = await response.json();
        const rawText = data.content?.find(b => b.type === 'text')?.text?.trim() || '[]';

        // Strip markdown fences if model adds them despite instructions
        const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        let parsed;
        try { parsed = JSON.parse(cleaned); } catch { parsed = []; }

        if (!Array.isArray(parsed)) parsed = [];

        for (const faq of parsed) {
          if (!faq.question || !faq.answer) continue;
          const key = faq.question.toLowerCase().slice(0, 80);
          if (!seen.has(key)) {
            seen.add(key);
            allFAQs.push({ ...faq, _source: img.name, keywords: faq.keywords || [] });
          }
        }
      } catch (err) {
        // Show error but continue with other images
        setError(`Error on "${img.name}": ${err.message}`);
      }
    }

    setProgressMsg('');

    if (allFAQs.length === 0) {
      setError('No FAQ content was found in the uploaded images. Make sure the images contain visible question-and-answer pairs.');
      setStep(IMG_STEPS.IDLE);
      return;
    }

    setExtractedFAQs(allFAQs);
    setSelectedFAQIds(new Set(allFAQs.map((_, i) => i)));
    setStep(IMG_STEPS.PREVIEW);
  };

  // ── inline editing ───────────────────────────────────────
  const startEdit = (idx, faq) => {
    setEditingFAQ(idx);
    setEditValues({ question: faq.question, answer: faq.answer, keywords: (faq.keywords || []).join(', ') });
  };
  const cancelEdit = () => { setEditingFAQ(null); setEditValues({}); };
  const saveEdit = (idx) => {
    setExtractedFAQs(prev => prev.map((faq, i) => i !== idx ? faq : {
      ...faq,
      question: editValues.question,
      answer: editValues.answer,
      keywords: editValues.keywords.split(',').map(k => k.trim()).filter(Boolean),
    }));
    cancelEdit();
  };
  const deleteExtracted = (idx) => {
    setExtractedFAQs(prev => prev.filter((_, i) => i !== idx));
    setSelectedFAQIds(prev => { const n = new Set(prev); n.delete(idx); return new Set([...n].map(id => id > idx ? id - 1 : id)); });
  };

  // ── selection helpers ────────────────────────────────────
  const toggleFAQ = (idx) => setSelectedFAQIds(prev => {
    const n = new Set(prev); n.has(idx) ? n.delete(idx) : n.add(idx); return n;
  });
  const selectAll = () => setSelectedFAQIds(new Set(extractedFAQs.map((_, i) => i)));
  const deselectAll = () => setSelectedFAQIds(new Set());

  // ── save to Supabase ─────────────────────────────────────
  const handleSave = async () => {
    const toSave = extractedFAQs.filter((_, i) => selectedFAQIds.has(i));
    if (toSave.length === 0) { setError('Select at least one FAQ to save.'); return; }
    setError(null);
    setStep(IMG_STEPS.SAVING);
    try {
      const result = await uploadFAQsToServer(toSave, saveMode === 'replace');
      setSavedCount(result.added ?? toSave.length);
      setStep(IMG_STEPS.DONE);
    } catch (err) {
      setError('Save failed: ' + err.message);
      setStep(IMG_STEPS.PREVIEW);
    }
  };

  // ── reset ────────────────────────────────────────────────
  const handleReset = () => {
    setStep(IMG_STEPS.IDLE);
    setImages([]);
    setExtractedFAQs([]);
    setSelectedFAQIds(new Set());
    setError(null);
    setProgressMsg('');
    setSavedCount(0);
    setEditingFAQ(null);
    setEditValues({});
  };

  // ────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div className="section-header">
        <h2 className="section-title">🖼️ Image FAQ Extractor</h2>
        <p className="section-subtitle">
          Upload screenshots or photos of FAQ pages · Claude Vision extracts every Q&amp;A pair · Review &amp; save to your knowledge base
        </p>
      </div>

      {error && (
        <div className="alert alert--error" style={{ marginBottom: 16 }}>
          ⚠️ {error}
        </div>
      )}

      {/* ── IDLE / Upload step ── */}
      {(step === IMG_STEPS.IDLE) && (
        <>
          {/* How it works banner */}
          <div style={{
            ...s.card,
            background: 'linear-gradient(135deg, #faf5ff, #eff6ff)',
            border: '1px solid #ddd6fe',
            padding: '18px 24px',
          }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#5b21b6', marginBottom: 10 }}>
              ✨ How Image Extraction works
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              {[
                { icon: '1️⃣', title: 'Upload images', desc: 'Add PNG, JPG, WebP, or GIF screenshots of any FAQ page' },
                { icon: '2️⃣', title: 'Claude reads them', desc: 'Claude Vision scans every visible Q&A pair, accordion, table, and list' },
                { icon: '3️⃣', title: 'Review & edit', desc: 'Inspect extracted FAQs, fix mistakes, or remove irrelevant entries' },
                { icon: '4️⃣', title: 'Save to chatbot', desc: 'Selected FAQs are saved to Supabase and immediately active in your chatbot' },
              ].map(item => (
                <div key={item.icon} style={{ display: 'flex', gap: 8 }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{item.icon}</span>
                  <div>
                    <p style={{ fontSize: 12, fontWeight: 700, color: '#5b21b6' }}>{item.title}</p>
                    <p style={{ fontSize: 12, color: '#7c3aed', lineHeight: 1.4 }}>{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${isDragOver ? '#7c3aed' : '#c4b5fd'}`,
              borderRadius: 16,
              padding: '40px 24px',
              textAlign: 'center',
              cursor: 'pointer',
              background: isDragOver ? '#faf5ff' : '#fdfbff',
              transition: 'all 200ms',
              marginBottom: 20,
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <div style={{ fontSize: 40, marginBottom: 10 }}>🖼️</div>
            <p style={{ fontSize: 15, fontWeight: 700, color: '#4c1d95', marginBottom: 4 }}>
              {isDragOver ? 'Drop images here!' : 'Click or drag & drop images here'}
            </p>
            <p style={{ fontSize: 13, color: '#7c3aed' }}>
              Supports PNG, JPG, WebP, GIF · Multiple files allowed
            </p>
          </div>

          {/* Thumbnail preview of added images */}
          {images.length > 0 && (
            <div style={s.card}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <p style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                  {images.length} image{images.length !== 1 ? 's' : ''} ready
                </p>
                <button style={{ ...s.btnSecondary, padding: '5px 12px', fontSize: 12 }} onClick={() => fileInputRef.current?.click()}>
                  + Add more
                </button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {images.map((img, idx) => (
                  <div key={idx} style={{ position: 'relative', width: 100 }}>
                    <img
                      src={img.dataUrl}
                      alt={img.name}
                      style={{
                        width: 100, height: 80, objectFit: 'cover',
                        borderRadius: 10, border: '2px solid #e0e7ff', display: 'block',
                      }}
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); removeImage(idx); }}
                      style={{
                        position: 'absolute', top: -6, right: -6,
                        width: 20, height: 20, borderRadius: '50%',
                        background: '#ef4444', color: 'white',
                        border: 'none', cursor: 'pointer', fontSize: 12,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 700, lineHeight: 1,
                      }}
                    >×</button>
                    <p style={{
                      fontSize: 10, color: '#64748b', marginTop: 4,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      maxWidth: 100,
                    }}>{img.name}</p>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  style={{ ...s.btnPrimary, background: '#7c3aed' }}
                  onClick={extractFAQsFromImages}
                >
                  ✨ Extract FAQs from {images.length} image{images.length !== 1 ? 's' : ''}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── PROCESSING step ── */}
      {step === IMG_STEPS.PROCESSING && (
        <div style={{ ...s.card, textAlign: 'center', padding: '56px 24px' }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>
            <span style={{ display: 'inline-block', animation: 'spin 2s linear infinite' }}>🔍</span>
          </div>
          <p style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
            Claude is reading your images…
          </p>
          <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
            {progressMsg || 'Analysing FAQ content…'}
          </p>
          <div style={{ background: '#e2e8f0', borderRadius: 99, height: 6, maxWidth: 320, margin: '0 auto' }}>
            <div style={{
              background: '#7c3aed', borderRadius: 99, height: '100%',
              width: '60%',
              animation: 'indeterminate 1.5s ease-in-out infinite',
            }} />
          </div>
          <style>{`
            @keyframes indeterminate {
              0%   { width: 10%; margin-left: 0%; }
              50%  { width: 50%; margin-left: 30%; }
              100% { width: 10%; margin-left: 90%; }
            }
            @keyframes spin { to { transform: rotate(360deg); } }
          `}</style>
        </div>
      )}

      {/* ── PREVIEW / SAVING step ── */}
      {(step === IMG_STEPS.PREVIEW || step === IMG_STEPS.SAVING) && (
        <div>
          {/* Summary bar */}
          <div style={{ ...s.card, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 20 }}>🖼️</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 2 }}>
                Scanned {images.length} image{images.length !== 1 ? 's' : ''}
              </p>
              <p style={{ fontSize: 12, color: '#64748b' }}>
                Found <strong>{extractedFAQs.length}</strong> FAQ{extractedFAQs.length !== 1 ? 's' : ''} ·{' '}
                <strong style={{ color: '#7c3aed' }}>{selectedFAQIds.size}</strong> selected to save
              </p>
            </div>
            <button style={s.btnSecondary} onClick={handleReset}>← New images</button>
          </div>

          {/* Save mode + action bar */}
          <div style={{ ...s.card, padding: '14px 18px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>Save mode:</span>
            {['append', 'replace'].map(m => (
              <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, fontWeight: saveMode === m ? 700 : 400, color: saveMode === m ? '#7c3aed' : '#64748b' }}>
                <input type="radio" name="imgSaveMode" value={m} checked={saveMode === m} onChange={() => setSaveMode(m)} style={{ accentColor: '#7c3aed' }} />
                {m === 'append' ? '➕ Append' : '🔄 Replace all'}
              </label>
            ))}
            <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
              <button style={{ ...s.btnSecondary, padding: '6px 12px', fontSize: 12 }} onClick={selectAll}>✅ All</button>
              <button style={{ ...s.btnSecondary, padding: '6px 12px', fontSize: 12 }} onClick={deselectAll}>☐ None</button>
              <button
                style={{
                  ...s.btnPrimary,
                  background: '#7c3aed',
                  opacity: step === IMG_STEPS.SAVING || selectedFAQIds.size === 0 ? 0.7 : 1,
                  cursor: step === IMG_STEPS.SAVING || selectedFAQIds.size === 0 ? 'not-allowed' : 'pointer',
                }}
                onClick={handleSave}
                disabled={step === IMG_STEPS.SAVING || selectedFAQIds.size === 0}
              >
                {step === IMG_STEPS.SAVING
                  ? <><span style={s.spinner} /> Saving…</>
                  : `💾 Save ${selectedFAQIds.size} FAQ${selectedFAQIds.size !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>

          {/* FAQ list */}
          <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                Extracted FAQs — Click to select · ✏️ to edit
              </span>
              <span style={{ fontSize: 12, padding: '2px 10px', background: '#f5f3ff', borderRadius: 99, color: '#7c3aed', fontWeight: 600 }}>
                {extractedFAQs.length} found
              </span>
            </div>

            {extractedFAQs.map((faq, idx) => {
              const checked = selectedFAQIds.has(idx);
              const isEditing = editingFAQ === idx;

              return (
                <div
                  key={idx}
                  style={{
                    borderBottom: '1px solid #f1f5f9',
                    background: isEditing ? '#faf5ff' : checked ? '#fafbff' : 'white',
                  }}
                >
                  {isEditing ? (
                    /* ── Edit mode ── */
                    <div style={{ padding: '14px 16px' }}>
                      <p style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        ✏️ Editing FAQ #{idx + 1}
                      </p>
                      <div style={{ marginBottom: 8 }}>
                        <label style={{ fontSize: 11, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 3 }}>Question</label>
                        <input
                          value={editValues.question}
                          onChange={e => setEditValues(v => ({ ...v, question: e.target.value }))}
                          style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1.5px solid #c4b5fd', fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                        />
                      </div>
                      <div style={{ marginBottom: 8 }}>
                        <label style={{ fontSize: 11, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 3 }}>Answer</label>
                        <textarea
                          value={editValues.answer}
                          onChange={e => setEditValues(v => ({ ...v, answer: e.target.value }))}
                          style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1.5px solid #c4b5fd', fontSize: 13, outline: 'none', fontFamily: 'inherit', minHeight: 80, resize: 'vertical', boxSizing: 'border-box' }}
                        />
                      </div>
                      <div style={{ marginBottom: 12 }}>
                        <label style={{ fontSize: 11, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 3 }}>Keywords <span style={{ fontWeight: 400, color: '#94a3b8' }}>(comma-separated)</span></label>
                        <input
                          value={editValues.keywords}
                          onChange={e => setEditValues(v => ({ ...v, keywords: e.target.value }))}
                          style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1.5px solid #c4b5fd', fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => saveEdit(idx)} style={{ ...s.btnPrimary, background: '#7c3aed', padding: '7px 16px', fontSize: 13 }}>✓ Save</button>
                        <button onClick={cancelEdit} style={{ ...s.btnSecondary, padding: '7px 14px', fontSize: 13 }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    /* ── View mode ── */
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px' }}>
                      <div
                        style={{ ...s.checkbox(checked), marginTop: 2, cursor: 'pointer' }}
                        onClick={() => toggleFAQ(idx)}
                      >
                        {checked && <CheckIcon />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => toggleFAQ(idx)}>
                        {faq._source && (
                          <p style={{ fontSize: 10, color: '#a78bfa', marginBottom: 3 }}>
                            📄 from {faq._source}
                          </p>
                        )}
                        <p style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>
                          Q: {faq.question}
                        </p>
                        <p style={{
                          fontSize: 12, color: '#64748b', lineHeight: 1.5, marginBottom: 6,
                          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                        }}>
                          A: {faq.answer}
                        </p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {(faq.keywords || []).slice(0, 6).map(kw => (
                            <span key={kw} style={s.kwTag}>{kw}</span>
                          ))}
                        </div>
                      </div>
                      {/* Action buttons */}
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); startEdit(idx, faq); }}
                          title="Edit this FAQ"
                          style={{
                            padding: '4px 10px', borderRadius: 8, border: '1px solid #ddd6fe',
                            background: '#f5f3ff', color: '#7c3aed', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                          }}
                        >
                          ✏️
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteExtracted(idx); }}
                          title="Remove this FAQ"
                          style={{
                            padding: '4px 10px', borderRadius: 8, border: '1px solid #fecaca',
                            background: '#fef2f2', color: '#ef4444', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── DONE step ── */}
      {step === IMG_STEPS.DONE && (
        <div style={{ ...s.card, textAlign: 'center', padding: '56px 24px' }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>🎉</div>
          <h3 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>
            FAQs saved successfully!
          </h3>
          <p style={{ fontSize: 15, color: '#64748b', marginBottom: 6 }}>
            <strong>{savedCount}</strong> FAQ{savedCount !== 1 ? 's' : ''} extracted from your images are now live in your chatbot's knowledge base.
          </p>
          <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 28 }}>
            Your chatbot will use these answers automatically on the next query.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button style={{ ...s.btnPrimary, background: '#7c3aed' }} onClick={handleReset}>
              🖼️ Extract from more images
            </button>
            <button style={s.btnSecondary} onClick={() => window._adminSwitchTab && window._adminSwitchTab('faqs')}>
              📚 View FAQ Manager
            </button>
          </div>
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
  const navigate = useNavigate();

  useEffect(() => {
    window._adminSwitchTab = (tab) => setActiveTab(tab);
    return () => { delete window._adminSwitchTab; };
  }, []);

  const tabs = [
    { id: 'analytics', label: '📊 Analytics' },
    { id: 'faqs', label: '📚 FAQ Manager' },
    { id: 'crawler', label: '🌐 Web Crawler' },
    { id: 'autocrawl', label: '🤖 Auto-Crawl' },
    { id: 'imageextract', label: '🖼️ Image Extractor' },  // NEW
  ];

  return (
    <div className="admin-page">
      <nav className="admin-nav">
        <div className="admin-nav__brand" onClick={() => navigate("/")} style={{ cursor: "pointer" }}>
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
        {activeTab === 'imageextract' && <ImageExtractTab />}
      </main>
    </div>
  );
}

export default AdminDashboard;