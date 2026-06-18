"use client";

import React, { useState, useEffect } from "react";
import { Leaf, MapPin, Navigation, Map as MapIcon, CreditCard, Wallet, Settings, HelpCircle, Activity, LogOut, Search, Trash2, AlertTriangle } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../lib/api";
import { useRouter } from "next/navigation";

export default function CustomerDashboard() {
  const { user, loading, signOut, deleteAccount } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const [pickup, setPickup] = useState("Home (Sector 44)");
  const [dropoff, setDropoff] = useState("Office (Cyber Hub)");
  
  const [pickupQuery, setPickupQuery] = useState("");
  const [dropoffQuery, setDropoffQuery] = useState("");
  
  const [pickupSuggestions, setPickupSuggestions] = useState<any[]>([]);
  const [dropoffSuggestions, setDropoffSuggestions] = useState<any[]>([]);
  
  const [isSearchingPickup, setIsSearchingPickup] = useState(false);
  const [isSearchingDropoff, setIsSearchingDropoff] = useState(false);

  // Selected coordinates for the ride search (F07).
  const [pickupCoords, setPickupCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [dropoffCoords, setDropoffCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [rideResults, setRideResults] = useState<any[] | null>(null);
  const [isFindingRides, setIsFindingRides] = useState(false);

  // Verification status — browsing is open; KYC is only required to book.
  const [isVerified, setIsVerified] = useState(false);

  // Real wallet data (F04).
  const [wallet, setWallet] = useState<{ available: number; escrow: number; currency: string } | null>(null);

  // Settings form (F08).
  const [settingsName, setSettingsName] = useState("");
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  // Load the real wallet balance once the user is known.
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const res = await apiFetch(`/api/payments/wallet/${user.uid}`);
        if (res.ok) {
          const d = await res.json();
          setWallet({
            available: d.available_wallet_balance ?? 0,
            escrow: d.escrow_locked_balance ?? 0,
            currency: d.currency || 'INR',
          });
        }
      } catch {
        /* leave wallet null — UI shows a loading/unavailable state */
      }
    })();
    setSettingsName(user.displayName || "");
  }, [user]);

  const handleFindRide = async () => {
    if (!pickupCoords || !dropoffCoords) {
      alert("Please select both a pickup and drop-off location from the suggestions.");
      return;
    }
    setIsFindingRides(true);
    setRideResults(null);
    try {
      const res = await apiFetch('/api/rides/search', {
        method: 'POST',
        body: JSON.stringify({
          pickup_lat: pickupCoords.lat,
          pickup_lng: pickupCoords.lng,
          drop_lat: dropoffCoords.lat,
          drop_lng: dropoffCoords.lng,
        }),
      });
      const data = res.ok ? await res.json() : [];
      setRideResults(Array.isArray(data) ? data : []);
    } catch {
      setRideResults([]);
    } finally {
      setIsFindingRides(false);
    }
  };

  const handleSaveSettings = async () => {
    setSettingsSaving(true);
    setSettingsSaved(false);
    try {
      await apiFetch('/api/users/profile', {
        method: 'POST',
        body: JSON.stringify({
          displayName: settingsName,
          notifications_enabled: notificationsEnabled,
        }),
      });
      setSettingsSaved(true);
    } catch {
      /* swallow — could surface a toast */
    } finally {
      setSettingsSaving(false);
    }
  };

  // Geo data comes solely from the backend (single source of truth). On
  // failure we show an empty state rather than diverging local seed data.
  const fetchSuggestions = async (val: string, setSuggestions: (s: any[]) => void) => {
    if (val.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    try {
      const res = await apiFetch(`/api/geo/search?query=${encodeURIComponent(val)}`);
      if (res.ok) {
        const data = await res.json();
        setSuggestions(Array.isArray(data) ? data : []);
        return;
      }
    } catch (e) {
      console.warn("Geocoding lookup failed:", e);
    }
    setSuggestions([]);
  };

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.push("/");
      return;
    }
    // Browsing is open to any signed-in user — no forced onboarding/KYC gate.
    // We only read verification status so booking can require it (consistent
    // with the mobile app: browse freely, verify only to book).
    (async () => {
      try {
        const res = await apiFetch("/api/users/me");
        if (res.ok) {
          const data = await res.json();
          setIsVerified(data.kyc_status === "VERIFIED");
        }
      } catch {
        /* leave unverified; booking will prompt verification */
      }
    })();
  }, [user, loading, router]);

  // Booking gate — open to browse, verify to book.
  const handleBookRide = async (ride: any) => {
    if (!isVerified) {
      router.push("/onboarding");
      return;
    }
    try {
      const res = await apiFetch("/api/bookings", {
        method: "POST",
        body: JSON.stringify({
          ride_id: String(ride.id),
          rider_id: user?.uid,
          seats_booked: 1,
          pickup_lat: pickupCoords?.lat ?? 0,
          pickup_lng: pickupCoords?.lng ?? 0,
          drop_lat: dropoffCoords?.lat ?? 0,
          drop_lng: dropoffCoords?.lng ?? 0,
        }),
      });
      if (res.status === 403) {
        router.push("/onboarding");
        return;
      }
      alert(res.ok ? "Ride booked! Funds locked in escrow." : "Could not book this ride. Please try again.");
    } catch {
      alert("Could not book this ride. Please try again.");
    }
  };

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

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') return;
    setIsDeleting(true);
    setDeleteError('');
    try {
      await deleteAccount();
      router.push('/');
    } catch (err: any) {
      setDeleteError(err.message || 'Something went wrong. Please try again.');
      setIsDeleting(false);
    }
  };

  return (
    <>
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
                              setPickupCoords({ lat: s.latitude ?? s.lat ?? 0, lng: s.longitude ?? s.lng ?? 0 });
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
                              setDropoffCoords({ lat: s.latitude ?? s.lat ?? 0, lng: s.longitude ?? s.lng ?? 0 });
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
                <button
                  onClick={handleFindRide}
                  disabled={isFindingRides}
                  className="w-full mt-2 bg-slate-800 dark:bg-white text-white dark:text-slate-900 font-bold py-3 rounded-xl hover:bg-slate-700 dark:hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-60"
                >
                  {isFindingRides ? "Searching…" : "Find Ride"}
                </button>

                {/* Ride search results */}
                {rideResults !== null && (
                  <div className="mt-4 space-y-2">
                    {rideResults.length === 0 ? (
                      <p className="text-sm text-slate-500 text-center py-2">No matching rides found on this route right now.</p>
                    ) : (
                      rideResults.map((r) => (
                        <div key={r.id} className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-100 dark:border-slate-700 flex justify-between items-center gap-3">
                          <div className="min-w-0">
                            <p className="font-bold text-slate-800 dark:text-white text-sm truncate">{r.driver_name || 'Driver'}{r.is_ev ? ' · EV' : ''}</p>
                            <p className="text-xs text-slate-500">{r.seats_available} seats · ~{Math.round((r.pickup_deviation || 0))}m detour</p>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <p className="font-bold text-emerald-600">₹{r.price_split}</p>
                            <button
                              onClick={() => handleBookRide(r)}
                              className="bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold px-3 py-2 rounded-lg cursor-pointer"
                            >
                              {isVerified ? "Book" : "🔒 Verify & Book"}
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
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
                <h2 className="text-5xl font-black text-slate-800 dark:text-white">
                  {wallet ? `₹${wallet.available.toFixed(2)}` : "…"}
                </h2>
                {wallet && wallet.escrow > 0 && (
                  <p className="text-xs text-slate-500 mt-1">₹{wallet.escrow.toFixed(2)} locked in escrow</p>
                )}
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
                    <input type="text" value={settingsName} onChange={(e) => setSettingsName(e.target.value)} className="w-full p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
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
                  <button
                    onClick={() => setNotificationsEnabled((v) => !v)}
                    aria-pressed={notificationsEnabled}
                    className={`w-12 h-6 rounded-full relative transition-colors ${notificationsEnabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                  >
                    <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${notificationsEnabled ? 'right-1' : 'left-1'}`}></div>
                  </button>
                </div>
              </div>

              {/* Save preferences / profile */}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSaveSettings}
                  disabled={settingsSaving}
                  className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-2.5 px-6 rounded-xl transition-all disabled:opacity-60 cursor-pointer"
                >
                  {settingsSaving ? "Saving…" : "Save Changes"}
                </button>
                {settingsSaved && <span className="text-sm text-emerald-600 font-semibold">Saved ✓</span>}
              </div>

              {/* Danger Zone */}
              <div className="space-y-4 pt-2">
                <h3 className="font-bold text-red-600 dark:text-red-400 border-b border-red-100 dark:border-red-900/30 pb-2 flex items-center gap-2">
                  <AlertTriangle size={16} /> Danger Zone
                </h3>
                <div className="flex items-center justify-between p-4 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40">
                  <div>
                    <p className="font-semibold text-red-800 dark:text-red-300">Delete My Account</p>
                    <p className="text-sm text-red-600 dark:text-red-400 mt-0.5">Permanently erase all your data, rides, bookings and profile. This cannot be undone.</p>
                  </div>
                  <button
                    id="btn-delete-profile"
                    onClick={() => { setShowDeleteModal(true); setDeleteConfirmText(''); setDeleteError(''); }}
                    className="ml-6 flex-shrink-0 flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 px-5 rounded-xl transition-all shadow-sm cursor-pointer"
                  >
                    <Trash2 size={15} /> Delete Account
                  </button>
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

    {/* Delete Account Confirmation Modal */}
    {showDeleteModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl p-8 w-full max-w-md mx-4 border border-red-200 dark:border-red-900/40">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
              <AlertTriangle className="text-red-600 dark:text-red-400" size={22} />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-slate-800 dark:text-white">Delete Account</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">This action is permanent and irreversible.</p>
            </div>
          </div>

          <div className="mb-6 space-y-4">
            <p className="text-slate-600 dark:text-slate-300 text-sm leading-relaxed">
              Deleting your account will permanently remove:
            </p>
            <ul className="text-sm space-y-1.5 text-red-700 dark:text-red-300">
              <li className="flex items-center gap-2"><span className="text-red-500">✕</span> Your profile and personal data</li>
              <li className="flex items-center gap-2"><span className="text-red-500">✕</span> All your rides and bookings history</li>
              <li className="flex items-center gap-2"><span className="text-red-500">✕</span> Your community classifieds</li>
              <li className="flex items-center gap-2"><span className="text-red-500">✕</span> Your wallet balance (non-recoverable)</li>
            </ul>
            <div className="mt-4">
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">
                Type <span className="text-red-600 font-mono bg-red-50 dark:bg-red-950/30 px-1.5 py-0.5 rounded">DELETE</span> to confirm:
              </label>
              <input
                id="delete-confirm-input"
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="Type DELETE here..."
                className="w-full p-3 rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-white font-mono focus:outline-none focus:border-red-400 dark:focus:border-red-500 transition-colors"
              />
            </div>
            {deleteError && (
              <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 p-3 rounded-lg">{deleteError}</p>
            )}
          </div>

          <div className="flex gap-3">
            <button
              id="btn-cancel-delete"
              onClick={() => setShowDeleteModal(false)}
              disabled={isDeleting}
              className="flex-1 py-3 px-4 rounded-xl border-2 border-slate-200 dark:border-slate-700 font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              id="btn-confirm-delete"
              onClick={handleDeleteAccount}
              disabled={deleteConfirmText !== 'DELETE' || isDeleting}
              className="flex-1 py-3 px-4 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-red-300 dark:disabled:bg-red-900/40 text-white font-bold transition-all cursor-pointer disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isDeleting ? (
                <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Deleting...</>
              ) : (
                <><Trash2 size={15} /> Confirm Delete</>
              )}
            </button>
          </div>
        </div>
      </div>
    )}
  </>
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
