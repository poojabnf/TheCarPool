"use client";

import React, { useState, useEffect } from "react";
import { Leaf, MapPin, Navigation, Map as MapIcon, CreditCard, Wallet, Settings, HelpCircle, Activity, LogOut, Search } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useRouter } from "next/navigation";

const LOCAL_GEO_DATABASE = [
  { postal_code: '122002', place_name: 'DLF Phase 3, Gurugram', state_name: 'Haryana', country_name: 'India' },
  { postal_code: '122003', place_name: 'Sector 45, Gurugram', state_name: 'Haryana', country_name: 'India' },
  { postal_code: '122018', place_name: 'Sector 21, Gurugram', state_name: 'Haryana', country_name: 'India' },
  { postal_code: '560001', place_name: 'MG Road, Bengaluru', state_name: 'Karnataka', country_name: 'India' },
  { postal_code: '560066', place_name: 'Whitefield, Bengaluru', state_name: 'Karnataka', country_name: 'India' },
  { postal_code: '560103', place_name: 'Outer Ring Road, Bengaluru', state_name: 'Karnataka', country_name: 'India' },
  { postal_code: '110001', place_name: 'Connaught Place, New Delhi', state_name: 'Delhi', country_name: 'India' },
  { postal_code: '110021', place_name: 'Chanakyapuri, New Delhi', state_name: 'Delhi', country_name: 'India' },
  { postal_code: '400001', place_name: 'Fort, Mumbai', state_name: 'Maharashtra', country_name: 'India' },
  { postal_code: '400050', place_name: 'Bandra West, Mumbai', state_name: 'Maharashtra', country_name: 'India' },
  { postal_code: '411057', place_name: 'Hinjawadi, Pune', state_name: 'Maharashtra', country_name: 'India' },
  { postal_code: '95113', place_name: 'Downtown San Jose, Silicon Valley', state_name: 'California', country_name: 'United States' },
  { postal_code: '94102', place_name: 'Union Square, San Francisco', state_name: 'California', country_name: 'United States' },
  { postal_code: '90012', place_name: 'Downtown Los Angeles', state_name: 'California', country_name: 'United States' },
  { postal_code: '10001', place_name: 'Chelsea, Manhattan', state_name: 'New York', country_name: 'United States' },
  { postal_code: '11201', place_name: 'Brooklyn Heights', state_name: 'New York', country_name: 'United States' },
  { postal_code: '98101', place_name: 'Downtown Seattle', state_name: 'Washington', country_name: 'United States' },
  { postal_code: '98004', place_name: 'Bellevue Tech Hub', state_name: 'Washington', country_name: 'United States' },
  { postal_code: 'EC1A', place_name: 'City of London', state_name: 'England', country_name: 'United Kingdom' },
  { postal_code: 'SW1A', place_name: 'Westminster, London', state_name: 'England', country_name: 'United Kingdom' },
  { postal_code: 'M1', place_name: 'Manchester Piccadilly', state_name: 'England', country_name: 'United Kingdom' },
  { postal_code: '80331', place_name: 'Altstadt, Munich', state_name: 'Bavaria', country_name: 'Germany' },
  { postal_code: '10115', place_name: 'Mitte, Berlin', state_name: 'Berlin', country_name: 'Germany' },
  { postal_code: '75001', place_name: 'Louvre, Paris', state_name: 'Île-de-France', country_name: 'France' },
  { postal_code: '92000', place_name: 'Nanterre / La Défense, Paris', state_name: 'Île-de-France', country_name: 'France' },
  { postal_code: '160-0022', place_name: 'Shinjuku, Tokyo', state_name: 'Tokyo', country_name: 'Japan' },
  { postal_code: 'M5V', place_name: 'Downtown Toronto', state_name: 'Ontario', country_name: 'Canada' },
  { postal_code: '2000', place_name: 'Sydney CBD', state_name: 'New South Wales', country_name: 'Australia' },
  { postal_code: '01000', place_name: 'Centro, São Paulo', state_name: 'São Paulo', country_name: 'Brazil' },
  { postal_code: '00185', place_name: 'Roma Termini', state_name: 'Lazio', country_name: 'Italy' },
  { postal_code: '28001', place_name: 'Recoletos, Madrid', state_name: 'Madrid', country_name: 'Spain' },
  { postal_code: '06000', place_name: 'Centro Historico, CDMX', state_name: 'Distrito Federal', country_name: 'Mexico' },
  { postal_code: '06000', place_name: 'Gangnam-gu, Seoul', state_name: 'Seoul', country_name: 'South Korea' },
  { postal_code: '1012', place_name: 'Centrum, Amsterdam', state_name: 'North Holland', country_name: 'Netherlands' },
  { postal_code: '11564', place_name: 'Olaya, Riyadh', state_name: 'Riyadh Province', country_name: 'Saudi Arabia' },
  { postal_code: '34330', place_name: 'Levent, Istanbul', state_name: 'Istanbul', country_name: 'Turkey' },
  { postal_code: '8001', place_name: 'Zurich Center', state_name: 'Zurich', country_name: 'Switzerland' },
  { postal_code: '10110', place_name: 'Gambir, Central Jakarta', state_name: 'Jakarta', country_name: 'Indonesia' },
  { postal_code: '018981', place_name: 'Marina Bay, Singapore', state_name: 'Singapore Circle', country_name: 'Singapore' },
  { postal_code: '11120', place_name: 'Norrmalm, Stockholm', state_name: 'Stockholm County', country_name: 'Sweden' },
];

