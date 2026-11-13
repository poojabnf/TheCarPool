'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { X, Smartphone, ArrowRight, ShieldCheck, RefreshCw, AlertCircle } from 'lucide-react';
import Link from 'next/link';

interface AuthModalProps {
  isOpen?: boolean;
  onSuccess: () => void;
  onClose: () => void;
  initialMode?: 'choose' | 'phone';
}

export default function AuthModal({ isOpen = true, onSuccess, onClose, initialMode = 'choose' }: AuthModalProps) {
  const { signInWithGoogle, setupRecaptcha, sendOtpCode } = useAuth();
  const [mode, setMode] = useState<'choose' | 'phone' | 'otp'>(initialMode);
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resendTimer, setResendTimer] = useState(30);
  const [canResend, setCanResend] = useState(false);

  const otpInputsRef = useRef<(HTMLInputElement | null)[]>([]);
  const confirmationRef = useRef<import('firebase/auth').ConfirmationResult | null>(null);
  const recaptchaContainerId = 'auth-modal-recaptcha-container';

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Handle Resend Countdown
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (mode === 'otp' && resendTimer > 0) {
      interval = setInterval(() => setResendTimer(prev => prev - 1), 1000);
    } else if (resendTimer === 0) {
      setCanResend(true);
    }
    return () => clearInterval(interval);
  }, [mode, resendTimer]);

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

  const handleSendOtp = async (isResend = false) => {
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length !== 10) {
      setError('Please enter a valid 10-digit mobile number.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const formattedPhone = `+91${cleanPhone}`;
      const verifier = setupRecaptcha(recaptchaContainerId);
      const confirmation = await sendOtpCode(formattedPhone, verifier);
      confirmationRef.current = confirmation;
      setMode('otp');
      setResendTimer(30);
      setCanResend(false);
      setOtp(['', '', '', '', '', '']);
    } catch (e: any) {
      setError(e?.message?.includes('invalid-phone') 
        ? 'Invalid phone number format.' 
        : 'Failed to send OTP. Please check connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (index: number, val: string) => {
    const clean = val.replace(/\D/g, '');
    if (!clean) {
      const newOtp = [...otp];
      newOtp[index] = '';
      setOtp(newOtp);
      return;
    }
    const newOtp = [...otp];
    newOtp[index] = clean[clean.length - 1];
    setOtp(newOtp);

    // Auto-advance focus
    if (index < 5) {
      otpInputsRef.current[index + 1]?.focus();
    }

    // Auto submit on last digit
    if (index === 5 && newOtp.every(d => d !== '')) {
      handleVerifyCode(newOtp.join(''));
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpInputsRef.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      const newOtp = pasted.split('');
      setOtp(newOtp);
      handleVerifyCode(pasted);
    }
  };

  const handleVerifyCode = async (codeToVerify?: string) => {
    const finalOtp = codeToVerify || otp.join('');
    if (finalOtp.length !== 6) {
      setError('Please enter all 6 digits of the OTP.');
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
      await confirmationRef.current.confirm(finalOtp);
      onSuccess();
    } catch (e: any) {
      setError('Invalid OTP code. Please check and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl w-full max-w-md p-8 relative overflow-hidden">
        {/* Close Button */}
        <button 
          onClick={onClose} 
          className="absolute top-5 right-5 p-2 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          aria-label="Close modal"
        >
          <X size={18} />
        </button>

        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-12 h-12 bg-teal-50 dark:bg-teal-950/40 rounded-2xl flex items-center justify-center mx-auto mb-3 border border-teal-200 dark:border-teal-800">
            <ShieldCheck className="text-teal-700 dark:text-teal-400" size={24} />
          </div>
          <h2 id="auth-modal-title" className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            {mode === 'otp' ? 'Enter Verification Code' : 'Welcome to TheCarPool'}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {mode === 'otp' 
              ? `We sent a 6-digit code to +91 ${phone}` 
              : 'Join verified corporate commuters on your route'}
          </p>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 text-xs flex items-center gap-2" role="alert">
            <AlertCircle size={16} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* MODE: CHOOSE */}
        {mode === 'choose' && (
          <div className="space-y-4">
            <button
              onClick={handleGoogle}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 py-3.5 px-4 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 font-bold rounded-xl transition-all shadow-sm cursor-pointer disabled:opacity-50"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
              </svg>
              <span>{loading ? 'Connecting...' : 'Continue with Google'}</span>
            </button>

            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
              <span className="text-xs uppercase text-slate-400 font-semibold">or</span>
              <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
            </div>

            <button
              onClick={() => setMode('phone')}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3.5 px-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold rounded-xl hover:opacity-90 transition-all shadow-md cursor-pointer disabled:opacity-50"
            >
              <Smartphone size={18} />
              <span>Continue with Phone Number</span>
            </button>
          </div>
        )}

        {/* MODE: PHONE INPUT */}
        {mode === 'phone' && (
          <div className="space-y-4">
            <div>
              <label htmlFor="auth-modal-phone" className="block text-xs font-bold text-slate-500 uppercase mb-2">Mobile Number</label>
              <div className="flex gap-2">
                <span className="px-3.5 py-3 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-600 dark:text-slate-300 text-sm flex items-center">
                  +91
                </span>
                <input
                  id="auth-modal-phone"
                  type="tel"
                  placeholder="98765 43210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-semibold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-teal-500 transition-all"
                  autoFocus
                />
              </div>
            </div>

            <div id={recaptchaContainerId} />

            <button
              onClick={() => handleSendOtp(false)}
              disabled={loading || phone.length < 10}
              className="w-full py-3.5 bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-teal-700/20"
            >
              {loading ? 'Sending OTP...' : <>Send Code <ArrowRight size={16} /></>}
            </button>

            <button 
              onClick={() => { setMode('choose'); setError(''); }} 
              className="w-full text-xs font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 py-1 transition-colors cursor-pointer"
            >
              ← Back to options
            </button>
          </div>
        )}

        {/* MODE: OTP DIGITS */}
        {mode === 'otp' && (
          <div className="space-y-6">
            <div className="flex justify-between gap-2" onPaste={handleOtpPaste}>
              {otp.map((digit, idx) => (
                <input
                  key={idx}
                  ref={(el) => { otpInputsRef.current[idx] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleOtpChange(idx, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                  className="w-12 h-14 text-center font-black text-xl bg-slate-50 dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 transition-all text-slate-900 dark:text-white"
                  autoFocus={idx === 0}
                  aria-label={`Digit ${idx + 1}`}
                />
              ))}
            </div>

            <div className="flex items-center justify-between text-xs">
              <button 
                onClick={() => { setMode('phone'); setError(''); }}
                className="font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                Change Number
              </button>
              <button
                disabled={!canResend || loading}
                onClick={() => handleSendOtp(true)}
                className="font-bold text-teal-700 dark:text-teal-400 hover:underline disabled:text-slate-400 flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed"
              >
                <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                {canResend ? 'Resend Code' : `Resend in ${resendTimer}s`}
              </button>
            </div>

            <button
              onClick={() => handleVerifyCode()}
              disabled={loading || otp.some(d => d === '')}
              className="w-full py-3.5 bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-teal-700/20"
            >
              {loading ? 'Verifying...' : 'Verify & Continue'}
            </button>
          </div>
        )}

        {/* Footer Terms */}
        <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center mt-6">
          By continuing, you agree to TheCarPool&apos;s <Link href="/privacy" className="underline hover:text-slate-600 dark:hover:text-slate-300">Terms &amp; Privacy Policy</Link>.
        </p>
      </div>
    </div>
  );
}
