"use client";

import React, { useState } from "react";
import { UploadCloud, CheckCircle, CarFront, ShieldCheck, Globe, Activity, Wallet, CreditCard, Settings, HelpCircle } from "lucide-react";

const TOP_20_COUNTRIES = [
  "United States", "China", "Germany", "Japan", "India", "United Kingdom", "France", "Italy", "Brazil", "Canada",
  "Russia", "Mexico", "South Korea", "Australia", "Spain", "Indonesia", "Turkey", "Netherlands", "Saudi Arabia", "Switzerland"
];

export default function VendorDashboard() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [rcStatus, setRcStatus] = useState("PENDING");
  const [insStatus, setInsStatus] = useState("PENDING");
  const [permitStatus, setPermitStatus] = useState("PENDING");

  const simulateUpload = (setter: React.Dispatch<React.SetStateAction<string>>) => {
    setter("UPLOADING");
    setTimeout(() => setter("VERIFIED"), 2000);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex">
      
      {/* Sidebar Navigation */}
      <aside className="w-64 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 p-6 flex flex-col">
        <h2 className="text-2xl font-extrabold text-orange-600 mb-8 tracking-tight">Fleet Portal</h2>
        
        <nav className="space-y-2 flex-1">
          <NavItem icon={<Activity />} label="Fleet Overview" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
          <NavItem icon={<Wallet />} label="Earnings Wallet" active={activeTab === 'wallet'} onClick={() => setActiveTab('wallet')} />
          <NavItem icon={<CreditCard />} label="Payout Methods" active={activeTab === 'payments'} onClick={() => setActiveTab('payments')} />
          <NavItem icon={<Settings />} label="Fleet Settings" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
          <NavItem icon={<HelpCircle />} label="Partner Support" active={activeTab === 'help'} onClick={() => setActiveTab('help')} />
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-8 overflow-y-auto">
        
        {/* TAB: DASHBOARD (Original View) */}
        {activeTab === 'dashboard' && (
          <div className="max-w-6xl mx-auto space-y-8">
            <header className="mb-10">
              <h1 className="text-3xl font-bold text-slate-800 dark:text-white">Global Fleet Partner Portal</h1>
              <p className="text-slate-500 dark:text-slate-400 mt-2">Onboard vehicles globally and submit mandatory compliance documents for approval.</p>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Car Onboarding Form */}
              <div className="glass-panel p-8 rounded-3xl space-y-6">
                <div className="flex items-center space-x-3 mb-6">
                  <CarFront className="text-orange-500" size={28} />
                  <h2 className="text-xl font-bold text-slate-800 dark:text-white">Onboard New Vehicle</h2>
                </div>
                
                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Country of Operation *</label>
                    <div className="relative">
                      <Globe className="absolute left-3 top-3.5 text-slate-400" size={18} />
                      <select defaultValue="" className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-800/50 appearance-none focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-700 dark:text-slate-300 font-medium">
                        <option value="" disabled>Select Country</option>
                        {TOP_20_COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Vehicle License Plate *</label>
                    <input type="text" placeholder="e.g. MH 04 EV 1234" className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-800/50 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-700 dark:text-slate-300 font-medium" />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Vehicle Model *</label>
                    <input type="text" placeholder="e.g. Tata Nexon EV" className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-800/50 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-700 dark:text-slate-300 font-medium" />
                  </div>

                  <div className="flex items-center space-x-3 pt-2">
                    <input type="checkbox" id="ev" className="w-5 h-5 text-orange-500 rounded border-slate-300 focus:ring-orange-500" defaultChecked />
                    <label htmlFor="ev" className="text-sm font-medium text-slate-700 dark:text-slate-300">This is a zero-emission Electric Vehicle (EV)</label>
                  </div>

                  <button className="w-full py-4 mt-4 bg-slate-800 dark:bg-white text-white dark:text-slate-900 font-bold rounded-xl hover:bg-slate-700 dark:hover:bg-slate-100 transition-colors">
                    Save Vehicle Profile
                  </button>
                </div>
              </div>

              {/* Strict Document Uploads */}
              <div className="glass-panel p-8 rounded-3xl space-y-6 flex flex-col">
                <div className="flex items-center space-x-3 mb-2">
                  <ShieldCheck className="text-emerald-500" size={28} />
                  <h2 className="text-xl font-bold text-slate-800 dark:text-white">Mandatory Compliance</h2>
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">You must upload the following 3 documents before this vehicle can accept rides.</p>

                <div className="space-y-4 flex-1">
                  <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 bg-white/30 dark:bg-slate-800/30 flex justify-between items-center">
                    <div>
                      <h3 className="font-bold text-slate-800 dark:text-white text-sm">Vehicle Registration (RC)</h3>
                      <p className="text-xs text-slate-500">Official Govt. Registration</p>
                    </div>
                    {rcStatus === "PENDING" && <button onClick={() => simulateUpload(setRcStatus)} className="px-4 py-2 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 text-xs font-bold rounded-lg hover:bg-emerald-100">Upload</button>}
                    {rcStatus === "UPLOADING" && <span className="text-xs font-bold text-orange-500 animate-pulse">Uploading...</span>}
                    {rcStatus === "VERIFIED" && <CheckCircle className="text-emerald-500" size={24} />}
                  </div>

                  <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 bg-white/30 dark:bg-slate-800/30 flex justify-between items-center">
                    <div>
                      <h3 className="font-bold text-slate-800 dark:text-white text-sm">Commercial Insurance</h3>
                      <p className="text-xs text-slate-500">Valid Comprehensive Policy</p>
                    </div>
                    {insStatus === "PENDING" && <button onClick={() => simulateUpload(setInsStatus)} className="px-4 py-2 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 text-xs font-bold rounded-lg hover:bg-emerald-100">Upload</button>}
                    {insStatus === "UPLOADING" && <span className="text-xs font-bold text-orange-500 animate-pulse">Uploading...</span>}
                    {insStatus === "VERIFIED" && <CheckCircle className="text-emerald-500" size={24} />}
                  </div>

                  <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 bg-white/30 dark:bg-slate-800/30 flex justify-between items-center">
                    <div>
                      <h3 className="font-bold text-slate-800 dark:text-white text-sm">State/Country Permit</h3>
                      <p className="text-xs text-slate-500">Authorization to operate</p>
                    </div>
                    {permitStatus === "PENDING" && <button onClick={() => simulateUpload(setPermitStatus)} className="px-4 py-2 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 text-xs font-bold rounded-lg hover:bg-emerald-100">Upload</button>}
                    {permitStatus === "UPLOADING" && <span className="text-xs font-bold text-orange-500 animate-pulse">Uploading...</span>}
                    {permitStatus === "VERIFIED" && <CheckCircle className="text-emerald-500" size={24} />}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB: WALLET */}
        {activeTab === 'wallet' && (
          <div className="max-w-4xl mx-auto space-y-8">
            <h1 className="text-3xl font-bold text-slate-800 dark:text-white mb-6">Fleet Earnings</h1>
            <div className="glass-panel p-8 rounded-3xl flex justify-between items-center bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/20 border-orange-100 dark:border-orange-800/30">
              <div>
                <p className="text-sm font-semibold text-orange-600 dark:text-orange-400 uppercase tracking-wider mb-1">Total Balance</p>
                <h2 className="text-5xl font-black text-slate-800 dark:text-white">₹45,250.00</h2>
              </div>
              <button className="bg-orange-500 hover:bg-orange-600 text-white font-bold px-8 py-4 rounded-xl shadow-lg shadow-orange-200 dark:shadow-none transition-all">
                Withdraw Funds
              </button>
            </div>
          </div>
        )}

        {/* TAB: PAYMENTS */}
        {activeTab === 'payments' && (
          <div className="max-w-4xl mx-auto space-y-8">
            <h1 className="text-3xl font-bold text-slate-800 dark:text-white mb-6">Payout Methods</h1>
            <div className="glass-panel p-6 rounded-2xl border-2 border-orange-500 relative max-w-md">
              <div className="absolute top-4 right-4 bg-orange-100 text-orange-700 text-xs font-bold px-2 py-1 rounded">ACTIVE</div>
              <CreditCard className="text-slate-700 dark:text-slate-300 mb-4" size={32} />
              <p className="text-lg font-bold text-slate-800 dark:text-white">HDFC Bank Account</p>
              <p className="text-slate-500 text-sm">•••• 5678</p>
            </div>
          </div>
        )}

        {/* TAB: SETTINGS & HELP */}
        {(activeTab === 'settings' || activeTab === 'help') && (
          <div className="max-w-4xl mx-auto flex items-center justify-center h-64 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-3xl">
            <p className="text-slate-500 text-lg">Under Construction</p>
          </div>
        )}

      </main>
    </div>
  );
}

function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all ${active ? 'bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 font-bold' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 font-medium'}`}
    >
      <div className={active ? 'text-orange-500' : 'text-slate-400'}>{icon}</div>
      <span>{label}</span>
    </button>
  );
}
