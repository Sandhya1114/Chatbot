import React, { useState } from 'react';
import { submitEscalation } from '../../utils/api';
import '../../styles/EscalationModal.css';

const SUPPORT_PHONE = process.env.REACT_APP_SUPPORT_PHONE || '+1-800-000-0000';
const SUPPORT_HOURS = 'Mon–Fri, 9am–6pm';

function EscalationModal({ onClose, conversationHistory }) {
  const [mode, setMode] = useState('choose');         // 'choose' | 'form'
  const [formData, setFormData] = useState({ name: '', email: '', issue: '' });
  const [errors, setErrors]     = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [ticketId, setTicketId] = useState(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }));
  };

  const validate = () => {
    const newErrors = {};
    if (!formData.name.trim()) newErrors.name = 'Name is required.';
    if (!formData.email.trim()) newErrors.email = 'Email is required.';
    else if (!/\S+@\S+\.\S+/.test(formData.email)) newErrors.email = 'Enter a valid email address.';
    return newErrors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await submitEscalation({ ...formData, conversationHistory });
      setTicketId(result.ticketId);
    } catch (err) {
      setErrors({ submit: err.message || 'Submission failed. Please try again.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // ---- Success Screen ----
  if (ticketId) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={e => e.stopPropagation()}>
          <div className="modal__success">
            <span className="modal__success-icon">✅</span>
            <h2 className="modal__success-title">You're all set!</h2>
            <p className="modal__success-text">
              A human agent will reach out to <strong>{formData.email}</strong> within 24 hours.
              Your ticket ID is:
            </p>
            <div className="ticket-id">{ticketId}</div>
            <button className="btn btn--primary" style={{ marginTop: 24, display: 'inline-flex' }} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Choose Screen ----
  if (mode === 'choose') {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={e => e.stopPropagation()}>

          <div className="modal__header">
            <div className="modal__header-icon">👤</div>
            <h2 className="modal__title">Talk to a Human</h2>
            <p className="modal__subtitle">Choose how you'd like to connect</p>
          </div>

          <div className="modal__body">
            <div className="contact-options">

              {/* ── Call Us ── */}
              <div className="contact-card">
                <div className="contact-card__icon">📞</div>
                <div className="contact-card__body">
                  <p className="contact-card__label">Call us directly</p>
                  <p className="contact-card__hours">{SUPPORT_HOURS}</p>
                  
                    <a className="btn btn--primary contact-card__action"
                    href={`tel:${SUPPORT_PHONE.replace(/[^+\d]/g, '')}`}
                  >
                    {SUPPORT_PHONE}
                  </a>
                </div>
              </div>

              <div className="contact-divider">
                <span>or</span>
              </div>

              {/* ── Leave a ticket ── */}
              <div className="contact-card">
                <div className="contact-card__icon">✉️</div>
                <div className="contact-card__body">
                  <p className="contact-card__label">Leave your details</p>
                  <p className="contact-card__hours">We'll email you within 24 hours</p>
                  <button
                    className="btn btn--secondary contact-card__action"
                    onClick={() => setMode('form')}
                  >
                    Submit a ticket →
                  </button>
                </div>
              </div>

            </div>

            <div className="modal__actions" style={{ marginTop: 16 }}>
              <button className="btn btn--secondary" onClick={onClose}>Cancel</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---- Form Screen ----
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>

        <div className="modal__header">
          <button className="modal__back" onClick={() => setMode('choose')}>← Back</button>
          <div className="modal__header-icon">✉️</div>
          <h2 className="modal__title">Submit a Ticket</h2>
          <p className="modal__subtitle">We'll contact you within 24 hours</p>
        </div>

        <div className="modal__body">
          {errors.submit && <div className="alert alert--error">⚠️ {errors.submit}</div>}

          <form onSubmit={handleSubmit} noValidate>
            <div className="form-group">
              <label className="form-label" htmlFor="esc-name">Full Name <span>*</span></label>
              <input id="esc-name" className="form-input" type="text" name="name"
                placeholder="Jane Smith" value={formData.name} onChange={handleChange} autoComplete="name" />
              {errors.name && <p className="form-error">⚠ {errors.name}</p>}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="esc-email">Email Address <span>*</span></label>
              <input id="esc-email" className="form-input" type="email" name="email"
                placeholder="jane@company.com" value={formData.email} onChange={handleChange} autoComplete="email" />
              {errors.email && <p className="form-error">⚠ {errors.email}</p>}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="esc-issue">Describe your issue</label>
              <textarea id="esc-issue" className="form-textarea" name="issue"
                placeholder="What can we help you with?" value={formData.issue}
                onChange={handleChange} rows={3} />
            </div>

            <div className="modal__actions">
              <button type="button" className="btn btn--secondary"
                onClick={() => setMode('choose')} disabled={isSubmitting}>Back</button>
              <button type="submit" className="btn btn--primary" disabled={isSubmitting}>
                {isSubmitting ? <><div className="spinner" /> Submitting...</> : <>📨 Submit Request</>}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default EscalationModal;