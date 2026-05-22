"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, Map, Smartphone, Globe, ArrowRight, Lock, CheckCircle, Users } from 'lucide-react';
import AuthModal from '../components/AuthModal';

export default function RideShareGlobalLanding() {
  const router = useRouter();
  const [isAuthOpen, setAuthOpen] = useState(false);
  const [pendingRoute, setPendingRoute] = useState('');

  const handleLogin = (route: string) => {
    setPendingRoute(route);
    setAuthOpen(true);
  };

  const handleAuthSuccess = () => {
    setAuthOpen(false);
    router.push(pendingRoute);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 font-sans text-slate-800 dark:text-slate-200 overflow-x-hidden">
      <AuthModal isOpen={isAuthOpen} onClose={() => setAuthOpen(false)} onSuccess={handleAuthSuccess} />
      
      {/* Navigation Bar */}
      <nav className="fixed top-0 w-full bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 z-40 px-8 py-4 flex justify-between items-center">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 bg-teal-700 rounded-lg flex items-center justify-center text-white font-bold text-xl">R</div>
          <span className="text-xl font-black text-slate-800 dark:text-white tracking-tight">RideShare <span className="text-teal-700 dark:text-teal-500">Global</span></span>
        </div>
        <div className="hidden md:flex space-x-8 font-semibold text-sm">
          <a href="#how-it-works" className="hover:text-teal-700 transition-colors">How it Works</a>
          <a href="#safety" className="hover:text-teal-700 transition-colors">Safety</a>
          <a href="#coverage" className="hover:text-teal-700 transition-colors">Global Coverage</a>
        </div>
        <div className="flex space-x-4">
          <button onClick={() => handleLogin('/customer')} className="font-bold text-teal-700 dark:text-teal-400 hover:text-teal-800 px-4 py-2">Log In</button>
          <button onClick={() => handleLogin('/customer')} className="bg-teal-700 hover:bg-teal-800 text-white font-bold px-5 py-2 rounded-full shadow-lg shadow-teal-700/30 transition-transform hover:scale-105">Get the App</button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-8 max-w-7xl mx-auto flex flex-col lg:flex-row items-center gap-12 mt-10">
        <div className="flex-1 space-y-6 z-10">
          <div className="inline-flex items-center space-x-2 bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 font-bold px-4 py-1.5 rounded-full text-sm">
            <Globe size={16} /> <span>Now active in 20 countries</span>
          </div>
          <h1 className="text-5xl lg:text-7xl font-black leading-tight tracking-tight text-slate-900 dark:text-white">
            Commute <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-600 to-teal-400">Smarter.</span><br/>Together.
          </h1>
          <p className="text-lg text-slate-500 dark:text-slate-400 max-w-lg leading-relaxed">
            The world's most trusted carpool network. Split costs, reduce your carbon footprint, and travel securely with strict government ID-verified peers.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 pt-4">
            <button onClick={() => handleLogin('/customer')} className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold px-8 py-4 rounded-xl flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
              <Smartphone size={20} /> Download for iOS
            </button>
            <button onClick={() => handleLogin('/customer')} className="bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-white font-bold px-8 py-4 rounded-xl flex items-center justify-center gap-2 hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors">
              Download for Android
            </button>
          </div>
        </div>
        
        {/* Animated App Mockup */}
        <div className="flex-1 relative w-full max-w-md aspect-[9/16] bg-slate-100 dark:bg-slate-800 rounded-[3rem] border-[8px] border-slate-900 dark:border-slate-700 shadow-2xl overflow-hidden flex items-center justify-center">
          <div className="absolute top-0 w-full h-1/2 bg-teal-500/10"></div>
          <Map className="text-teal-700 opacity-20 absolute w-full h-full p-10" />
          
          <div className="z-10 w-4/5 bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-4 absolute bottom-20">
            <div className="flex items-center gap-4 mb-3">
              <div className="w-12 h-12 bg-slate-200 rounded-full"></div>
              <div>
                <p className="font-bold text-sm">Pooja Yadav <span className="text-teal-600">✓</span></p>
                <p className="text-xs text-slate-500">Tata Nexon EV • 3 Seats</p>
              </div>
            </div>
            <button className="w-full bg-teal-700 text-white font-bold text-sm py-2 rounded-lg">Instant Book - ₹150</button>
          </div>
        </div>
      </section>

      {/* How It Works - Horizontal Flow */}
      <section id="how-it-works" className="py-24 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl lg:text-4xl font-black mb-4">How RideShare Global Works</h2>
            <p className="text-slate-500 max-w-2xl mx-auto">Seamless matching backed by enterprise-grade technology.</p>
          </div>
          
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center relative">
            <div className="hidden md:block absolute top-1/2 left-0 w-full h-1 bg-slate-100 dark:bg-slate-800 -z-10 -translate-y-1/2"></div>
            
            <div className="bg-white dark:bg-slate-900 p-6 flex-1 text-center flex flex-col items-center">
              <div className="w-16 h-16 bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-400 rounded-2xl flex items-center justify-center mb-4 shadow-sm border border-teal-200 dark:border-teal-800/50"><Map size={32} /></div>
              <h3 className="font-bold text-lg mb-2">1. Search Route</h3>
              <p className="text-sm text-slate-500">Enter your destination and date. Our algorithm instantly finds overlapping routes.</p>
            </div>
            
            <div className="bg-white dark:bg-slate-900 p-6 flex-1 text-center flex flex-col items-center">
              <div className="w-16 h-16 bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-400 rounded-2xl flex items-center justify-center mb-4 shadow-sm border border-teal-200 dark:border-teal-800/50"><CheckCircle size={32} /></div>
              <h3 className="font-bold text-lg mb-2">2. Match & Book</h3>
              <p className="text-sm text-slate-500">Review verified profiles, select your driver, and book instantly. No haggling.</p>
            </div>
            
            <div className="bg-white dark:bg-slate-900 p-6 flex-1 text-center flex flex-col items-center">
              <div className="w-16 h-16 bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-400 rounded-2xl flex items-center justify-center mb-4 shadow-sm border border-teal-200 dark:border-teal-800/50"><Users size={32} /></div>
              <h3 className="font-bold text-lg mb-2">3. Ride Together</h3>
              <p className="text-sm text-slate-500">Meet at the pickup point, share the costs automatically, and save CO₂.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Safety Section */}
      <section id="safety" className="py-24 bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-8 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <h2 className="text-3xl lg:text-5xl font-black mb-6">Your Safety is our <span className="text-teal-400">Core Architecture.</span></h2>
            <p className="text-slate-400 text-lg mb-8 leading-relaxed">
              We do not compromise on security. From mandatory liveness checks to continuous route-deviation monitoring, RideShare Global is engineered to protect you.
            </p>
            <ul className="space-y-6">
              <li className="flex items-start gap-4">
                <ShieldCheck className="text-teal-400 shrink-0 mt-1" size={24} />
                <div>
                  <h4 className="font-bold text-lg">Strict KYC Verification</h4>
                  <p className="text-sm text-slate-400">Every user must pass Level 1 AI facial recognition. Drivers must upload Govt IDs and Vehicle Registration records.</p>
                </div>
              </li>
              <li className="flex items-start gap-4">
                <Lock className="text-teal-400 shrink-0 mt-1" size={24} />
                <div>
                  <h4 className="font-bold text-lg">In-Ride SOS & Call Masking</h4>
                  <p className="text-sm text-slate-400">Your real phone number is never exposed. An instant SOS button silently alerts emergency contacts and local authorities.</p>
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
                <span className="text-xs text-slate-400">Phone & Email Verified</span>
              </div>
              <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-xl border border-teal-800 shadow-[0_0_15px_rgba(20,184,166,0.1)]">
                <span className="font-bold text-teal-400 flex items-center gap-2">🥈 Silver</span>
                <span className="text-xs text-teal-200/50">Govt ID & Selfie Verified</span>
              </div>
              <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-xl border border-slate-700">
                <span className="font-bold text-yellow-500 flex items-center gap-2">🥇 Gold</span>
                <span className="text-xs text-slate-400">Background Checked</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Global Coverage Mockup */}
      <section id="coverage" className="py-24 bg-white dark:bg-slate-900 text-center">
        <h2 className="text-3xl lg:text-4xl font-black mb-4">Borderless Commuting</h2>
        <p className="text-slate-500 max-w-2xl mx-auto mb-12">Seamless multi-currency support and localized compliance across the Top 20 GDP nations.</p>
        <div className="max-w-5xl mx-auto bg-slate-50 dark:bg-slate-800 rounded-3xl h-96 flex items-center justify-center border border-slate-200 dark:border-slate-700 relative overflow-hidden">
           <Map size={200} className="text-slate-200 dark:text-slate-700 absolute" />
           <div className="z-10 grid grid-cols-2 md:grid-cols-4 gap-4 px-8 w-full">
             <div className="bg-white dark:bg-slate-900 py-3 rounded-lg font-bold shadow-sm text-sm border border-slate-100 dark:border-slate-700">United States</div>
             <div className="bg-white dark:bg-slate-900 py-3 rounded-lg font-bold shadow-sm text-sm border border-slate-100 dark:border-slate-700">United Kingdom</div>
             <div className="bg-white dark:bg-slate-900 py-3 rounded-lg font-bold shadow-sm text-sm border border-slate-100 dark:border-slate-700">Germany</div>
             <div className="bg-white dark:bg-slate-900 py-3 rounded-lg font-bold shadow-sm text-sm border border-slate-100 dark:border-slate-700">India</div>
             <div className="bg-white dark:bg-slate-900 py-3 rounded-lg font-bold shadow-sm text-sm border border-slate-100 dark:border-slate-700 opacity-60">Japan</div>
             <div className="bg-white dark:bg-slate-900 py-3 rounded-lg font-bold shadow-sm text-sm border border-slate-100 dark:border-slate-700 opacity-60">France</div>
             <div className="bg-white dark:bg-slate-900 py-3 rounded-lg font-bold shadow-sm text-sm border border-slate-100 dark:border-slate-700 opacity-60">Brazil</div>
             <div className="bg-white dark:bg-slate-900 py-3 rounded-lg font-bold shadow-sm text-sm border border-slate-100 dark:border-slate-700 opacity-60">+ 13 More</div>
           </div>
        </div>
      </section>

      {/* Footer / Portal Routing */}
      <footer className="bg-slate-950 py-12 px-8 text-slate-400 text-sm">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6 border-b border-slate-800 pb-8 mb-8">
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 bg-teal-700 rounded items-center justify-center text-white font-bold text-xs flex">R</div>
            <span className="font-black text-white tracking-tight">RideShare <span className="text-teal-500">Global</span></span>
          </div>
          <div className="flex space-x-6 font-bold">
            <a href="/partner" className="hover:text-white transition-colors">Fleet Partners Portal</a>
            <a href="/admin" className="hover:text-white transition-colors">Enterprise Admin Panel</a>
          </div>
        </div>
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <p>© 2026 RideShare Global Inc. All rights reserved.</p>
          <div className="flex space-x-4">
            <span>Privacy</span>
            <span>Terms</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
