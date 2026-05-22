"use client";

import React, { useState } from 'react';
import { Users, Activity, BarChart3, ShieldCheck, Settings, Globe, AlertTriangle, TrendingUp, ChevronRight } from 'lucide-react';

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('analytics');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex font-sans">
      
      {/* Enterprise Sidebar */}
      <aside className="w-72 bg-slate-900 border-r border-slate-800 p-6 flex flex-col">
        <div className="mb-10">
          <h2 className="text-2xl font-black text-white tracking-tight">RideShare <span className="text-teal-500">Admin</span></h2>
          <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">Enterprise Console</p>
        </div>
        
        <nav className="space-y-2 flex-1">
          <SidebarItem icon={<BarChart3 />} label="Analytics Dashboard" active={activeTab === 'analytics'} onClick={() => setActiveTab('analytics')} />
          <SidebarItem icon={<Users />} label="User Management" active={activeTab === 'users'} onClick={() => setActiveTab('users')} />
          <SidebarItem icon={<ShieldCheck />} label="KYC Approvals" active={activeTab === 'kyc'} onClick={() => setActiveTab('kyc')} />
          <SidebarItem icon={<AlertTriangle />} label="Ride Moderation" active={activeTab === 'moderation'} onClick={() => setActiveTab('moderation')} />
          <SidebarItem icon={<TrendingUp />} label="Pricing Engine" active={activeTab === 'pricing'} onClick={() => setActiveTab('pricing')} />
          <SidebarItem icon={<Globe />} label="Global Compliance" active={activeTab === 'compliance'} onClick={() => setActiveTab('compliance')} />
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-8 overflow-y-auto bg-[#0a0f18]">
        
        {/* ANALYTICS TAB */}
        {activeTab === 'analytics' && (
          <div className="max-w-7xl mx-auto space-y-8">
            <header className="flex justify-between items-end mb-8">
              <div>
                <h1 className="text-3xl font-black text-white">Global Analytics</h1>
                <p className="text-slate-400 mt-2">Real-time metrics across 20 active regions.</p>
              </div>
              <div className="bg-slate-800 px-4 py-2 rounded-lg text-sm font-bold border border-slate-700">Last 30 Days ▼</div>
            </header>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <KpiCard title="Total Rides" value="142.5K" trend="+12.4%" />
              <KpiCard title="Active Drivers" value="18,040" trend="+5.2%" />
              <KpiCard title="Gross Volume" value="$4.2M" trend="+18.1%" />
              <KpiCard title="Carbon Saved" value="840 Tons" trend="+14.0%" />
            </div>

            {/* Mock Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 bg-slate-900 border border-slate-800 p-6 rounded-2xl">
                <h3 className="font-bold text-white mb-6">Revenue by Country (Heatmap)</h3>
                <div className="h-64 flex items-end justify-between gap-2 px-4">
                  {[40, 70, 45, 90, 60, 30, 85, 50].map((h, i) => (
                    <div key={i} className="w-full bg-teal-500/20 hover:bg-teal-500/40 rounded-t-lg transition-colors relative group" style={{ height: `${h}%` }}>
                      <div className="absolute -top-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 bg-slate-800 text-xs px-2 py-1 rounded text-white transition-opacity">Country {i+1}</div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between mt-4 text-xs text-slate-500 border-t border-slate-800 pt-4">
                  <span>US</span><span>IN</span><span>UK</span><span>DE</span><span>FR</span><span>BR</span><span>JP</span><span>AU</span>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl flex flex-col">
                <h3 className="font-bold text-white mb-6">Supply vs Demand</h3>
                <div className="flex-1 flex flex-col justify-center gap-6">
                  <div>
                    <div className="flex justify-between text-sm mb-2"><span className="text-slate-400">Passenger Demand</span><span className="font-bold text-teal-400">72%</span></div>
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden"><div className="h-full bg-teal-400 w-[72%]"></div></div>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-2"><span className="text-slate-400">Driver Supply</span><span className="font-bold text-blue-400">28%</span></div>
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden"><div className="h-full bg-blue-400 w-[28%]"></div></div>
                  </div>
                  <div className="mt-4 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                    <p className="text-xs text-amber-400 font-bold">⚠️ Supply Deficit Detected</p>
                    <p className="text-xs text-slate-400 mt-1">Consider activating Driver Surge Pricing in India & Brazil.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* PRICING ENGINE TAB */}
        {activeTab === 'pricing' && (
          <div className="max-w-4xl mx-auto space-y-8">
             <h1 className="text-3xl font-black text-white mb-8">Dynamic Pricing Engine</h1>
             
             <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl space-y-6">
               <h3 className="font-bold text-lg border-b border-slate-800 pb-4">Global Base Fares</h3>
               
               <div className="grid grid-cols-3 gap-6">
                 <div>
                   <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Region</label>
                   <select className="w-full bg-slate-800 border border-slate-700 p-3 rounded-xl text-white outline-none focus:border-teal-500">
                     <option>India (INR)</option>
                     <option>United States (USD)</option>
                     <option>Germany (EUR)</option>
                   </select>
                 </div>
                 <div>
                   <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Base Fare per KM</label>
                   <input type="text" defaultValue="₹ 8.50" className="w-full bg-slate-800 border border-slate-700 p-3 rounded-xl text-white outline-none focus:border-teal-500" />
                 </div>
                 <div>
                   <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Platform Cut</label>
                   <input type="text" defaultValue="12%" className="w-full bg-slate-800 border border-slate-700 p-3 rounded-xl text-white outline-none focus:border-teal-500" />
                 </div>
               </div>

               <div className="pt-6">
                 <h3 className="font-bold text-lg mb-4">Surge Rules</h3>
                 <div className="flex items-center justify-between p-4 bg-slate-800 rounded-xl border border-slate-700">
                   <div>
                     <p className="font-bold text-white">Rain / Bad Weather Surge</p>
                     <p className="text-xs text-slate-400 mt-1">Automatically applies 1.5x multiplier via Weather API.</p>
                   </div>
                   <div className="w-12 h-6 bg-teal-500 rounded-full relative"><div className="w-4 h-4 bg-white rounded-full absolute right-1 top-1"></div></div>
                 </div>
               </div>

               <button className="w-full bg-teal-600 hover:bg-teal-500 text-white font-bold py-3 rounded-xl mt-4 transition-colors">Apply New Pricing Rules</button>
             </div>
          </div>
        )}

        {/* MOCK FOR OTHERS */}
        {(activeTab === 'users' || activeTab === 'kyc' || activeTab === 'moderation' || activeTab === 'compliance') && (
          <div className="flex flex-col items-center justify-center h-[70vh] border-2 border-dashed border-slate-800 rounded-3xl">
             <AlertTriangle className="text-slate-700 mb-4" size={48} />
             <h2 className="text-xl font-bold text-slate-500">Module Under Construction</h2>
             <p className="text-slate-600 mt-2">The {activeTab} framework is currently being scaffolded.</p>
          </div>
        )}

      </main>
    </div>
  );
}

function SidebarItem({ icon, label, active, onClick }: any) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all ${active ? 'bg-teal-500/10 text-teal-400 font-bold border border-teal-500/20' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200 font-medium border border-transparent'}`}
    >
      <div className={active ? 'text-teal-400' : 'text-slate-500'}>{icon}</div>
      <span className="flex-1 text-left">{label}</span>
      {active && <ChevronRight size={16} className="text-teal-500" />}
    </button>
  );
}

function KpiCard({ title, value, trend }: { title: string, value: string, trend: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
      <p className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-2">{title}</p>
      <div className="flex items-end gap-3">
        <h3 className="text-3xl font-black text-white">{value}</h3>
        <span className="text-teal-400 font-bold text-sm mb-1">{trend}</span>
      </div>
    </div>
  );
}
