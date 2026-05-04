// ============================================================
// components/Chat/EscalationModal.jsx
// ============================================================

import React, { useState } from "react";
import { submitEscalation } from "../../utils/api";
import "../../styles/EscalationModal.css";

function EscalationModal({ onClose, conversationHistory }) {
  const [formData, setFormData] = useState({ name: "", email: "", issue: "" });
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [ticketId, setTicketId] = useState(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: "" }));
  };

  const validate = () => {
    const newErrors = {};
    if (!formData.name.trim()) newErrors.name = "Name is required.";
    if (!formData.email.trim()) newErrors.email = "Email is required.";
    else if (!/\S+@\S+\.\S+/.test(formData.email))
      newErrors.email = "Enter a valid email address.";
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
      setErrors({ submit: err.message || "Submission failed. Please try again." });
    } finally {
      setIsSubmitting(false);
    }
  };

  // ---- Success ----
  if (ticketId) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal__success">
            <span className="modal__success-icon">✅</span>
            <h2 className="modal__success-title">You're all set!</h2>
            <p className="modal__success-text">
              A human agent will reach out to <strong>{formData.email}</strong>{" "}
              within 24 hours. Your ticket ID is:
            </p>
            <div className="ticket-id">{ticketId}</div>
            <div style={{ marginTop: 24 }}>
              <button
                className="btn btn--primary"
                style={{ display: "inline-flex" }}
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---- Form ----
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div className="modal__header-icon">👤</div>
          <h2 className="modal__title">Talk to a Human</h2>
          <p className="modal__subtitle">Our team will contact you within 24 hours</p>
        </div>

        <div className="modal__body">
          {errors.submit && (
            <div className="alert alert--error">⚠️ {errors.submit}</div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <div className="form-group">
              <label className="form-label" htmlFor="esc-name">
                Full Name <span>*</span>
              </label>
              <input
                id="esc-name"
                className="form-input"
                type="text"
                name="name"
                placeholder="Jane Smith"
                value={formData.name}
                onChange={handleChange}
                autoComplete="name"
              />
              {errors.name && <p className="form-error">⚠ {errors.name}</p>}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="esc-email">
                Email Address <span>*</span>
              </label>
              <input
                id="esc-email"
                className="form-input"
                type="email"
                name="email"
                placeholder="jane@company.com"
                value={formData.email}
                onChange={handleChange}
                autoComplete="email"
              />
              {errors.email && <p className="form-error">⚠ {errors.email}</p>}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="esc-issue">
                Describe your issue
              </label>
              <textarea
                id="esc-issue"
                className="form-textarea"
                name="issue"
                placeholder="What can we help you with? The more detail, the better."
                value={formData.issue}
                onChange={handleChange}
                rows={3}
              />
            </div>

            <div className="modal__actions">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={onClose}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn--primary"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <div className="spinner" /> Submitting...
                  </>
                ) : (
                  <>📨 Submit Request</>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default EscalationModal;