import React, { Component } from 'react';
import { useTranslation } from 'react-i18next';
import './LazyChunkErrorBoundary.css';

/**
 * Centered, theme-aware spinner fallback for lazy-loaded modals.
 */
export function ModalLoadingFallback() {
  return (
    <div className="create-group-overlay qc-lazy-fallback-overlay" role="presentation">
      <div className="qc-lazy-modal-card" role="status" aria-live="polite">
        <div className="qc-lazy-spinner" aria-label="Loading..." />
      </div>
    </div>
  );
}

/**
 * Centered spinner fallback for side panels (e.g. AIAssistantPanel).
 */
export function PanelLoadingFallback() {
  return (
    <div className="quantum-ai-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="qc-lazy-spinner" aria-label="Loading..." />
    </div>
  );
}

function ErrorCardUI({ error, retryCount, onRetry, onClose }) {
  const { t } = useTranslation();

  return (
    <div className="create-group-overlay qc-lazy-fallback-overlay" role="presentation" onClick={onClose}>
      <div className="qc-lazy-error-card" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <svg
          className="qc-lazy-error-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>

        <h3 className="qc-lazy-error-title">
          {t('lazy.loadFailed', 'Failed to load component')}
        </h3>
        <p className="qc-lazy-error-desc">
          {t('lazy.loadFailedDesc', 'A network error occurred or a new version is available.')}
        </p>

        <div className="qc-lazy-error-actions">
          <button type="button" className="qc-lazy-btn-primary" onClick={onRetry}>
            {t('lazy.retry', 'Retry')}
          </button>
          {retryCount >= 1 && (
            <button
              type="button"
              className="qc-lazy-btn-secondary"
              onClick={() => window.location.reload()}
            >
              {t('lazy.reloadPage', 'Reload page')}
            </button>
          )}
          {typeof onClose === 'function' && (
            <button type="button" className="qc-lazy-btn-secondary" onClick={onClose}>
              {t('common.close', 'Close')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export class LazyChunkErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, retryCount: 0 };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[LazyChunkErrorBoundary] Caught lazy chunk error:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState((prev) => ({
      hasError: false,
      error: null,
      retryCount: prev.retryCount + 1,
    }));
  };

  render() {
    if (this.state.hasError) {
      if (typeof this.props.fallback === 'function') {
        return this.props.fallback({
          error: this.state.error,
          retry: this.handleRetry,
          retryCount: this.state.retryCount,
        });
      }

      return (
        <ErrorCardUI
          error={this.state.error}
          retryCount={this.state.retryCount}
          onRetry={this.handleRetry}
          onClose={this.props.onClose}
        />
      );
    }

    return this.props.children;
  }
}

export default LazyChunkErrorBoundary;
