'use client';

import React, { useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';

interface AuthModalProps {
  isOpen?: boolean;
  onSuccess: () => void;
  onClose: () => void;
}

export default function AuthModal({ isOpen = true, onSuccess, onClose }: AuthModalProps) {
  const { signInWithGoogle, setupRecaptcha, sendOtpCode } = useAuth();
  const [mode, setMode] = useState<'choose' | 'phone' | 'otp'>('choose');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Holds the ConfirmationResult so we can call .confirm(otp) in the verify step.
  const confirmationRef = useRef<import('firebase/auth').ConfirmationResult | null>(null);
  const recaptchaContainerId = 'auth-modal-recaptcha-container';

  if (!isOpen) return null;

  const handleGoogle = async () => {
    setLoading(true);
    setError('');
    try {
      await signInWithGoogle();
      onSuccess();
    } catch (e: any) {
      setError(e?.message || 'Google sign-in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSendOtp = async () => {
    if (!phone || phone.length < 10) {
      setError('Enter a valid 10-digit mobile number.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const formattedPhone = phone.startsWith('+') ? phone : `+91${phone.replace(/\D/g, '')}`;
      const verifier = setupRecaptcha(recaptchaContainerId);
      const confirmation = await sendOtpCode(formattedPhone, verifier);
      confirmationRef.current = confirmation;
      setMode('otp');
    } catch (e: any) {
      setError(e?.message || 'Failed to send OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otp || otp.length < 6) {
      setError('Enter the 6-digit OTP.');
      return;
    }
    if (!confirmationRef.current) {
      setError('Session expired. Please request a new OTP.');
      setMode('phone');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await confirmationRef.current.confirm(otp);
      onSuccess();
    } catch (e: any) {
      setError(e?.message || 'Invalid OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={overlay}>
      <div style={card}>
        <button onClick={onClose} style={closeBtn} aria-label="Close">✕</button>
        <div style={logo}>🚗</div>
        <h2 style={title}>Sign in to TheCarPool</h2>
        <p style={subtitle}>Join 50,000+ verified corporate commuters</p>

        {error && <p style={errorBox}>{error}</p>}

        {mode === 'choose' && (
          <>
            <button
              style={{ ...primaryBtn, backgroundColor: '#fff', color: '#1f2937', border: '1px solid #e5e7eb' }}
              onClick={handleGoogle}
              disabled={loading}
            >
              <span style={{ marginRight: 8 }}>🔵</span>
              {loading ? 'Signing in…' : 'Continue with Google'}
            </button>

            <div style={divider}><span>or</span></div>

            <button
              style={primaryBtn}
              onClick={() => setMode('phone')}
              disabled={loading}
            >
              📱 Continue with Phone OTP
            </button>
          </>
        )}

        {mode === 'phone' && (
          <>
            <label style={fieldLabel}>Mobile Number</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={prefix}>+91</span>
              <input
                id="auth-phone-input"
                type="tel"
                placeholder="10-digit mobile number"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                style={fieldInput}
                autoFocus
              />
            </div>
            <div id={recaptchaContainerId} style={{ marginTop: 12 }} />
            <button style={primaryBtn} onClick={handleSendOtp} disabled={loading || phone.length < 10}>
              {loading ? 'Sending…' : 'Send OTP →'}
            </button>
            <button style={backBtn} onClick={() => setMode('choose')}>← Back</button>
          </>
        )}

        {mode === 'otp' && (
          <>
            <p style={subtitle}>OTP sent to +91 {phone}</p>
            <label style={fieldLabel}>6-Digit OTP</label>
            <input
              id="auth-otp-input"
              type="tel"
              placeholder="• • • • • •"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              style={{ ...fieldInput, letterSpacing: 8, fontSize: 22, textAlign: 'center' }}
              autoFocus
            />
            <button style={primaryBtn} onClick={handleVerifyOtp} disabled={loading || otp.length < 6}>
              {loading ? 'Verifying…' : 'Verify & Sign In →'}
            </button>
            <button style={backBtn} onClick={() => { setMode('phone'); setOtp(''); confirmationRef.current = null; }}>← Change Number</button>
          </>
        )}

        <p style={legalText}>By signing in you agree to our Terms &amp; Privacy Policy</p>
      </div>
    </div>
  );
}

// Inline styles
const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex',
  alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};
const card: React.CSSProperties = {
  background: '#fff', borderRadius: 24, padding: '40px 32px', width: '100%', maxWidth: 400,
  position: 'relative', display: 'flex', flexDirection: 'column', gap: 12,
};
const closeBtn: React.CSSProperties = {
  position: 'absolute', top: 16, right: 16, background: 'none', border: 'none',
  fontSize: 18, cursor: 'pointer', color: '#6b7280',
};
const logo: React.CSSProperties = { fontSize: 40, textAlign: 'center' };
const title: React.CSSProperties = { fontSize: 22, fontWeight: 700, textAlign: 'center', margin: 0 };
const subtitle: React.CSSProperties = { fontSize: 13, color: '#6b7280', textAlign: 'center', margin: 0 };
const errorBox: React.CSSProperties = {
  background: '#fef2f2', color: '#dc2626', borderRadius: 8, padding: '8px 12px', fontSize: 13, margin: 0,
};
const primaryBtn: React.CSSProperties = {
  background: '#10b981', color: '#fff', border: 'none', borderRadius: 12,
  padding: '14px 20px', fontSize: 15, fontWeight: 600, cursor: 'pointer', width: '100%',
};
const backBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 14,
};
const divider: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, color: '#9ca3af', fontSize: 12,
  textAlign: 'center',
};
const fieldLabel: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#374151' };
const prefix: React.CSSProperties = {
  background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 8,
  padding: '10px 12px', fontSize: 15, color: '#374151',
};
const fieldInput: React.CSSProperties = {
  border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px',
  fontSize: 15, outline: 'none', width: '100%',
};
const legalText: React.CSSProperties = { fontSize: 11, color: '#9ca3af', textAlign: 'center', margin: 0 };
