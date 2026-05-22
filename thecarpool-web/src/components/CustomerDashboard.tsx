"use client";

import React, { useState } from "react";
import { Leaf, MapPin, Navigation, Map as MapIcon, CreditCard, Wallet, Settings, HelpCircle, Activity } from "lucide-react";

export default function CustomerDashboard() {
  const [activeTab, setActiveTab] = useState('dashboard');

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex">
      
      {/* Sidebar Navigation */}
      <aside className="w-64 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 p-6 flex flex-col">
        <h2 className="text-2xl font-extrabold text-emerald-600 mb-8 tracking-tight">TheCarPool</h2>
        
        <nav className="space-y-2 flex-1">
          <NavItem icon={<Activity />} label="Overview" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
          <NavItem icon={<Wallet />} label="Wallet" active={activeTab === 'wallet'} onClick={() => setActiveTab('wallet')} />
          <NavItem icon={<CreditCard />} label="Payments" active={activeTab === 'payments'} onClick={() => setActiveTab('payments')} />
          <NavItem icon={<Settings />} label="Settings" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
          <NavItem icon={<HelpCircle />} label="Help & Support" active={activeTab === 'help'} onClick={() => setActiveTab('help')} />
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-8 overflow-y-auto">
        
        {/* TAB: DASHBOARD (Original View) */}
        {activeTab === 'dashboard' && (
          <div className="max-w-4xl mx-auto space-y-8">
            <header className="mb-10">
              <h1 className="text-3xl font-bold text-slate-800 dark:text-white">Customer Portal</h1>
              <p className="text-slate-500 dark:text-slate-400 mt-2">Manage your commutes and track your carbon footprint.</p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* ESG Widget */}
              <div className="glass-panel p-8 rounded-3xl flex flex-col justify-center items-center text-center">
                <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/40 rounded-full flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-4">
                  <Leaf size={32} />
                </div>
                <h2 className="text-3xl font-black text-slate-800 dark:text-white">24.5 kg</h2>
                <p className="text-slate-500 dark:text-slate-400 font-medium">CO₂ Saved this Month</p>
              </div>

              {/* Quick Action Widget */}
              <div className="glass-panel p-8 rounded-3xl space-y-4">
                <h3 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                  <Navigation size={20} className="text-blue-500" /> Quick Commute
                </h3>
                <div className="space-y-3">
                  <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-100 dark:border-slate-700">
                    <MapPin size={18} className="text-slate-400" />
                    <span className="text-slate-600 dark:text-slate-300 font-medium">Home (Sector 44)</span>
                  </div>
                  <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-100 dark:border-slate-700">
                    <MapIcon size={18} className="text-slate-400" />
                    <span className="text-slate-600 dark:text-slate-300 font-medium">Office (Cyber Hub)</span>
                  </div>
                </div>
                <button className="w-full mt-2 bg-slate-800 dark:bg-white text-white dark:text-slate-900 font-bold py-3 rounded-xl hover:bg-slate-700 dark:hover:bg-slate-100 transition-colors">
                  Find Ride
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB: WALLET */}
        {activeTab === 'wallet' && (
          <div className="max-w-4xl mx-auto space-y-8">
            <h1 className="text-3xl font-bold text-slate-800 dark:text-white mb-6">TheCarPool Wallet</h1>
            <div className="glass-panel p-8 rounded-3xl flex justify-between items-center bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/20 border-emerald-100 dark:border-emerald-800/30">
              <div>
                <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-1">Available Balance</p>
                <h2 className="text-5xl font-black text-slate-800 dark:text-white">₹1,250.00</h2>
              </div>
              <button className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold px-8 py-4 rounded-xl shadow-lg shadow-emerald-200 dark:shadow-none transition-all">
                + Add Funds
              </button>
            </div>
            
            <h3 className="text-xl font-bold text-slate-800 dark:text-white mt-8 mb-4">Recent Transactions</h3>
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 flex justify-between items-center">
                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 text-red-600 rounded-full flex items-center justify-center font-bold">↑</div>
                    <div>
                      <p className="font-bold text-slate-800 dark:text-white">Ride Payment</p>
                      <p className="text-sm text-slate-500">To: Amit Sharma</p>
                    </div>
                  </div>
                  <p className="font-bold text-slate-800 dark:text-white">-₹120.00</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB: PAYMENTS */}
        {activeTab === 'payments' && (
          <div className="max-w-4xl mx-auto space-y-8">
            <h1 className="text-3xl font-bold text-slate-800 dark:text-white mb-6">Payment Methods</h1>
            <div className="grid grid-cols-2 gap-6">
              <div className="glass-panel p-6 rounded-2xl border-2 border-emerald-500 relative">
                <div className="absolute top-4 right-4 bg-emerald-100 text-emerald-700 text-xs font-bold px-2 py-1 rounded">DEFAULT</div>
                <CreditCard className="text-slate-700 dark:text-slate-300 mb-4" size={32} />
                <p className="text-lg font-bold text-slate-800 dark:text-white">•••• •••• •••• 4242</p>
                <p className="text-slate-500 text-sm">Expires 12/28</p>
              </div>
              <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl p-6 flex flex-col items-center justify-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <p className="text-emerald-500 font-bold mb-1">+ Add New Card</p>
                <p className="text-slate-400 text-sm">Credit, Debit, or UPI</p>
              </div>
            </div>
          </div>
        )}

        {/* TAB: SETTINGS */}
        {activeTab === 'settings' && (
          <div className="max-w-4xl mx-auto space-y-8">
            <h1 className="text-3xl font-bold text-slate-800 dark:text-white mb-6">Account Settings</h1>
            <div className="glass-panel p-8 rounded-3xl space-y-6">
              <div className="space-y-4">
                <h3 className="font-bold text-slate-800 dark:text-white border-b border-slate-100 dark:border-slate-700 pb-2">Profile Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-500 uppercase font-bold mb-1">Full Name</label>
                    <input type="text" defaultValue="Pooja Yadav" className="w-full p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 uppercase font-bold mb-1">Mobile Number</label>
                    <input type="text" defaultValue="+91 9876543210" className="w-full p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
                  </div>
                </div>
              </div>
              
              <div className="space-y-4">
                <h3 className="font-bold text-slate-800 dark:text-white border-b border-slate-100 dark:border-slate-700 pb-2">Preferences</h3>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-800 dark:text-white">Push Notifications</p>
                    <p className="text-sm text-slate-500">Receive alerts for ride matches</p>
                  </div>
                  <div className="w-12 h-6 bg-emerald-500 rounded-full relative"><div className="w-4 h-4 bg-white rounded-full absolute right-1 top-1"></div></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB: HELP */}
        {activeTab === 'help' && (
          <div className="max-w-4xl mx-auto space-y-8">
            <h1 className="text-3xl font-bold text-slate-800 dark:text-white mb-6">Help & Support</h1>
            <div className="grid grid-cols-2 gap-6">
              <div className="bg-blue-50 dark:bg-blue-900/20 p-6 rounded-2xl border border-blue-100 dark:border-blue-800/30">
                <h3 className="font-bold text-blue-800 dark:text-blue-300 text-lg mb-2">Emergency SOS</h3>
                <p className="text-blue-600 dark:text-blue-400 text-sm mb-4">Contact authorities immediately if you feel unsafe.</p>
                <button className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-6 rounded-lg w-full">Trigger SOS</button>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700">
                <h3 className="font-bold text-slate-800 dark:text-white text-lg mb-2">Contact Support</h3>
                <p className="text-slate-500 text-sm mb-4">Have an issue with a recent ride?</p>
                <button className="bg-slate-800 dark:bg-white text-white dark:text-slate-900 font-bold py-2 px-6 rounded-lg w-full">Chat with AI Agent</button>
              </div>
            </div>
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
      className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all ${active ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 font-bold' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 font-medium'}`}
    >
      <div className={active ? 'text-emerald-500' : 'text-slate-400'}>{icon}</div>
      <span>{label}</span>
    </button>
  );
}
