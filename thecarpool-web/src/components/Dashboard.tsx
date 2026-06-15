"use client";

import React, { useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, RadialBarChart, RadialBar
} from 'recharts';
import {
  Users, Activity, BarChart3, ShieldCheck, Settings,
  Globe, AlertTriangle, TrendingUp, ChevronRight, Leaf,
  Car, DollarSign, Zap
} from 'lucide-react';

// ─── Mock Data ────────────────────────────────────────────────────────────────

const ridesOverTime = [
  { month: 'Jan', rides: 8200, revenue: 98400, carbon: 42 },
  { month: 'Feb', rides: 9400, revenue: 112800, carbon: 51 },
  { month: 'Mar', rides: 11200, revenue: 134400, carbon: 63 },
  { month: 'Apr', rides: 13800, revenue: 165600, carbon: 79 },
  { month: 'May', rides: 15600, revenue: 187200, carbon: 88 },
  { month: 'Jun', rides: 18100, revenue: 217200, carbon: 104 },
  { month: 'Jul', rides: 21300, revenue: 255600, carbon: 122 },
  { month: 'Aug', rides: 19800, revenue: 237600, carbon: 113 },
  { month: 'Sep', rides: 22500, revenue: 270000, carbon: 128 },
  { month: 'Oct', rides: 24100, revenue: 289200, carbon: 138 },
  { month: 'Nov', rides: 26800, revenue: 321600, carbon: 153 },
  { month: 'Dec', rides: 29400, revenue: 352800, carbon: 168 },
];

const revenueByCountry = [
  { country: 'India', revenue: 1240, rides: 42000, color: '#14b8a6' },
  { country: 'USA', revenue: 980, rides: 31000, color: '#06b6d4' },
  { country: 'UK', revenue: 620, rides: 19500, color: '#8b5cf6' },
  { country: 'Germany', revenue: 540, rides: 17200, color: '#f59e0b' },
  { country: 'France', revenue: 410, rides: 13100, color: '#10b981' },
  { country: 'Brazil', revenue: 380, rides: 12400, color: '#f43f5e' },
  { country: 'Japan', revenue: 320, rides: 10300, color: '#3b82f6' },
  { country: 'Australia', revenue: 290, rides: 9400, color: '#a855f7' },
];

const rideCategories = [
  { name: 'Daily Commute', value: 48, color: '#14b8a6' },
  { name: 'Corporate Pool', value: 28, color: '#6366f1' },
  { name: 'Weekend Leisure', value: 14, color: '#f59e0b' },
  { name: 'Airport Transfer', value: 10, color: '#f43f5e' },
];

const supplyDemandWeekly = [
  { day: 'Mon', demand: 85, supply: 62 },
  { day: 'Tue', demand: 78, supply: 71 },
  { day: 'Wed', demand: 92, supply: 68 },
  { day: 'Thu', demand: 88, supply: 74 },
  { day: 'Fri', demand: 96, supply: 58 },
  { day: 'Sat', demand: 65, supply: 80 },
  { day: 'Sun', demand: 52, supply: 88 },
];

const evAdoption = [
  { name: 'EV Drivers', value: 42, fill: '#14b8a6' },
  { name: 'Hybrid', value: 28, fill: '#6366f1' },
  { name: 'ICE', value: 30, fill: '#334155' },
];