export default function CustomerDashboard() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('dashboard');

  const [pickup, setPickup] = useState("Home (Sector 44)");
  const [dropoff, setDropoff] = useState("Office (Cyber Hub)");
  
  const [pickupQuery, setPickupQuery] = useState("");
  const [dropoffQuery, setDropoffQuery] = useState("");
  
  const [pickupSuggestions, setPickupSuggestions] = useState<any[]>([]);
  const [dropoffSuggestions, setDropoffSuggestions] = useState<any[]>([]);
  
  const [isSearchingPickup, setIsSearchingPickup] = useState(false);
  const [isSearchingDropoff, setIsSearchingDropoff] = useState(false);

  const fetchSuggestions = async (val: string, setSuggestions: (s: any[]) => void) => {
    if (val.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    
    try {
      const res = await fetch(`/api/geo/search?query=${encodeURIComponent(val)}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0) {
          setSuggestions(data);
          return;
        }
      }
    } catch (e) {
      console.warn("API Geocoding failed, falling back to client-side seed database:", e);
    }
    
    const matches = LOCAL_GEO_DATABASE.filter(item => 
      (item.postal_code && item.postal_code.toLowerCase().includes(val.toLowerCase())) ||
      (item.place_name && item.place_name.toLowerCase().includes(val.toLowerCase())) ||
      (item.state_name && item.state_name.toLowerCase().includes(val.toLowerCase())) ||
      (item.country_name && item.country_name.toLowerCase().includes(val.toLowerCase()))
    ).map(item => ({
      postal_code: item.postal_code,
      place_name: item.place_name,
      state_name: item.state_name,
      country_name: item.country_name,
    }));
    setSuggestions(matches);
  };

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.push("/");
      } else {
        const onboarded = localStorage.getItem(`thecarpool_onboarded_${user.uid}`);
        if (onboarded !== 'true') {
          router.push("/onboarding");
        }
      }
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col justify-center items-center">
        <div className="w-16 h-16 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="mt-4 text-slate-600 dark:text-slate-400 font-semibold animate-pulse text-lg">Loading your dashboard...</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

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

        {/* User Profile & Sign Out */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-700 mt-auto flex flex-col gap-3">
          <div className="flex items-center space-x-3 p-2 rounded-xl bg-slate-50 dark:bg-slate-800/50">
            {user.photoURL ? (
              <img
                src={user.photoURL}
                alt={user.displayName || "User"}
                className="w-9 h-9 rounded-full object-cover border border-slate-200 dark:border-slate-700"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-sm">
                {(user.displayName || user.email || "P")[0].toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-800 dark:text-white truncate">
                {user.displayName || "Pooja Yadav"}
              </p>
              <p className="text-xs text-slate-500 truncate">
                {user.email || "pooja.yadav@example.com"}
              </p>
            </div>
          </div>
          <button
            onClick={() => signOut()}
            className="w-full flex items-center space-x-3 px-4 py-2.5 rounded-xl text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-all font-semibold text-sm cursor-pointer"
          >
            <LogOut size={16} />
            <span>Sign Out</span>
          </button>
        </div>
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
                  
                  {/* Origin */}
                  <div className="relative">
                    <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-100 dark:border-slate-700">
                      <MapPin size={18} className="text-slate-400" />
                      {isSearchingPickup ? (
                        <input
                          type="text"
                          placeholder="Type Pincode, City, or Country..."
                          value={pickupQuery}
                          onChange={(e) => {
                            setPickupQuery(e.target.value);
                            fetchSuggestions(e.target.value, setPickupSuggestions);
                          }}
                          className="w-full bg-transparent border-none outline-none font-semibold text-slate-800 dark:text-white"
                          autoFocus
                          onBlur={() => {
                            setTimeout(() => setIsSearchingPickup(false), 200);
                          }}
                        />
                      ) : (
                        <span 
                          onClick={() => {
                            setPickupQuery("");
                            setPickupSuggestions([]);
                            setIsSearchingPickup(true);
                          }}
                          className="text-slate-600 dark:text-slate-300 font-medium cursor-pointer w-full"
                        >
                          {pickup}
                        </span>
                      )}
                    </div>
                    {isSearchingPickup && pickupSuggestions.length > 0 && (
                      <div className="absolute left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 max-h-48 overflow-y-auto">
                        {pickupSuggestions.map((s, idx) => (
                          <div
                            key={idx}
                            onMouseDown={() => {
                              setPickup(`${s.place_name} (${s.postal_code || s.state_code || s.state_name})`);
                              setIsSearchingPickup(false);
                            }}
                            className="p-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer text-sm border-b border-slate-100 dark:border-slate-700 last:border-b-0 text-slate-700 dark:text-slate-300"
                          >
                            <span className="font-bold text-emerald-600">{s.postal_code}</span> - {s.place_name}, {s.state_name}, {s.country_name}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Destination */}
                  <div className="relative">
                    <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-100 dark:border-slate-700">
                      <MapIcon size={18} className="text-slate-400" />
                      {isSearchingDropoff ? (
                        <input
                          type="text"
                          placeholder="Type Pincode, City, or Country..."
                          value={dropoffQuery}
                          onChange={(e) => {
                            setDropoffQuery(e.target.value);
                            fetchSuggestions(e.target.value, setDropoffSuggestions);
                          }}
                          className="w-full bg-transparent border-none outline-none font-semibold text-slate-800 dark:text-white"
                          autoFocus
                          onBlur={() => {
                            setTimeout(() => setIsSearchingDropoff(false), 200);
                          }}
                        />
                      ) : (
                        <span 
                          onClick={() => {
                            setDropoffQuery("");
                            setDropoffSuggestions([]);
                            setIsSearchingDropoff(true);
                          }}
                          className="text-slate-600 dark:text-slate-300 font-medium cursor-pointer w-full"
                        >
                          {dropoff}
                        </span>
                      )}
                    </div>
                    {isSearchingDropoff && dropoffSuggestions.length > 0 && (
                      <div className="absolute left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 max-h-48 overflow-y-auto">
                        {dropoffSuggestions.map((s, idx) => (
                          <div
                            key={idx}
                            onMouseDown={() => {
                              setDropoff(`${s.place_name} (${s.postal_code || s.state_code || s.state_name})`);
                              setIsSearchingDropoff(false);
                            }}
                            className="p-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer text-sm border-b border-slate-100 dark:border-slate-700 last:border-b-0 text-slate-700 dark:text-slate-300"
                          >
                            <span className="font-bold text-emerald-600">{s.postal_code}</span> - {s.place_name}, {s.state_name}, {s.country_name}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                </div>
                <button className="w-full mt-2 bg-slate-800 dark:bg-white text-white dark:text-slate-900 font-bold py-3 rounded-xl hover:bg-slate-700 dark:hover:bg-slate-100 transition-colors cursor-pointer">
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
                    <input type="text" key={user?.displayName || "name"} defaultValue={user?.displayName || "Pooja Yadav"} className="w-full p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 uppercase font-bold mb-1">Email Address</label>
                    <input type="text" key={user?.email || "email"} defaultValue={user?.email || "pooja.yadav@example.com"} className="w-full p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" readOnly />
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
