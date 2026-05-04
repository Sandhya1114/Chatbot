import React, { useEffect, useState } from 'react';
import ChatWidget from './components/Chat/ChatWidget';
import AdminDashboard from './components/Admin/AdminDashboard';
import './styles/global.css';

function isAdminRoute() {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  return pathname === '/admin' || window.location.hash === '#/admin';
}

function App() {
  const [isAdmin, setIsAdmin] = useState(isAdminRoute());

  useEffect(() => {
    const syncRoute = () => {
      setIsAdmin(isAdminRoute());
    };

    window.addEventListener('hashchange', syncRoute);
    window.addEventListener('popstate', syncRoute);

    return () => {
      window.removeEventListener('hashchange', syncRoute);
      window.removeEventListener('popstate', syncRoute);
    };
  }, []);

  if (isAdmin) {
    return <AdminDashboard />;
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      <DemoHomePage />
      <ChatWidget />
    </div>
  );
}

function DemoHomePage() {
  return (
    <div style={{ fontFamily: 'var(--font-family)' }}>
      <header
        style={{
          background: 'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)',
          color: 'white',
          padding: '80px 40px',
          textAlign: 'center',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>AI</div>
          <h1
            style={{
              fontSize: 'clamp(28px, 5vw, 52px)',
              fontWeight: 800,
              marginBottom: 16,
              letterSpacing: '-0.03em',
            }}
          >
            Acme SaaS Platform
          </h1>
          <p style={{ fontSize: 18, opacity: 0.85, maxWidth: 500, margin: '0 auto 32px' }}>
            The all-in-one tool your team needs to work smarter, not harder.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              style={{
                background: 'white',
                color: '#4f46e5',
                padding: '12px 28px',
                borderRadius: 999,
                fontWeight: 700,
                fontSize: 15,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Start Free Trial
            </button>
            <a
              href="/admin"
              style={{
                background: 'rgba(255,255,255,0.15)',
                color: 'white',
                padding: '12px 28px',
                borderRadius: 999,
                fontWeight: 600,
                fontSize: 15,
                border: '2px solid rgba(255,255,255,0.3)',
                textDecoration: 'none',
                display: 'inline-block',
              }}
            >
              Admin Panel
            </a>
          </div>
        </div>
      </header>

      <section style={{ padding: '80px 40px', maxWidth: 1000, margin: '0 auto' }}>
        <h2
          style={{
            textAlign: 'center',
            fontSize: 32,
            fontWeight: 700,
            marginBottom: 48,
            color: '#0f172a',
            letterSpacing: '-0.02em',
          }}
        >
          Everything you need
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 24,
          }}
        >
          {[
            { icon: 'Fast', title: 'Lightning Fast', desc: 'Optimized for performance with 99.9% uptime SLA.' },
            { icon: 'Safe', title: 'Secure by Default', desc: 'Enterprise-grade encryption and GDPR compliance.' },
            { icon: 'Data', title: 'Deep Analytics', desc: 'Real-time insights into your team productivity.' },
            { icon: 'Apps', title: '50+ Integrations', desc: 'Works with Slack, Jira, Salesforce, and more.' },
            { icon: 'Mobile', title: 'Mobile Ready', desc: 'Native apps for iOS and Android.' },
            { icon: 'Help', title: '24/7 Support', desc: 'AI-powered chat with human escalation.' },
          ].map((feature) => (
            <div
              key={feature.title}
              style={{
                background: 'white',
                borderRadius: 16,
                padding: '28px 24px',
                border: '1px solid #e2e8f0',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12, color: '#4f46e5' }}>
                {feature.icon}
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, color: '#0f172a' }}>
                {feature.title}
              </h3>
              <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.6 }}>{feature.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section
        style={{
          background: '#f1f5f9',
          padding: '48px 40px',
          textAlign: 'center',
          borderTop: '1px solid #e2e8f0',
        }}
      >
        <p style={{ fontSize: 18, color: '#475569', marginBottom: 8 }}>
          Have questions? Try the chatbot in the bottom-right corner.
        </p>
        <p style={{ fontSize: 13, color: '#94a3b8' }}>
          Powered by AI · FAQ answers · human escalation
        </p>
      </section>
    </div>
  );
}

export default App;