// ─── Custom Tooltip ───────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 shadow-2xl">
      <p className="text-xs text-slate-400 font-bold mb-2">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span className="text-slate-300">{p.name}:</span>
          <span className="text-white font-bold">
            {p.name === 'revenue' ? `$${(p.value).toLocaleString()}K` : p.value?.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('analytics');
  const [metricMode, setMetricMode] = useState<'rides' | 'revenue' | 'carbon'>('rides');

  const metricConfig = {
    rides:   { label: 'Total Rides',      color: '#14b8a6', format: (v: number) => v.toLocaleString() },
    revenue: { label: 'Revenue ($K)',      color: '#6366f1', format: (v: number) => `$${v.toLocaleString()}K` },
    carbon:  { label: 'CO₂ Saved (tons)', color: '#10b981', format: (v: number) => `${v}t` },
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex font-sans">

      {/* Enterprise Sidebar */}
      <aside className="w-72 bg-slate-900 border-r border-slate-800 p-6 flex flex-col">
        <div className="mb-10">
          <h2 className="text-2xl font-black text-white tracking-tight">TheCarPool <span className="text-teal-500">Admin</span></h2>
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

        {/* Sidebar Live Status */}
        <div className="mt-auto pt-6 border-t border-slate-800 space-y-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
            <span className="text-slate-400">Live data · updated 2m ago</span>
          </div>
          <div className="text-xs text-slate-500">20 active regions · v2.4.1</div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-8 overflow-y-auto bg-[#0a0f18]">

        {/* ── ANALYTICS TAB ── */}
        {activeTab === 'analytics' && (
          <div className="max-w-7xl mx-auto space-y-8">

            <header className="flex justify-between items-end mb-2">
              <div>
                <h1 className="text-3xl font-black text-white">Global Analytics</h1>
                <p className="text-slate-400 mt-1">Real-time metrics across 20 active regions.</p>
              </div>
              <div className="bg-slate-800 px-4 py-2 rounded-lg text-sm font-bold border border-slate-700 cursor-pointer hover:bg-slate-700 transition-colors">
                Last 12 Months ▼
              </div>
            </header>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KpiCard icon={<Car size={20} />} title="Total Rides" value="142.5K" trend="+12.4%" color="teal" />
              <KpiCard icon={<Users size={20} />} title="Active Drivers" value="18,040" trend="+5.2%" color="blue" />
              <KpiCard icon={<DollarSign size={20} />} title="Gross Volume" value="$4.2M" trend="+18.1%" color="violet" />
              <KpiCard icon={<Leaf size={20} />} title="Carbon Saved" value="840 T" trend="+14.0%" color="emerald" />
            </div>

            {/* Main Area Chart */}
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-bold text-white text-lg">Growth Trends (12 months)</h3>
                <div className="flex gap-2">
                  {(['rides', 'revenue', 'carbon'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMetricMode(m)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${metricMode === m ? 'bg-teal-500/20 text-teal-400 border border-teal-500/40' : 'text-slate-500 hover:text-slate-300'}`}
                    >
                      {metricConfig[m].label}
                    </button>
                  ))}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={ridesOverTime} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="metricGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={metricConfig[metricMode].color} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={metricConfig[metricMode].color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="month" stroke="#475569" tick={{ fontSize: 12 }} />
                  <YAxis stroke="#475569" tick={{ fontSize: 12 }} tickFormatter={metricConfig[metricMode].format} width={70} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone"
                    dataKey={metricMode}
                    name={metricConfig[metricMode].label}
                    stroke={metricConfig[metricMode].color}
                    strokeWidth={3}
                    fill="url(#metricGrad)"
                    dot={false}
                    activeDot={{ r: 6, strokeWidth: 0 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Bottom Row: Bar chart + Pie + Supply/Demand */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

              {/* Revenue by Country Bar Chart */}
              <div className="lg:col-span-2 bg-slate-900 border border-slate-800 p-6 rounded-2xl">
                <h3 className="font-bold text-white mb-6">Revenue by Country ($K)</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={revenueByCountry} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis dataKey="country" stroke="#475569" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#475569" tick={{ fontSize: 11 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="revenue" name="revenue" radius={[6, 6, 0, 0]}>
                      {revenueByCountry.map((entry, i) => (
                        <Cell key={i} fill={entry.color} fillOpacity={0.85} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Ride Categories Pie */}
              <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl flex flex-col">
                <h3 className="font-bold text-white mb-4">Ride Categories</h3>
                <div className="flex-1 flex flex-col items-center justify-center">
                  <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                      <Pie
                        data={rideCategories}
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={70}
                        dataKey="value"
                        strokeWidth={0}
                      >
                        {rideCategories.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v) => `${v}%`} contentStyle={{ background: '#1e293b', border: 'none', borderRadius: '12px' }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-2 w-full mt-2">
                    {rideCategories.map((c, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ background: c.color }} />
                          <span className="text-slate-400">{c.name}</span>
                        </div>
                        <span className="font-bold text-white">{c.value}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Supply vs Demand + EV Adoption */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* Supply vs Demand Line Chart */}
              <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="font-bold text-white">Supply vs Demand (Weekly)</h3>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-teal-400 inline-block rounded" /> Demand</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-400 inline-block rounded" /> Supply</span>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={supplyDemandWeekly} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis dataKey="day" stroke="#475569" tick={{ fontSize: 12 }} />
                    <YAxis stroke="#475569" tick={{ fontSize: 12 }} domain={[40, 100]} />
                    <Tooltip content={<CustomTooltip />} />
                    <Line type="monotone" dataKey="demand" name="Demand %" stroke="#14b8a6" strokeWidth={2.5} dot={{ r: 4, fill: '#14b8a6' }} />
                    <Line type="monotone" dataKey="supply" name="Supply %" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 4, fill: '#3b82f6' }} />
                  </LineChart>
                </ResponsiveContainer>
                <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                  <p className="text-xs text-amber-400 font-bold">⚠️ Friday Supply Deficit Detected</p>
                  <p className="text-xs text-slate-400 mt-1">Consider activating Driver Surge Pricing in India & Brazil on peak days.</p>
                </div>
              </div>

              {/* EV Adoption Radial */}
              <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
                <h3 className="font-bold text-white mb-4">Fleet Type Breakdown</h3>
                <div className="flex items-center gap-6">
                  <ResponsiveContainer width={180} height={180}>
                    <RadialBarChart
                      innerRadius={30}
                      outerRadius={80}
                      data={evAdoption}
                      startAngle={90}
                      endAngle={-270}
                    >
                      <RadialBar dataKey="value" cornerRadius={6} background={{ fill: '#1e293b' }} />
                      <Tooltip formatter={(v) => `${v}%`} contentStyle={{ background: '#1e293b', border: 'none', borderRadius: '12px' }} />
                    </RadialBarChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-4">
                    {evAdoption.map((e, i) => (
                      <div key={i}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-slate-400">{e.name}</span>
                          <span className="font-bold text-white">{e.value}%</span>
                        </div>
                        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${e.value}%`, background: e.fill }} />
                        </div>
                      </div>
                    ))}
                    <div className="pt-2 border-t border-slate-800">
                      <p className="text-xs text-teal-400 font-bold flex items-center gap-1">
                        <Zap size={12} /> EV share up 8.2% vs last quarter
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* ── PRICING ENGINE TAB ── */}
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

        {/* PLACEHOLDER TABS */}
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

// ─── Sub-components ───────────────────────────────────────────────────────────

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

const colorMap: Record<string, string> = {
  teal:    'bg-teal-500/10 text-teal-400 border-teal-500/20',
  blue:    'bg-blue-500/10 text-blue-400 border-blue-500/20',
  violet:  'bg-violet-500/10 text-violet-400 border-violet-500/20',
  emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
};

function KpiCard({ icon, title, value, trend, color }: { icon: React.ReactNode, title: string, value: string, trend: string, color: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center border mb-4 ${colorMap[color]}`}>
        {icon}
      </div>
      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">{title}</p>
      <div className="flex items-end gap-2">
        <h3 className="text-2xl font-black text-white">{value}</h3>
        <span className="text-teal-400 font-bold text-xs mb-0.5">{trend}</span>
      </div>
    </div>
  );
}
