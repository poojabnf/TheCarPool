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
  Check, 
  ArrowRight, 
  Car,
  UserCheck,
  ShieldCheck,
  ArrowLeft
} from "lucide-react";

const TOTAL_STEPS = 2;
const STEP_LABELS = ['Role', 'Profile'];
const STEP_DESCRIPTIONS = [
  'Choose how you want to use the app',
  'Tell us about yourself',
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

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

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

        // Check localStorage or server-side flag
        const localFlag = localStorage.getItem(`thecarpool_onboarded_${user.uid}`);
        if (localFlag === 'true') {
          router.push("/customer");
          return;
        }

        (async () => {
          try {
            const res = await apiFetch("/api/users/me");
            if (res.ok) {
              const data = await res.json();
              if (data.onboarded === true) {
                localStorage.setItem(`thecarpool_onboarded_${user.uid}`, 'true');
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
      setSaveError("");
      try {
        const res = await apiFetch("/api/users/profile", {
          method: "POST",
          body: JSON.stringify({ name, company, employeeId, workLocation, role }),
        });
        if (!res.ok) throw new Error(`Save failed (${res.status})`);
        
        // Authoritatively set localStorage flag to prevent landing page bounce loop
        localStorage.setItem(`thecarpool_onboarded_${user.uid}`, 'true');
      } catch (err: any) {
        setSaveError(err.message || "We couldn't save your profile. Please check your connection and try again.");
        setSaving(false);
        return;
      }
      setSaving(false);
    }
    
    if (role === 'partner') {
      router.push("/partner");
    } else {
      router.push("/customer");
    }
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col justify-center items-center">
        <div className="w-12 h-12 border-4 border-teal-600 border-t-transparent rounded-full animate-spin"></div>
        <p className="mt-4 text-slate-600 dark:text-slate-400 font-semibold animate-pulse text-sm">Verifying profile...</p>
      </div>
    );
  }

  const isProfileValid = name.trim().length > 1 && company.trim().length > 1;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-sans py-12 px-4 sm:px-6 lg:px-8 flex flex-col justify-center items-center">
      <div className="max-w-2xl w-full space-y-6 bg-white dark:bg-slate-800 p-8 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-2xl relative overflow-hidden">
        
        {/* Progress Bar Header */}
        <div className="flex justify-between items-center pb-6 border-b border-slate-100 dark:border-slate-700">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-teal-700 dark:text-teal-400">Account Setup</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-semibold">Join verified corporate commuters</p>
          </div>
          <span className="text-xs font-bold text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/40 px-3 py-1.5 rounded-full border border-teal-200 dark:border-teal-800/40">
            Step {currentStep + 1} of {TOTAL_STEPS}
          </span>
        </div>

        {/* Progress Step Nodes */}
        <div className="flex items-center justify-between px-2 py-2">
          {Array(TOTAL_STEPS).fill(0).map((_, i) => {
            const isCompleted = i < currentStep;
            const isActive = i === currentStep;
            return (
              <React.Fragment key={i}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs border transition-all ${
                  isCompleted ? "bg-teal-600 border-teal-600 text-white" :
                  isActive ? "bg-teal-50 dark:bg-teal-900/50 border-teal-600 text-teal-700 dark:text-teal-400 scale-110 shadow-lg shadow-teal-600/10" :
                  "bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-400"
                }`}>
                  {isCompleted ? <Check size={14} strokeWidth={3} /> : i + 1}
                </div>
                {i < TOTAL_STEPS - 1 && (
                  <div className={`flex-1 h-1 mx-2 rounded-full transition-colors ${
                    i < currentStep ? "bg-teal-600" : "bg-slate-200 dark:bg-slate-800"
                  }`} />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Step Intro Card */}
        <div className="flex items-center space-x-4 bg-slate-50 dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-100 dark:border-slate-800">
          <div className="w-10 h-10 bg-teal-100 dark:bg-teal-900/40 rounded-xl flex items-center justify-center text-teal-700 dark:text-teal-400">
            {currentStep === 0 ? <Car size={20} /> : <UserCheck size={20} />}
          </div>
          <div>
            <h3 className="font-extrabold text-slate-800 dark:text-white text-sm uppercase tracking-wider">{STEP_LABELS[currentStep]}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{STEP_DESCRIPTIONS[currentStep]}</p>
          </div>
        </div>

        {/* Dynamic Wizard Steps */}
        <div className="mt-6 min-h-[280px]">
          
          {/* STEP 1: ROLE */}
          {currentStep === 0 && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div className="text-center">
                <h2 className="text-xl font-bold text-slate-800 dark:text-white">Choose Your Commute Role</h2>
                <p className="text-slate-500 text-sm mt-1">Select your primary mode. You can change this anytime later.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2" role="radiogroup" aria-label="Select commute role">
                <button 
                  role="radio"
                  aria-checked={role === 'rider'}
                  onClick={() => setRole('rider')}
                  className={`p-6 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                    role === 'rider' 
                    ? 'border-teal-600 bg-teal-50/40 dark:bg-teal-950/20 shadow-md shadow-teal-600/10' 
                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  <div className="w-10 h-10 bg-teal-100 dark:bg-teal-900/50 rounded-xl flex items-center justify-center text-teal-700 dark:text-teal-400 mb-3">
                    <UserCheck size={20} />
                  </div>
                  <h3 className="font-extrabold text-base text-slate-800 dark:text-white">Rider</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Book rides, join pools, and split costs. Perfect for daily office commutes.</p>
                </button>
                <button 
                  role="radio"
                  aria-checked={role === 'partner'}
                  onClick={() => setRole('partner')}
                  className={`p-6 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                    role === 'partner' 
                    ? 'border-teal-600 bg-teal-50/40 dark:bg-teal-950/20 shadow-md shadow-teal-600/10' 
                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  <div className="w-10 h-10 bg-teal-100 dark:bg-teal-900/50 rounded-xl flex items-center justify-center text-teal-700 dark:text-teal-400 mb-3">
                    <Car size={20} />
                  </div>
                  <h3 className="font-extrabold text-base text-slate-800 dark:text-white">Partner / Driver</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Offer spare seats in your vehicle, set recurring routes, and split fuel costs.</p>
                </button>
              </div>
              <button
                disabled={!role}
                onClick={handleNext}
                className={`w-full py-4 mt-6 bg-teal-700 hover:bg-teal-800 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-teal-700/20 ${
                  !role ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                Continue <ArrowRight size={18} />
              </button>
            </div>
          )}

          {/* STEP 2: PROFILE */}
          {currentStep === 1 && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label htmlFor="ob-fullname" className="block text-xs font-bold text-slate-500 uppercase mb-2">Full Name *</label>
                  <div className="relative">
                    <User className="absolute left-4 top-3.5 text-slate-400" size={18} />
                    <input 
                      id="ob-fullname"
                      required
                      type="text" 
                      placeholder="e.g. Pooja Yadav"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full pl-12 pr-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-teal-500 font-semibold text-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="ob-company" className="block text-xs font-bold text-slate-500 uppercase mb-2">Company / Corporate Employer *</label>
                  <div className="relative">
                    <Building className="absolute left-4 top-3.5 text-slate-400" size={18} />
                    <input 
                      id="ob-company"
                      required
                      type="text" 
                      placeholder="e.g. Google, TCS, Infosys"
                      value={company}
                      onChange={(e) => setCompany(e.target.value)}
                      className="w-full pl-12 pr-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-teal-500 font-semibold text-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="ob-empid" className="block text-xs font-bold text-slate-500 uppercase mb-2">Employee ID (Optional)</label>
                    <div className="relative">
                      <Briefcase className="absolute left-4 top-3.5 text-slate-400" size={18} />
                      <input 
                        id="ob-empid"
                        type="text" 
                        placeholder="e.g. 9847192"
                        value={employeeId}
                        onChange={(e) => setEmployeeId(e.target.value)}
                        className="w-full pl-12 pr-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-teal-500 font-semibold text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="ob-location" className="block text-xs font-bold text-slate-500 uppercase mb-2">Work Location / City Hub</label>
                    <div className="relative">
                      <MapPin className="absolute left-4 top-3.5 text-slate-400" size={18} />
                      <input 
                        id="ob-location"
                        type="text" 
                        placeholder="e.g. Cyber City, Gurugram"
                        value={workLocation}
                        onChange={(e) => setWorkLocation(e.target.value)}
                        className="w-full pl-12 pr-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-teal-500 font-semibold text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setCurrentStep(0)}
                  className="px-5 py-4 border border-slate-200 dark:border-slate-700 font-bold rounded-xl flex items-center justify-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer text-slate-600 dark:text-slate-300"
                >
                  <ArrowLeft size={16} /> Back
                </button>
                <button
                  disabled={!isProfileValid || saving}
                  onClick={handleNext}
                  className={`flex-1 py-4 bg-teal-700 hover:bg-teal-800 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-teal-700/20 ${
                    !isProfileValid || saving ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  {saving ? 'Saving Profile…' : <>Complete Setup <ArrowRight size={18} /></>}
                </button>
              </div>

              {saveError && (
                <p className="mt-3 text-xs text-red-500 text-center font-semibold">{saveError}</p>
              )}
            </div>
          )}

        </div>

      </div>
    </div>
  );
}
