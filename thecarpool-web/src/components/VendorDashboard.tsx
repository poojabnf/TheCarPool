"use client";

import React, { useState, useEffect } from "react";
import { UploadCloud, CheckCircle, CarFront, ShieldCheck, Globe, Activity, Wallet, CreditCard, Settings, HelpCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";

const TOP_20_COUNTRIES = [
  "United States", "China", "Germany", "Japan", "India", "United Kingdom", "France", "Italy", "Brazil", "Canada",
  "Russia", "Mexico", "South Korea", "Australia", "Spain", "Indonesia", "Turkey", "Netherlands", "Saudi Arabia", "Switzerland"
];

export default function VendorDashboard() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [rcStatus, setRcStatus] = useState("PENDING");
  const [insStatus, setInsStatus] = useState("PENDING");
  const [permitStatus, setPermitStatus] = useState("PENDING");

  // The driver's own rides, fetched from the backend (F09).
  const [myRides, setMyRides] = useState<any[] | null>(null);
  // Real earnings from the wallet endpoint (F04).
  const [earnings, setEarnings] = useState<number | null>(null);

  // Auth guard — redirect unauthenticated visitors to the landing page.
  useEffect(() => {
    if (!loading && !user) router.push("/");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const res = await apiFetch("/api/rides/mine");
        setMyRides(res.ok ? (await res.json()) : []);
      } catch {
        setMyRides([]);
      }
      try {
        const w = await apiFetch(`/api/payments/wallet/${user.uid}`);
        if (w.ok) {
          const d = await w.json();
          setEarnings(d.available_wallet_balance ?? 0);
        }
      } catch {
        /* leave null */
      }
    })();
  }, [user]);

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Real upload: pick a file → get a signed URL from the backend → PUT bytes.
  const uploadDocument = (documentType: string, setter: React.Dispatch<React.SetStateAction<string>>) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setter('UPLOADING');
      try {
        const res = await apiFetch('/api/safety/kyc/upload', {
          method: 'POST',
          body: JSON.stringify({ filename: file.name, content_type: file.type, document_type: documentType }),
        });
        if (!res.ok) throw new Error('signed url');
        const { upload_url } = await res.json();
        const put = await fetch(upload_url, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
        if (!put.ok) throw new Error('upload');
        setter('VERIFIED');
      } catch {
        setter('PENDING');
        alert('Upload failed. Please try again.');
      }
    };
    input.click();
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

            {/* Your active rides (live from backend) */}
            <div className="glass-panel p-6 rounded-3xl">
              <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                <CarFront className="text-orange-500" size={20} /> Your Rides
              </h2>
              {myRides === null ? (
                <p className="text-sm text-slate-500">Loading your rides…</p>
              ) : myRides.length === 0 ? (
                <p className="text-sm text-slate-500">No rides published yet. Onboard a vehicle and create a ride to get started.</p>
              ) : (
                <div className="space-y-2">
                  {myRides.map((r) => (
                    <div key={r.id} className="flex justify-between items-center p-3 rounded-xl border border-slate-100 dark:border-slate-700 bg-white/40 dark:bg-slate-800/40">
                      <div>
                        <p className="font-bold text-slate-800 dark:text-white text-sm">{r.vehicle_make || r.vehicle_type || 'Ride'} · {r.status}</p>
                        <p className="text-xs text-slate-500">{r.departure_time ? new Date(r.departure_time).toLocaleString() : '—'} · {r.seats_available}/{r.seats_total} seats</p>
                      </div>
                      <p className="font-bold text-orange-600">₹{r.price_split}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

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
                    {rcStatus === "PENDING" && <button onClick={() => uploadDocument('vehicle_rc', setRcStatus)} className="px-4 py-2 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 text-xs font-bold rounded-lg hover:bg-emerald-100">Upload</button>}
                    {rcStatus === "UPLOADING" && <span className="text-xs font-bold text-orange-500 animate-pulse">Uploading...</span>}
                    {rcStatus === "VERIFIED" && <CheckCircle className="text-emerald-500" size={24} />}
                  </div>

                  <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 bg-white/30 dark:bg-slate-800/30 flex justify-between items-center">
                    <div>
                      <h3 className="font-bold text-slate-800 dark:text-white text-sm">Commercial Insurance</h3>
                      <p className="text-xs text-slate-500">Valid Comprehensive Policy</p>
                    </div>
                    {insStatus === "PENDING" && <button onClick={() => uploadDocument('insurance', setInsStatus)} className="px-4 py-2 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 text-xs font-bold rounded-lg hover:bg-emerald-100">Upload</button>}
                    {insStatus === "UPLOADING" && <span className="text-xs font-bold text-orange-500 animate-pulse">Uploading...</span>}
                    {insStatus === "VERIFIED" && <CheckCircle className="text-emerald-500" size={24} />}
                  </div>

                  <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 bg-white/30 dark:bg-slate-800/30 flex justify-between items-center">
                    <div>
                      <h3 className="font-bold text-slate-800 dark:text-white text-sm">State/Country Permit</h3>
                      <p className="text-xs text-slate-500">Authorization to operate</p>
                    </div>
                    {permitStatus === "PENDING" && <button onClick={() => uploadDocument('permit', setPermitStatus)} className="px-4 py-2 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 text-xs font-bold rounded-lg hover:bg-emerald-100">Upload</button>}
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
                <h2 className="text-5xl font-black text-slate-800 dark:text-white">{earnings === null ? "…" : `₹${earnings.toFixed(2)}`}</h2>
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
