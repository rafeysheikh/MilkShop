import React, { useState, useEffect, useRef } from 'react';

// ─── Keyframe animations injected once ───────────────────────────────────────
const STYLES_ID = 'license-gate-styles';
if (typeof document !== 'undefined' && !document.getElementById(STYLES_ID)) {
  const el = document.createElement('style');
  el.id = STYLES_ID;
  el.textContent = `
    @keyframes lg-spin { to { transform: rotate(360deg); } }
    @keyframes lg-fadeIn { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes lg-pulse { 0%,100% { opacity:1; } 50% { opacity:0.6; } }
    @keyframes lg-shimmer {
      0% { background-position: -400px 0; }
      100% { background-position: 400px 0; }
    }
    .lg-input:focus {
      border-color: rgba(217,164,65,0.6) !important;
      box-shadow: 0 0 0 3px rgba(217,164,65,0.12) !important;
      outline: none;
    }
    .lg-btn-activate:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 8px 24px rgba(217,164,65,0.45) !important;
    }
    .lg-btn-copy:hover { background: rgba(217,164,65,0.2) !important; }
    .lg-card { animation: lg-fadeIn 0.5s ease forwards; }
  `;
  document.head.appendChild(el);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LicenseGate({ children }) {
  const [status, setStatus]           = useState('checking'); // checking | valid | expired | trial-expired
  const [isTrial, setIsTrial]         = useState(false);
  const [trialDaysLeft, setTrialDaysLeft] = useState(7);
  const [showModal, setShowModal]     = useState(false);
  const [machineId, setMachineId]     = useState('');
  const [licenseKey, setLicenseKey]   = useState('');
  const [error, setError]             = useState('');
  const [licenseInfo, setLicenseInfo] = useState(null);
  const [loading, setLoading]         = useState(false);
  const [copied, setCopied]           = useState(false);
  const [warning, setWarning]         = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    checkLicense();

    // Check periodically every 15 minutes while app is running
    const interval = setInterval(() => {
      checkLicense();
    }, 15 * 60 * 1000);

    // Re-check immediately whenever window gains focus
    const onFocus = () => checkLicense();
    window.addEventListener('focus', onFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  async function checkLicense() {
    // Dev mode (no Electron) — demonstrate 7-day trial banner
    if (!window.electronAPI) {
      setMachineId('DEMO-7A8B-9C0D-1E2F');
      setIsTrial(true);
      setTrialDaysLeft(7);
      setStatus('valid');
      return;
    }

    const mid = await window.electronAPI.getMachineId();
    setMachineId(mid);

    const result = await window.electronAPI.checkSavedLicense();
    if (result.valid) {
      setLicenseInfo(result);
      setIsTrial(!!result.isTrial);
      setTrialDaysLeft(result.trialDaysLeft || 0);
      if (!result.isTrial && result.daysLeft <= 30) {
        setWarning(`License expires in ${result.daysLeft} day${result.daysLeft === 1 ? '' : 's'}. Contact your provider to renew.`);
      }
      setStatus('valid');
    } else if (result.trialExpired) {
      setLicenseInfo(result);
      setIsTrial(true);
      setStatus('trial-expired');
    } else if (result.expired) {
      setLicenseInfo(result);
      setIsTrial(false);
      setStatus('expired');
    } else {
      setStatus('trial-expired');
    }
  }

  async function handleActivate() {
    setError('');
    const trimmed = licenseKey.trim();
    if (!trimmed) {
      setError('Please enter your license key.');
      inputRef.current?.focus();
      return;
    }
    setLoading(true);
    try {
      if (!window.electronAPI) {
        if (trimmed.length >= 8) {
          setIsTrial(false);
          setShowModal(false);
          setStatus('valid');
          alert('Demo license activated successfully!');
          return;
        } else {
          setError('Demo: Enter any key with 8 or more characters to test.');
          return;
        }
      }

      const result = await window.electronAPI.validateLicense(trimmed);
      if (result.valid) {
        await window.electronAPI.saveLicense(trimmed);
        setLicenseInfo(result);
        setIsTrial(false);
        setShowModal(false);
        if (result.daysLeft <= 30) {
          setWarning(`License expires in ${result.daysLeft} day${result.daysLeft === 1 ? '' : 's'}.`);
        } else {
          setWarning('');
        }
        setStatus('valid');
      } else {
        setError(result.reason || 'Invalid license key. Please check and try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  function copyMachineId() {
    if (!machineId) return;
    navigator.clipboard.writeText(machineId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function renderActivationModal(allowClose) {
    return (
      <div style={s.overlay}>
        <div style={s.bgOrb1} />
        <div style={s.bgOrb2} />
        <div style={s.bgOrb3} />

        <div className="lg-card" style={s.card}>
          {allowClose && (
            <button
              onClick={() => setShowModal(false)}
              style={{
                position: 'absolute',
                top: 18,
                right: 22,
                background: 'transparent',
                border: 'none',
                color: '#9CA3AF',
                fontSize: 22,
                cursor: 'pointer',
                lineHeight: 1,
              }}
              title="Close and continue trial"
            >
              ✕
            </button>
          )}

          {/* App Icon */}
          <div style={s.iconRing}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none"
              stroke="#D9A441" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 2h8"/>
              <path d="M9 2v2.78a4 4 0 0 1-1.17 2.83L6.5 9a3 3 0 0 0-.5 1.7v8.3A3 3 0 0 0 9 22h6a3 3 0 0 0 3-3v-8.3a3 3 0 0 0-.5-1.7l-1.33-1.39A4 4 0 0 1 15 4.78V2"/>
              <path d="M6 13h12"/>
            </svg>
          </div>

          <h1 style={s.title}>Doodh Khata</h1>
          <p style={s.subtitle}>Milk Supply Ledger · IntegroOne Solutions</p>

          {/* Status badge */}
          {status === 'trial-expired' ? (
            <div style={s.expiredBadge}>
              <span>⏰</span>
              <span>
                <strong>Your 7-day free trial has expired.</strong><br/>
                Please send your Machine ID to your software provider to activate and continue using Doodh Khata.
              </span>
            </div>
          ) : status === 'expired' ? (
            <div style={s.expiredBadge}>
              <span>⏰</span>
              <span>
                License expired on{' '}
                <strong>{new Date(licenseInfo?.expiryDate).toLocaleDateString('en-PK')}</strong>.
                Please contact your provider for renewal.
              </span>
            </div>
          ) : (
            <div style={s.infoBadge}>
              ⏳ 7-Day Trial Active ({trialDaysLeft} days remaining). Enter your license key anytime to activate permanently.
            </div>
          )}

          <div style={s.divider} />

          {/* Machine ID */}
          <label style={s.label}>Your Machine ID</label>
          <div style={s.machineBox}>
            <span style={s.machineId}>{machineId || '——————————————'}</span>
            <button
              className="lg-btn-copy"
              style={s.copyBtn}
              onClick={copyMachineId}
              title="Copy Machine ID"
            >
              {copied ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4ADE80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
              )}
              <span style={{ fontSize: 11, marginLeft: 4 }}>{copied ? 'Copied!' : 'Copy'}</span>
            </button>
          </div>
          <p style={s.hint}>
            Send this Machine ID to your software provider to receive your activation key.
          </p>

          {/* License Key Input */}
          <label style={{ ...s.label, marginTop: 20 }}>License Key</label>
          <input
            ref={inputRef}
            id="license-key-input"
            className="lg-input"
            style={s.input}
            type="text"
            placeholder="e.g. AAAAA-BBBBB-CCCCC-DDDDD-EEEEE"
            value={licenseKey}
            onChange={e => { setLicenseKey(e.target.value); setError(''); }}
            onKeyDown={e => e.key === 'Enter' && handleActivate()}
            spellCheck={false}
            autoComplete="off"
          />

          {error && (
            <div style={s.errorBox}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span>{error}</span>
            </div>
          )}

          {/* Activate Button */}
          <button
            id="activate-btn"
            className="lg-btn-activate"
            style={{ ...s.activateBtn, opacity: loading ? 0.7 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}
            onClick={handleActivate}
            disabled={loading}
          >
            {loading ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <span style={{ ...s.btnSpinner }} />
                Activating…
              </span>
            ) : (
              status === 'expired' ? '🔄 Renew License' : '🔓 Activate Application'
            )}
          </button>

          {allowClose && (
            <button
              onClick={() => setShowModal(false)}
              style={{
                display: 'block',
                width: '100%',
                marginTop: 12,
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10,
                padding: '10px',
                color: '#9CA3AF',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Continue Free Trial ({trialDaysLeft} days remaining)
            </button>
          )}

          <p style={s.footer}>
            Doodh Khata &nbsp;·&nbsp; Powered by IntegroOne Solutions &nbsp;·&nbsp; All rights reserved
          </p>
        </div>
      </div>
    );
  }

  // ── Checking / loading ────────────────────────────────────────────────────
  if (status === 'checking') {
    return (
      <div style={s.overlay}>
        <div style={s.bgOrb1} /><div style={s.bgOrb2} />
        <div style={{ textAlign: 'center' }}>
          <div style={s.spinner} />
          <p style={{ color: '#6B7280', marginTop: 16, fontFamily: "'IBM Plex Sans',sans-serif", fontSize: 14 }}>
            Checking license…
          </p>
        </div>
      </div>
    );
  }

  // ── Valid (either active trial or licensed) ─────────────────────────────────
  if (status === 'valid') {
    return (
      <>
        {/* 7-Day Trial Banner */}
        {isTrial && (
          <div style={{
            background: 'linear-gradient(90deg, #17332D 0%, #264B42 100%)',
            borderBottom: '1px solid rgba(217,164,65,0.4)',
            color: '#FBF8F1',
            padding: '8px 24px',
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontFamily: "'IBM Plex Sans', sans-serif",
            boxShadow: '0 2px 10px rgba(0,0,0,0.12)',
            zIndex: 45,
            position: 'relative',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 16 }}>⏳</span>
              <span>
                <strong>7-Day Free Trial:</strong> You have <strong style={{ color: '#FCD34D' }}>{trialDaysLeft} day{trialDaysLeft === 1 ? '' : 's'} remaining</strong>. Get your activation key from IntegroOne Solutions to unlock permanently.
              </span>
            </div>
            <button
              onClick={() => { setError(''); setShowModal(true); }}
              style={{
                background: 'var(--accent, #D9A441)',
                color: '#231A06',
                border: 'none',
                borderRadius: 6,
                padding: '6px 14px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
              }}
            >
              🔑 Enter Activation Key
            </button>
          </div>
        )}

        {warning && (
          <div style={{
            background: 'rgba(245,158,11,0.15)',
            borderBottom: '1px solid rgba(245,158,11,0.3)',
            color: '#FCD34D',
            padding: '10px 24px',
            fontSize: 13,
            textAlign: 'center',
            fontFamily: "'IBM Plex Sans', sans-serif",
            letterSpacing: '0.01em',
          }}>
            ⚠️ {warning}
          </div>
        )}

        {children}

        {/* Modal when user clicks Enter Activation Key during trial */}
        {showModal && renderActivationModal(true)}
      </>
    );
  }

  // ── Locked screen (Trial Expired or License Expired) ─────────────────────────
  return renderActivationModal(false);
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'linear-gradient(145deg, #0A0C14 0%, #0F1420 50%, #0A0C14 100%)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: "'IBM Plex Sans', sans-serif",
    overflow: 'hidden',
    zIndex: 9999,
  },
  bgOrb1: {
    position: 'absolute', top: '-15%', right: '-8%',
    width: 600, height: 600, borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(217,164,65,0.07) 0%, transparent 65%)',
    pointerEvents: 'none',
  },
  bgOrb2: {
    position: 'absolute', bottom: '-20%', left: '-10%',
    width: 500, height: 500, borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(99,102,241,0.06) 0%, transparent 65%)',
    pointerEvents: 'none',
  },
  bgOrb3: {
    position: 'absolute', top: '40%', left: '35%',
    width: 300, height: 300, borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(217,164,65,0.03) 0%, transparent 70%)',
    pointerEvents: 'none',
  },
  card: {
    position: 'relative', zIndex: 1,
    background: 'rgba(255,255,255,0.035)',
    backdropFilter: 'blur(24px)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 28,
    padding: '44px 52px',
    width: '100%', maxWidth: 460,
    boxShadow: '0 32px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04) inset',
  },
  iconRing: {
    width: 76, height: 76,
    background: 'linear-gradient(135deg, rgba(217,164,65,0.15) 0%, rgba(217,164,65,0.05) 100%)',
    border: '1px solid rgba(217,164,65,0.3)',
    borderRadius: 22,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    margin: '0 auto 20px',
    boxShadow: '0 8px 24px rgba(217,164,65,0.12)',
  },
  title: {
    color: '#F3F4F6', fontSize: 26, fontWeight: 700,
    textAlign: 'center', margin: '0 0 4px',
    letterSpacing: '-0.4px',
  },
  subtitle: {
    color: '#6B7280', fontSize: 13, textAlign: 'center',
    margin: '0 0 20px', letterSpacing: '0.02em',
  },
  expiredBadge: {
    background: 'rgba(239,68,68,0.1)',
    border: '1px solid rgba(239,68,68,0.2)',
    borderRadius: 10, padding: '11px 14px',
    display: 'flex', gap: 10, alignItems: 'flex-start',
    color: '#FCA5A5', fontSize: 13, lineHeight: 1.5,
    marginBottom: 20,
  },
  infoBadge: {
    background: 'rgba(99,102,241,0.08)',
    border: '1px solid rgba(99,102,241,0.15)',
    borderRadius: 10, padding: '10px 14px',
    color: '#A5B4FC', fontSize: 13, textAlign: 'center',
    marginBottom: 20,
  },
  divider: {
    height: 1, background: 'rgba(255,255,255,0.07)',
    marginBottom: 22,
  },
  label: {
    display: 'block', color: '#9CA3AF',
    fontSize: 11, fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '0.08em',
    marginBottom: 8,
  },
  machineBox: {
    background: 'rgba(0,0,0,0.35)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 10, padding: '10px 14px',
    display: 'flex', alignItems: 'center',
    justifyContent: 'space-between', gap: 8,
  },
  machineId: {
    color: '#D9A441', fontFamily: "'Courier New', monospace",
    fontSize: 17, fontWeight: 700, letterSpacing: '0.12em',
  },
  copyBtn: {
    background: 'rgba(217,164,65,0.1)',
    border: '1px solid rgba(217,164,65,0.2)',
    borderRadius: 7, color: '#D9A441',
    cursor: 'pointer', padding: '5px 10px',
    display: 'flex', alignItems: 'center',
    transition: 'background 0.2s',
    fontSize: 12,
  },
  hint: {
    color: '#4B5563', fontSize: 12, marginTop: 7, lineHeight: 1.5,
  },
  input: {
    width: '100%', boxSizing: 'border-box',
    background: 'rgba(0,0,0,0.3)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 10, padding: '12px 14px',
    color: '#E5E7EB', fontSize: 13,
    fontFamily: "'Courier New', monospace",
    letterSpacing: '0.04em',
    transition: 'border-color 0.2s, box-shadow 0.2s',
  },
  errorBox: {
    display: 'flex', alignItems: 'flex-start', gap: 8,
    background: 'rgba(239,68,68,0.08)',
    border: '1px solid rgba(239,68,68,0.15)',
    borderRadius: 8, padding: '9px 12px',
    color: '#F87171', fontSize: 12,
    marginTop: 10, lineHeight: 1.5,
  },
  activateBtn: {
    display: 'block', width: '100%', marginTop: 20,
    background: 'linear-gradient(135deg, #D9A441 0%, #B8872B 100%)',
    border: 'none', borderRadius: 12,
    padding: '14px', color: '#FFFFFF',
    fontSize: 15, fontWeight: 600,
    transition: 'transform 0.15s, box-shadow 0.15s, opacity 0.15s',
    boxShadow: '0 4px 20px rgba(217,164,65,0.3)',
    letterSpacing: '0.01em',
  },
  footer: {
    color: '#374151', fontSize: 11,
    textAlign: 'center', marginTop: 24, marginBottom: 0,
    letterSpacing: '0.03em',
  },
  spinner: {
    width: 36, height: 36, margin: '0 auto',
    border: '3px solid rgba(217,164,65,0.15)',
    borderTopColor: '#D9A441',
    borderRadius: '50%',
    animation: 'lg-spin 0.75s linear infinite',
  },
  btnSpinner: {
    display: 'inline-block',
    width: 14, height: 14,
    border: '2px solid rgba(255,255,255,0.3)',
    borderTopColor: '#fff',
    borderRadius: '50%',
    animation: 'lg-spin 0.75s linear infinite',
  },
};
