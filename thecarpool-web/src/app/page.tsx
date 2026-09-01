"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck, Map, Smartphone, Globe, ArrowRight, Lock, CheckCircle, Users, Menu, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import AuthModal from '../components/AuthModal';

export default function TheCarPoolLanding() {
  const router = useRouter();
  const { user, loading, signOut } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authInitialMode, setAuthInitialMode] = useState<'choose' | 'phone'>('choose');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const openAuth = (mode: 'choose' | 'phone' = 'choose') => {
    setAuthInitialMode(mode);
    setAuthModalOpen(true);
  };

  // Auto-redirect to onboarding or customer portal once authenticated
  useEffect(() => {
    if (!loading && user) {
      const onboarded = localStorage.getItem(`thecarpool_onboarded_${user.uid}`);
      if (onboarded === 'true') {
        router.push('/customer');
      } else {
        router.push('/onboarding');
      }
    }
  }, [user, loading, router]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 font-sans text-slate-800 dark:text-slate-200 overflow-x-hidden">
      
      {/* Navigation Bar */}
      <nav className="fixed top-0 w-full bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 z-40 px-6 md:px-8 py-4 flex justify-between items-center">
        <Link href="/" className="flex items-center space-x-2">
          <img src="/logo.png" alt="TheCarPool logo" className="w-9 h-9" />
          <span className="text-xl font-black text-slate-800 dark:text-white tracking-tight">TheCar<span className="text-teal-700 dark:text-teal-500">Pool</span></span>
        </Link>
        
        <div className="hidden md:flex space-x-8 font-semibold text-sm">
          <a href="#how-it-works" className="hover:text-teal-700 dark:hover:text-teal-400 transition-colors">How it Works</a>
          <a href="#safety" className="hover:text-teal-700 dark:hover:text-teal-400 transition-colors">Safety</a>
          <a href="#coverage" className="hover:text-teal-700 dark:hover:text-teal-400 transition-colors">Global Coverage</a>
        </div>
        
        <div className="hidden md:flex space-x-4 items-center">
          {loading ? (
            <div className="h-9 w-24 bg-slate-200 dark:bg-slate-800 rounded-full animate-pulse" />
          ) : !user ? (
            <>
              <button onClick={() => openAuth('choose')} className="font-bold text-teal-700 dark:text-teal-400 hover:text-teal-800 px-4 py-2 cursor-pointer transition-colors">Log In</button>
              <button onClick={() => openAuth('phone')} className="bg-teal-700 hover:bg-teal-800 text-white font-bold px-5 py-2 rounded-full shadow-lg shadow-teal-700/30 transition-transform hover:scale-105 cursor-pointer">Get Started</button>
            </>
          ) : (
            <>
              <button onClick={() => router.push('/customer')} className="font-bold text-teal-700 dark:text-teal-400 hover:text-teal-800 px-4 py-2 cursor-pointer">Dashboard</button>
              <button onClick={() => signOut()} className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 px-3 py-1.5 border border-slate-300 dark:border-slate-700 rounded-full transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">Sign Out</button>
            </>
          )}
        </div>

        {/* Mobile Menu Button */}
        <div className="md:hidden flex items-center gap-2">
          {!user ? (
            <button onClick={() => openAuth('choose')} className="bg-teal-700 text-white font-bold text-xs px-3.5 py-1.5 rounded-full shadow-sm">
              Sign In
            </button>
          ) : (
            <button onClick={() => router.push('/customer')} className="bg-teal-700 text-white font-bold text-xs px-3.5 py-1.5 rounded-full shadow-sm">
              Dashboard
            </button>
          )}
          <button 
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </nav>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-x-0 top-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-6 z-30 flex flex-col space-y-4 md:hidden shadow-xl animate-in slide-in-from-top-2">
          <a href="#how-it-works" onClick={() => setMobileMenuOpen(false)} className="font-semibold text-slate-700 dark:text-slate-200 py-2 border-b border-slate-100 dark:border-slate-800">How it Works</a>
          <a href="#safety" onClick={() => setMobileMenuOpen(false)} className="font-semibold text-slate-700 dark:text-slate-200 py-2 border-b border-slate-100 dark:border-slate-800">Safety</a>
          <a href="#coverage" onClick={() => setMobileMenuOpen(false)} className="font-semibold text-slate-700 dark:text-slate-200 py-2 border-b border-slate-100 dark:border-slate-800">Global Coverage</a>
          <div className="pt-2 flex flex-col gap-2">
            <Link href="/partner" className="text-sm font-semibold text-teal-700 dark:text-teal-400">Fleet Partners Portal →</Link>
            <Link href="/admin" className="text-sm font-semibold text-slate-500 dark:text-slate-400">Enterprise Admin Panel →</Link>
          </div>
        </div>
      )}

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-6 md:px-8 max-w-7xl mx-auto flex flex-col lg:flex-row items-center gap-12 mt-6">
        <div className="flex-1 space-y-6 z-10">
          <div className="inline-flex items-center space-x-2 bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 font-bold px-4 py-1.5 rounded-full text-sm">
            <Globe size={16} /> <span>Built for daily commuters</span>
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-7xl font-black leading-tight tracking-tight text-slate-900 dark:text-white">
            Commute <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-600 to-teal-400">Smarter.</span><br/>Together.
          </h1>
          <p className="text-lg text-slate-600 dark:text-slate-300 max-w-lg leading-relaxed">
            Split costs, cut your carbon footprint, and share the drive with verified corporate commuters on your route.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 pt-4">
            {loading ? (
              <div className="h-14 w-48 bg-slate-200 dark:bg-slate-800 rounded-xl animate-pulse" />
            ) : !user ? (
              <button onClick={() => openAuth('choose')} className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold px-8 py-4 rounded-xl flex items-center justify-center gap-2 hover:opacity-90 transition-opacity cursor-pointer shadow-lg shadow-slate-900/10">
                <Smartphone size={20} /> Get Started with TheCarPool
              </button>
            ) : (
              <button onClick={() => router.push('/customer')} className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold px-8 py-4 rounded-xl flex items-center justify-center gap-2 hover:opacity-90 transition-opacity cursor-pointer shadow-lg shadow-slate-900/10">
                Go to Dashboard <ArrowRight size={20} />
              </button>
            )}
          </div>
        </div>
        
        {/* Animated App Mockup */}
        <div className="flex-1 relative w-full max-w-md aspect-[9/16] bg-slate-100 dark:bg-slate-800 rounded-[3rem] border-[8px] border-slate-900 dark:border-slate-700 shadow-2xl overflow-hidden flex items-center justify-center">
          <div className="absolute top-0 w-full h-1/2 bg-teal-500/10"></div>
          <Map className="text-teal-700 opacity-20 absolute w-full h-full p-10" />
          
          <div className="z-10 w-4/5 bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-4 absolute bottom-20 border border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-4 mb-3">
              <div className="w-12 h-12 bg-teal-100 dark:bg-teal-900/50 rounded-full flex items-center justify-center font-bold text-teal-800 dark:text-teal-300 text-sm">
                PY
              </div>
              <div>
                <p className="font-bold text-sm text-slate-900 dark:text-white">Pooja Yadav <span className="text-teal-600">✓</span></p>
                <p className="text-xs text-slate-500">Tata Nexon EV • 3 Seats</p>
              </div>
            </div>
            <button onClick={() => openAuth('choose')} className="w-full bg-teal-700 hover:bg-teal-800 text-white font-bold text-sm py-2.5 rounded-lg cursor-pointer transition-colors">Instant Book - ₹150</button>
          </div>
        </div>
      </section>

      {/* How It Works - Horizontal Flow */}
      <section id="how-it-works" className="py-24 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl lg:text-4xl font-black mb-4">How TheCarPool Works</h2>
            <p className="text-slate-600 dark:text-slate-400 max-w-2xl mx-auto">Seamless matching backed by enterprise-grade technology.</p>
          </div>
          
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center relative gap-8 md:gap-4">
            <div className="hidden md:block absolute top-1/2 left-0 w-full h-1 bg-slate-100 dark:bg-slate-800 -z-10 -translate-y-1/2"></div>
            
            <div className="bg-white dark:bg-slate-900 p-6 flex-1 text-center flex flex-col items-center">
              <div className="w-16 h-16 bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-400 rounded-2xl flex items-center justify-center mb-4 shadow-sm border border-teal-200 dark:border-teal-800/50"><Map size={32} /></div>
              <h3 className="font-bold text-lg mb-2">1. Search Route</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">Enter your destination and date. Our algorithm instantly finds overlapping routes.</p>
            </div>
            
            <div className="bg-white dark:bg-slate-900 p-6 flex-1 text-center flex flex-col items-center">
              <div className="w-16 h-16 bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-400 rounded-2xl flex items-center justify-center mb-4 shadow-sm border border-teal-200 dark:border-teal-800/50"><CheckCircle size={32} /></div>
              <h3 className="font-bold text-lg mb-2">2. Match & Book</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">Review verified profiles, select your driver, and book instantly. No haggling.</p>
            </div>
            
            <div className="bg-white dark:bg-slate-900 p-6 flex-1 text-center flex flex-col items-center">
              <div className="w-16 h-16 bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-400 rounded-2xl flex items-center justify-center mb-4 shadow-sm border border-teal-200 dark:border-teal-800/50"><Users size={32} /></div>
              <h3 className="font-bold text-lg mb-2">3. Ride Together</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">Meet at the pickup point, share the costs automatically, and save CO₂.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Safety Section */}
      <section id="safety" className="py-24 bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-8 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <h2 className="text-3xl lg:text-5xl font-black mb-6">Your Safety is our <span className="text-teal-400">Core Architecture.</span></h2>
            <p className="text-slate-300 text-lg mb-8 leading-relaxed">
              From in-ride SOS and number masking to continuous route-deviation monitoring, TheCarPool is engineered to protect you.
            </p>
            <ul className="space-y-6">
              <li className="flex items-start gap-4">
                <ShieldCheck className="text-teal-400 shrink-0 mt-1" size={24} />
                <div>
                  <h4 className="font-bold text-lg">Ratings-Based Trust</h4>
                  <p className="text-sm text-slate-400">Every trip is rated by both sides. Trust badges are earned from real completed rides, and higher-rated drivers rank first in your matches.</p>
                </div>
              </li>
              <li className="flex items-start gap-4">
                <Lock className="text-teal-400 shrink-0 mt-1" size={24} />
                <div>
                  <h4 className="font-bold text-lg">In-Ride SOS & Call Masking</h4>
                  <p className="text-sm text-slate-400">Your real phone number is never exposed. An instant SOS button alerts emergency contacts and local authorities.</p>
                </div>
              </li>
            </ul>
          </div>
          
          {/* Trust Badge Visualizer */}
          <div className="bg-slate-800 border border-slate-700 rounded-3xl p-8 relative overflow-hidden shadow-2xl">
            <div className="absolute -top-20 -right-20 w-64 h-64 bg-teal-500/20 blur-3xl rounded-full"></div>
            <h3 className="text-sm font-bold text-teal-400 uppercase tracking-widest mb-6">Tiered Trust Badges</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-xl border border-slate-700">
                <span className="font-bold flex items-center gap-2">🥉 Bronze</span>
                <span className="text-xs text-slate-400">1+ rated trip</span>
              </div>
              <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-xl border border-teal-800 shadow-[0_0_15px_rgba(20,184,166,0.1)]">
                <span className="font-bold text-teal-400 flex items-center gap-2">🥈 Silver</span>
                <span className="text-xs text-teal-300">10+ trips, 4.0+ rating</span>
              </div>
              <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-xl border border-slate-700">
                <span className="font-bold text-yellow-500 flex items-center gap-2">🥇 Gold</span>
                <span className="text-xs text-slate-400">25+ trips, 4.5+ rating</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Global Coverage Mockup */}
      <section id="coverage" className="py-24 bg-white dark:bg-slate-900 text-center">
        <h2 className="text-3xl lg:text-4xl font-black mb-4">Built to Travel</h2>
        <p className="text-slate-600 dark:text-slate-400 max-w-2xl mx-auto mb-12">Multi-currency and localized formatting are in place, so new markets can open seamlessly.</p>
        <div className="max-w-5xl mx-auto bg-slate-50 dark:bg-slate-800 rounded-3xl min-h-[22rem] py-12 flex items-center justify-center border border-slate-200 dark:border-slate-700 relative overflow-hidden">
           <Map size={200} className="text-slate-200 dark:text-slate-700 absolute" />
           <div className="z-10 grid grid-cols-2 md:grid-cols-4 gap-4 px-8 w-full">
             <div className="bg-white dark:bg-slate-900 py-3 rounded-lg font-bold shadow-sm text-sm border border-slate-100 dark:border-slate-700">United States</div>
             <div className="bg-white dark:bg-slate-900 py-3 rounded-lg font-bold shadow-sm text-sm border border-slate-100 dark:border-slate-700">United Kingdom</div>
             <div className="bg-white dark:bg-slate-900 py-3 rounded-lg font-bold shadow-sm text-sm border border-slate-100 dark:border-slate-700">Germany</div>
             <div className="bg-white dark:bg-slate-900 py-3 rounded-lg font-bold shadow-sm text-sm border border-slate-100 dark:border-slate-700">India</div>
             <div className="bg-white dark:bg-slate-900 py-3 rounded-lg font-bold shadow-sm text-sm border border-slate-100 dark:border-slate-700 text-slate-500">Japan</div>
             <div className="bg-white dark:bg-slate-900 py-3 rounded-lg font-bold shadow-sm text-sm border border-slate-100 dark:border-slate-700 text-slate-500">France</div>
             <div className="bg-white dark:bg-slate-900 py-3 rounded-lg font-bold shadow-sm text-sm border border-slate-100 dark:border-slate-700 text-slate-500">Brazil</div>
             <div className="bg-white dark:bg-slate-900 py-3 rounded-lg font-bold shadow-sm text-sm border border-slate-100 dark:border-slate-700 text-slate-500">+ 13 More</div>
           </div>
        </div>
      </section>

      {/* Footer / Portal Routing */}
      <footer className="bg-slate-950 py-12 px-8 text-slate-400 text-sm">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6 border-b border-slate-800 pb-8 mb-8">
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 bg-teal-700 rounded items-center justify-center text-white font-bold text-xs flex">T</div>
            <span className="font-black text-white tracking-tight">TheCar<span className="text-teal-500">Pool</span></span>
          </div>
          <div className="flex flex-wrap gap-6 font-bold">
            <Link href="/partner" className="hover:text-white transition-colors">Fleet Partners Portal</Link>
            <Link href="/admin" className="hover:text-white transition-colors">Enterprise Admin Panel</Link>
            <Link href="/support" className="hover:text-white transition-colors">Help &amp; Support</Link>
          </div>
        </div>
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <p>© 2026 TheCarPool Inc. All rights reserved.</p>
          <div className="flex space-x-4">
            <Link href="/privacy" className="hover:text-white transition-colors">Privacy</Link>
            <Link href="/privacy" className="hover:text-white transition-colors">Terms</Link>
          </div>
        </div>
      </footer>

      {/* Auth Modal Component */}
      <AuthModal
        isOpen={authModalOpen}
        initialMode={authInitialMode}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={() => {
          setAuthModalOpen(false);
          router.push('/onboarding');
        }}
      />
    </div>
  );
}
