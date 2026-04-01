
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchAnalytics,
  deleteFAQ,
  formatDateTime,
} from '../../utils/api';
import '../../styles/AdminDashboard.css';

// ============================================================
// Direct API calls (bypass api.js wrapper to debug easily)
// ============================================================
async function getAdminFAQs() {
  const res = await fetch('/api/admin/faqs');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  console.log('[AdminDashboard] /api/admin/faqs response:', data);
  // Handle all shapes: { faqs: [] } or plain array
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.faqs)) return data.faqs;
  return [];
}

async function uploadFAQsToServer(faqs) {
  const res = await fetch('/api/admin/faqs/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(faqs),
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

  const load = useCallback(async () => {
    try {
      const result = await fetchAnalytics();
      setData(result);
    } catch (err) {
      console.error('Analytics error:', err);
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

  const cards = [
    { icon: '💬', label: 'Total Queries',  value: data?.totalQueries ?? 0, colorClass: 'total',   percent: null },
    { icon: '📚', label: 'FAQ Answered',   value: data?.faqAnswered  ?? 0, colorClass: 'faq',     percent: data?.faqAnsweredPercent },
    { icon: '✨', label: 'AI Answered',    value: data?.aiAnswered   ?? 0, colorClass: 'ai',      percent: data?.aiAnsweredPercent },
    { icon: '👤', label: 'Escalations',    value: data?.escalations  ?? 0, colorClass: 'escalate',percent: data?.escalationRate },
  ];

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
            {card.percent !== null && (
              <div className="analytics-card__percent">{card.percent}% of total</div>
            )}
          </div>
        ))}
      </div>

      <div className="table-container">
        <div className="table-header">
          <span className="table-title">Recent Escalation Requests</span>
          <span className="table-count">{data?.escalationsList?.length ?? 0} total</span>
        </div>
        {!data?.escalationsList?.length ? (
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
              {data.escalationsList.map(e => (
                <tr key={e.id}>
                  <td><strong>{e.name}</strong></td>
                  <td>{e.email}</td>
                  <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.issue}</td>
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
  const [faqs, setFaqs]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [alert, setAlert]       = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef            = useRef(null);

  // Show alert banner and auto-clear after 4s
  const showAlert = useCallback((type, message) => {
    setAlert({ type, message });
    setTimeout(() => setAlert(null), 4000);
  }, []);

  // Fetch FAQs from backend
  const loadFAQs = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getAdminFAQs();
      console.log('[FAQManager] Loaded', list.length, 'FAQs');
      setFaqs(list);
    } catch (err) {
      console.error('[FAQManager] Load error:', err.message);
      showAlert('error', 'Failed to load FAQs: ' + err.message);
      setFaqs([]);
    } finally {
      setLoading(false);
    }
  }, [showAlert]);

  useEffect(() => { loadFAQs(); }, [loadFAQs]);

  // Handle JSON file upload
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const result = await uploadFAQsToServer(parsed);
      showAlert('success', result.message || 'FAQs uploaded successfully!');
      loadFAQs();
    } catch (err) {
      showAlert('error', 'Upload failed: ' + err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Handle delete
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
        <p className="section-subtitle">Upload a JSON file to update the knowledge base</p>
      </div>

      {alert && (
        <div className={`alert alert--${alert.type}`}>
          {alert.type === 'success' ? '✅' : '⚠️'} {alert.message}
        </div>
      )}

      {/* Upload Area */}
      <label className="upload-area" htmlFor="faq-upload">
        <span className="upload-area__icon">{uploading ? '⏳' : '📁'}</span>
        <p className="upload-area__title">
          {uploading ? 'Uploading...' : 'Click to upload FAQ JSON file'}
        </p>
        <p className="upload-area__hint">Accepts .json files · Max 5MB · Will replace current FAQ database</p>
        <input
          id="faq-upload"
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          onChange={handleFileUpload}
          disabled={uploading}
        />
      </label>

      {/* FAQ Table */}
      <div className="faq-table-wrap">
        <div className="table-header">
          <span className="table-title">Current FAQ Knowledge Base</span>
          <span className="table-count">{faqs.length} entries</span>
        </div>

        {loading ? (
          <div className="loading-wrap"><div className="loading-spinner" /> Loading FAQs from Supabase...</div>
        ) : faqs.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state__icon">📭</span>
            No FAQs found in Supabase. Upload a JSON file above to get started.
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
                            background: 'var(--color-bg-chat)',
                            padding: '1px 7px',
                            borderRadius: 'var(--radius-full)',
                            fontSize: 11,
                            color: 'var(--color-text-secondary)',
                            border: '1px solid var(--color-border)',
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
// Main AdminDashboard Component
// ============================================================
function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('analytics');

  const tabs = [
    { id: 'analytics', label: '📊 Analytics' },
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
        {activeTab === 'faqs'      && <FAQManagerTab />}
      </main>
    </div>
  );
}

export default AdminDashboard;