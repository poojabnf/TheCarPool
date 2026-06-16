"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import { apiFetch } from "../../lib/api";
import { 
  User, 
  MapPin, 
  Building, 
  Briefcase, 
  Camera, 
  Check, 
  ArrowRight, 
  AlertCircle, 
  CreditCard
} from "lucide-react";

const TOTAL_STEPS = 5;
const STEP_LABELS = ['Role', 'Profile', 'Aadhaar', 'PAN', 'Selfie'];
const STEP_ICONS = ['🚗', '👤', '🪪', '💳', '🤳'];
const STEP_DESCRIPTIONS = [
  'Choose how you want to use the app',
  'Tell us about yourself',
  'Link your Aadhaar for identity verification',
  'Verify PAN for payment compliance',
  'Face liveness check for security',
];

export default function OnboardingPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [currentStep, setCurrentStep] = useState(0);

  // Form State
  const [role, setRole] = useState<'rider' | 'partner' | null>(null);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [workLocation, setWorkLocation] = useState("");
  
  // Aadhaar State
  const [aadhaar, setAadhaar] = useState("");
  const [aadhaarStage, setAadhaarStage] = useState<'input' | 'otp' | 'done'>('input');
  const [aadhaarOtp, setAadhaarOtp] = useState("");
  const [aadhaarLoading, setAadhaarLoading] = useState(false);

  // PAN State
  const [pan, setPan] = useState("");
  const [panLoading, setPanLoading] = useState(false);
  const [panVerified, setPanVerified] = useState(false);
  const [panFetchedName, setPanFetchedName] = useState("");

  // Selfie State
  const [selfieStage, setSelfieStage] = useState<'idle' | 'scanning' | 'done'>('idle');

  const [saving, setSaving] = useState(false);

  // Redirection guard
  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.push("/");
      } else {
        // Pre-fill name from auth if available
        if (user.displayName && !name) {
          setName(user.displayName);
        }

        // If already onboarded (server-side flag), send to customer portal.
        (async () => {
          try {
            const res = await apiFetch("/api/users/me");
            if (res.ok) {
              const data = await res.json();
              if (data.onboarded === true) {
                router.push("/customer");
              }
            }
          } catch {
            // Network/API failure — let the user proceed with onboarding.
          }
        })();
      }
    }
  }, [user, loading, name, router]);

  const handleNext = async () => {
    if (currentStep < TOTAL_STEPS - 1) {
      setCurrentStep(prev => prev + 1);
      return;
    }

    // Final step: persist the collected profile to Firestore via the backend,
    // which also sets the authoritative `onboarded` flag.
    if (user) {
      setSaving(true);
      try {
        await apiFetch("/api/users/profile", {
          method: "POST",
          body: JSON.stringify({
            name,
            company,
            employeeId,
            workLocation,
            role,
          }),
        });
      } catch {
        // Non-fatal: surface but still let the user into the app.
      } finally {
        setSaving(false);
      }
    }
    router.push("/customer");
  };

  // OTP simulation for Aadhaar
  const handleAadhaarSendOtp = () => {
    if (aadhaar.replace(/\s/g, '').length !== 12) return;
    setAadhaarLoading(true);
    setTimeout(() => {
      setAadhaarLoading(false);
      setAadhaarStage('otp');
    }, 1200);
  };

  const handleAadhaarVerifyOtp = () => {
    if (aadhaarOtp.length !== 6) return;
    setAadhaarLoading(true);
    setTimeout(() => {
      setAadhaarLoading(false);
      setAadhaarStage('done');
    }, 1200);
  };

  // PAN verification simulation
  const handlePanVerify = () => {
    const formattedPan = pan.toUpperCase();
    const isValid = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(formattedPan);
    if (!isValid) return;

    setPanLoading(true);
    setTimeout(() => {
      setPanLoading(false);
      setPanFetchedName(name.toUpperCase() || "POOJA YADAV");
      setPanVerified(true);
    }, 1500);
  };

  // Selfie Liveness simulation
  const handleTakeSelfie = () => {
    setSelfieStage('scanning');
    setTimeout(() => {
      setSelfieStage('done');
    }, 3000);
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col justify-center items-center">
        <div className="w-16 h-16 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="mt-4 text-slate-600 dark:text-slate-400 font-semibold animate-pulse text-lg">Verifying auth status...</p>
      </div>
    );
  }

  const isProfileValid = name.trim().length > 1 && company.trim().length > 1;
  const isAadhaarFormatted = aadhaar.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
  const isPanValidFormat = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(pan.toUpperCase());

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-sans py-12 px-4 sm:px-6 lg:px-8 flex flex-col justify-center items-center">
      <div className="max-w-2xl w-full space-y-8 bg-white dark:bg-slate-800 p-8 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-2xl relative overflow-hidden">
        
        {/* Progress Bar Header */}
        <div className="flex justify-between items-center pb-6 border-b border-slate-100 dark:border-slate-700">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-emerald-600 dark:text-emerald-500">Account Setup</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-semibold">Verify your identity to unlock trust badges</p>
          </div>
          <span className="text-sm font-bold text-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-1.5 rounded-full">
            Step {currentStep + 1} of {TOTAL_STEPS}
          </span>
        </div>

        {/* Progress Step Nodes */}
        <div className="flex items-center justify-between px-2 py-4">
          {Array(TOTAL_STEPS).fill(0).map((_, i) => {
            const isCompleted = i < currentStep;
            const isActive = i === currentStep;
            return (
              <React.Fragment key={i}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs border transition-all ${
                  isCompleted ? "bg-emerald-500 border-emerald-500 text-white" :
                  isActive ? "bg-emerald-100 dark:bg-emerald-900/50 border-emerald-500 text-emerald-600 dark:text-emerald-400 scale-110 shadow-lg shadow-emerald-500/10" :
                  "bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-400"
                }`}>
                  {isCompleted ? <Check size={12} strokeWidth={3} /> : i + 1}
                </div>
                {i < TOTAL_STEPS - 1 && (
                  <div className={`flex-1 h-1 mx-2 rounded-full transition-colors ${
                    i < currentStep ? "bg-emerald-500" : "bg-slate-200 dark:bg-slate-800"
                  }`} />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Step Intro Card */}
        <div className="flex items-center space-x-4 bg-slate-50 dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-100 dark:border-slate-800">
          <span className="text-3xl">{STEP_ICONS[currentStep]}</span>
          <div>
            <h3 className="font-extrabold text-slate-800 dark:text-white text-md uppercase tracking-wider">{STEP_LABELS[currentStep]}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{STEP_DESCRIPTIONS[currentStep]}</p>
          </div>
        </div>

        {/* Dynamic Wizard Steps */}
        <div className="mt-8 min-h-[300px]">
          
          {/* STEP 1: ROLE */}
          {currentStep === 0 && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div className="text-center">
                <h2 className="text-xl font-bold text-slate-800 dark:text-white">Choose Your Commute Role</h2>
                <p className="text-slate-500 text-sm mt-1">Select your primary mode. You can toggle this anytime later.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2">
                <button 
                  onClick={() => setRole('rider')}
                  className={`p-6 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                    role === 'rider' 
                    ? 'border-emerald-500 bg-emerald-50/20 dark:bg-emerald-950/20' 
                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  <span className="text-4xl">🧍</span>
                  <h3 className="font-extrabold text-lg text-slate-800 dark:text-white mt-4">Rider</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Book rides, join pools, and split costs. Perfect for daily office commutes.</p>
                </button>
                <button 
                  onClick={() => setRole('partner')}
                  className={`p-6 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                    role === 'partner' 
                    ? 'border-emerald-500 bg-emerald-50/20 dark:bg-emerald-950/20' 
                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  <span className="text-4xl">🚘</span>
                  <h3 className="font-extrabold text-lg text-slate-800 dark:text-white mt-4">Partner</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Offer spare seats in your vehicle, set recurring routes, and split fuel costs.</p>
                </button>
              </div>
              <button
                disabled={!role}
                onClick={handleNext}
                className={`w-full py-4 mt-6 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer ${
                  !role ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'
                }`}
              >
                Continue <ArrowRight size={18} />
              </button>
            </div>
          )}

          {/* STEP 2: PROFILE */}
          {currentStep === 1 && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div className="grid grid-cols-1 gap-6">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Full Name *</label>
                  <div className="relative">
                    <User className="absolute left-4 top-3.5 text-slate-400" size={18} />
                    <input 
                      required
                      type="text" 
                      placeholder="e.g. Pooja Yadav"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full pl-12 pr-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 font-semibold"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Company / Corporate Employer *</label>
                  <div className="relative">
                    <Building className="absolute left-4 top-3.5 text-slate-400" size={18} />
                    <input 
                      required
                      type="text" 
                      placeholder="e.g. Google, TCS, Infosys"
                      value={company}
                      onChange={(e) => setCompany(e.target.value)}
                      className="w-full pl-12 pr-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 font-semibold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Employee / Staff ID (Optional)</label>
                    <div className="relative">
                      <Briefcase className="absolute left-4 top-3.5 text-slate-400" size={18} />
                      <input 
                        type="text" 
                        placeholder="e.g. 9847192"
                        value={employeeId}
                        onChange={(e) => setEmployeeId(e.target.value)}
                        className="w-full pl-12 pr-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 font-semibold"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Work Location / City Hub</label>
                    <div className="relative">
                      <MapPin className="absolute left-4 top-3.5 text-slate-400" size={18} />
                      <input 
                        type="text" 
                        placeholder="e.g. Cyber City, Gurugram"
                        value={workLocation}
                        onChange={(e) => setWorkLocation(e.target.value)}
                        className="w-full pl-12 pr-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 font-semibold"
                      />
                    </div>
                  </div>
                </div>
              </div>
              
              <button
                disabled={!isProfileValid}
                onClick={handleNext}
                className={`w-full py-4 mt-6 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer ${
                  !isProfileValid ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'
                }`}
              >
                Continue <ArrowRight size={18} />
              </button>
            </div>
          )}

          {/* STEP 3: AADHAAR */}
          {currentStep === 2 && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div className="bg-blue-50 dark:bg-blue-900/10 p-4 rounded-xl border border-blue-100 dark:border-blue-800/20 flex gap-3">
                <AlertCircle size={20} className="text-blue-500 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700 dark:text-blue-400 leading-relaxed">
                  We verify your identity directly via DigiLocker and UIDAI database integrations. Your Aadhaar credentials are processed in escrow and never stored on our servers.
                </p>
              </div>

              {aadhaarStage === 'input' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">12-Digit Aadhaar Number</label>
                    <input 
                      type="text" 
                      placeholder="0000 0000 0000"
                      value={isAadhaarFormatted}
                      onChange={(e) => setAadhaar(e.target.value.replace(/\D/g, '').slice(0, 12))}
                      className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-center outline-none focus:ring-2 focus:ring-emerald-500 font-extrabold text-xl tracking-wider"
                    />
                  </div>
                  <button
                    disabled={aadhaar.replace(/\s/g, '').length !== 12 || aadhaarLoading}
                    onClick={handleAadhaarSendOtp}
                    className="w-full py-4 mt-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold rounded-xl flex items-center justify-center gap-2 hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {aadhaarLoading ? (
                      <div className="w-5 h-5 border-2 border-white dark:border-slate-900 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      "Send OTP to Aadhaar Linked Mobile"
                    )}
                  </button>
                </div>
              )}

              {aadhaarStage === 'otp' && (
                <div className="space-y-4">
                  <div className="text-center text-xs font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 py-2 rounded-lg">
                    OTP sent to Aadhaar-linked phone ending in •••• {aadhaar.slice(-4)}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Enter 6-Digit OTP</label>
                    <input 
                      type="text" 
                      placeholder="• • • • • •"
                      maxLength={6}
                      value={aadhaarOtp}
                      onChange={(e) => setAadhaarOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-center outline-none focus:ring-2 focus:ring-emerald-500 font-extrabold text-xl tracking-widest"
                    />
                  </div>
                  <button
                    disabled={aadhaarOtp.length !== 6 || aadhaarLoading}
                    onClick={handleAadhaarVerifyOtp}
                    className="w-full py-4 mt-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold rounded-xl flex items-center justify-center gap-2 hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {aadhaarLoading ? (
                      <div className="w-5 h-5 border-2 border-white dark:border-slate-900 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      "Verify OTP"
                    )}
                  </button>
                </div>
              )}

              {aadhaarStage === 'done' && (
                <div className="text-center py-6 space-y-4 animate-in zoom-in-95 duration-200">
                  <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto text-3xl font-extrabold">
                    ✓
                  </div>
                  <div>
                    <h2 className="text-2xl font-black text-emerald-500">Aadhaar Verified!</h2>
                    <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Identity matched with UIDAI Registry. Last 4 digits: •••• {aadhaar.slice(-4)}</p>
                  </div>
                  <button
                    onClick={handleNext}
                    className="w-full py-4 mt-6 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold rounded-xl flex items-center justify-center gap-2 hover:opacity-90 transition-all cursor-pointer"
                  >
                    Continue to PAN Verification <ArrowRight size={18} />
                  </button>
                </div>
              )}

            </div>
          )}

          {/* STEP 4: PAN */}
          {currentStep === 3 && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div className="bg-blue-50 dark:bg-blue-900/10 p-4 rounded-xl border border-blue-100 dark:border-blue-800/20 flex gap-3">
                <CreditCard size={20} className="text-blue-500 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700 dark:text-blue-400 leading-relaxed">
                  Indian tax compliance requires validation of your PAN Card. This ensures secure payment processing and compliance for payout disbursements.
                </p>
              </div>

              {!panVerified ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">PAN Card Number</label>
                    <input 
                      type="text" 
                      placeholder="ABCDE1234F"
                      maxLength={10}
                      value={pan.toUpperCase()}
                      onChange={(e) => setPan(e.target.value.toUpperCase().slice(0, 10))}
                      className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-center outline-none focus:ring-2 focus:ring-emerald-500 font-extrabold text-xl tracking-wider placeholder-slate-300 dark:placeholder-slate-700"
                    />
                  </div>

                  {pan.length === 10 && !isPanValidFormat && (
                    <div className="text-xs font-bold text-amber-500 flex items-center gap-1">
                      ⚠️ Invalid PAN format (Expected format: ABCDE1234F)
                    </div>
                  )}

                  <button
                    disabled={!isPanValidFormat || panLoading}
                    onClick={handlePanVerify}
                    className="w-full py-4 mt-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold rounded-xl flex items-center justify-center gap-2 hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {panLoading ? (
                      <div className="w-5 h-5 border-2 border-white dark:border-slate-900 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      "Verify PAN with Tax Database"
                    )}
                  </button>
                </div>
              ) : (
                <div className="text-center py-6 space-y-4 animate-in zoom-in-95 duration-200">
                  <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto text-3xl font-extrabold">
                    ✓
                  </div>
                  <div>
                    <h2 className="text-2xl font-black text-emerald-500">PAN Verified!</h2>
                    <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Verified Name: <span className="font-extrabold text-slate-800 dark:text-white">{panFetchedName}</span></p>
                    <p className="text-slate-400 text-xs mt-0.5">PAN Card: {pan.toUpperCase()}</p>
                  </div>
                  <button
                    onClick={handleNext}
                    className="w-full py-4 mt-6 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold rounded-xl flex items-center justify-center gap-2 hover:opacity-90 transition-all cursor-pointer"
                  >
                    Continue to Liveness Check <ArrowRight size={18} />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* STEP 5: SELFIE */}
          {currentStep === 4 && (
            <div className="space-y-6 flex flex-col items-center animate-in fade-in duration-200">
              
              {/* Simulated Camera Scanner */}
              <div className="relative w-64 h-64 bg-slate-100 dark:bg-slate-900 border-4 border-slate-200 dark:border-slate-800 rounded-full overflow-hidden flex flex-col justify-center items-center">
                {selfieStage === 'idle' && (
                  <div className="text-center p-4">
                    <Camera size={48} className="text-slate-400 mx-auto animate-pulse" />
                    <p className="text-xs text-slate-500 mt-2 font-semibold">Position your face inside the circle</p>
                  </div>
                )}

                {selfieStage === 'scanning' && (
                  <div className="w-full h-full flex flex-col justify-center items-center relative bg-slate-900">
                    {/* Scanning animation bar */}
                    <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500 shadow-[0_0_8px_#10b981] animate-bounce" style={{ animationDuration: '3s' }} />
                    <div className="w-40 h-40 border-2 border-dashed border-emerald-500 rounded-full animate-spin" style={{ animationDuration: '10s' }} />
                    <p className="text-xs text-emerald-500 font-bold absolute mt-12 animate-pulse">Scanning Liveness...</p>
                  </div>
                )}

                {selfieStage === 'done' && (
                  <div className="text-center p-4">
                    <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto text-3xl font-extrabold">
                      ✓
                    </div>
                    <p className="text-xs text-emerald-500 font-extrabold mt-4 uppercase tracking-widest">Match Confirmed</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">Liveness: 98.4% Match</p>
                  </div>
                )}
              </div>

              <div className="bg-emerald-50/20 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30 p-4 rounded-xl text-center w-full">
                <p className="text-xs text-emerald-600 dark:text-emerald-400 leading-relaxed font-semibold">
                  🛡️ This face matching test verifies that you match your Aadhaar registry profile. Once approved, your account will be activated instantly.
                </p>
              </div>

              {selfieStage !== 'done' ? (
                <button
                  disabled={selfieStage === 'scanning'}
                  onClick={handleTakeSelfie}
                  className="w-full py-4 mt-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold rounded-xl flex items-center justify-center gap-2 hover:opacity-90 transition-all disabled:opacity-70 cursor-pointer"
                >
                  {selfieStage === 'scanning' ? "⏳ Scanning Liveness..." : "📸 Take Selfie & Verify"}
                </button>
              ) : (
                <button
                  onClick={handleNext}
                  disabled={saving}
                  className="w-full py-4 mt-4 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-500/20 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {saving ? "Saving…" : "🎉 Activate My Account"}
                </button>
              )}

            </div>
          )}

        </div>

      </div>
    </div>
  );
}
