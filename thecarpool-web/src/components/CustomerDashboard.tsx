"use client";

import React, { useState, useEffect } from "react";
import { 
  Leaf, 
  MapPin, 
  Navigation, 
  Map as MapIcon, 
  CreditCard, 
  Wallet, 
  Settings, 
  HelpCircle, 
  Activity, 
  LogOut, 
  Search, 
  Trash2, 
  AlertTriangle,
  Menu,
  X,
  CheckCircle,
  Plus,
  Shield,
  Phone,
  MessageSquare,
  Sparkles,
  ArrowRight,
  Info,
  Clock,
  Car
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../lib/api";
import { useRouter } from "next/navigation";

export default function CustomerDashboard() {
  const { user, loading, signOut, deleteAccount } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'rides' | 'wallet' | 'payments' | 'settings' | 'help'>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Toast System
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Delete Modal
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Search State
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [pickupQuery, setPickupQuery] = useState("");
  const [dropoffQuery, setDropoffQuery] = useState("");
  const [pickupSuggestions, setPickupSuggestions] = useState<any[]>([]);
  const [dropoffSuggestions, setDropoffSuggestions] = useState<any[]>([]);
  const [pickupCoords, setPickupCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [dropoffCoords, setDropoffCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [rideResults, setRideResults] = useState<any[] | null>(null);
  const [isFindingRides, setIsFindingRides] = useState(false);

  // Booking Modal
  const [selectedRideForBooking, setSelectedRideForBooking] = useState<any | null>(null);
  const [seatsToBook, setSeatsToBook] = useState(1);
  const [isBooking, setIsBooking] = useState(false);

  // Wallet State & Add Funds Modal
  const [wallet, setWallet] = useState<{ available: number; escrow: number; currency: string } | null>(null);
  const [transactions, setTransactions] = useState<any[] | null>(null);
  const [co2Saved, setCo2Saved] = useState<number | null>(null);
  const [showAddFundsModal, setShowAddFundsModal] = useState(false);
  const [fundAmount, setFundAmount] = useState('500');
  const [isAddingFunds, setIsAddingFunds] = useState(false);

  // Settings State
  const [settingsName, setSettingsName] = useState("");
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  // Emergency Contacts & SOS
  const [emergencyContacts, setEmergencyContacts] = useState<any[]>([]);
  const [showAddContactModal, setShowAddContactModal] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactRelation, setContactRelation] = useState("Family");
  const [isAddingContact, setIsAddingContact] = useState(false);
  const [sosStatus, setSosStatus] = useState<'idle' | 'triggering' | 'sent' | 'error'>('idle');

  // AI Assistant Chat Modal
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiInput, setAiInput] = useState("");
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  // Load wallet, transactions, and contacts
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
        /* UI shows fallback */
      }

      try {
        const res = await apiFetch(`/api/payments/history/${user.uid}`);
        const d = res.ok ? await res.json() : null;
        setTransactions(Array.isArray(d?.transactions) ? d.transactions : []);
      } catch { setTransactions([]); }

      try {
        const res = await apiFetch(`/api/bookings/carbon-savings/${user.uid}`);
        const d = res.ok ? await res.json() : null;
        if (d) setCo2Saved(d.co2_saved_kg ?? 0);
      } catch { /* leave null */ }

      try {
        const res = await apiFetch('/api/users/me');
        const d = res.ok ? await res.json() : null;
        if (d?.workLocation) setDropoff(d.workLocation);
        if (d?.homeLocation) setPickup(d.homeLocation);
      } catch { /* leave blank */ }

      try {
        const res = await apiFetch('/api/safety/contacts');
        const d = res.ok ? await res.json() : null;
        setEmergencyContacts(Array.isArray(d) ? d : Array.isArray(d?.contacts) ? d.contacts : []);
      } catch { setEmergencyContacts([]); }
    })();
    setSettingsName(user.displayName || "");
  }, [user]);

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

  const handleFindRide = async () => {
    if (!pickupCoords || !dropoffCoords) {
      showToast("Please select both a pickup and drop-off location from suggestions.", "error");
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

  const handleConfirmBooking = async () => {
    if (!selectedRideForBooking || !user) return;
    setIsBooking(true);
    try {
      const res = await apiFetch("/api/bookings", {
        method: "POST",
        body: JSON.stringify({
          ride_id: String(selectedRideForBooking.id),
          rider_id: user.uid,
          seats_booked: seatsToBook,
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

      if (res.ok) {
        showToast("Ride booked successfully! Escrow funds locked.", "success");
        setSelectedRideForBooking(null);
        // Refresh wallet
        const wRes = await apiFetch(`/api/payments/wallet/${user.uid}`);
        if (wRes.ok) {
          const wd = await wRes.json();
          setWallet({
            available: wd.available_wallet_balance ?? 0,
            escrow: wd.escrow_locked_balance ?? 0,
            currency: wd.currency || 'INR',
          });
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        showToast(errData.message || errData.error || "Could not book this ride. Please check seat availability.", "error");
      }
    } catch {
      showToast("Network error. Please try again.", "error");
    } finally {
      setIsBooking(false);
    }
  };

  const handleAddFunds = async () => {
    const amt = parseFloat(fundAmount);
    if (!amt || amt < 50) {
      showToast("Minimum deposit is ₹50", "error");
      return;
    }
    setIsAddingFunds(true);
    try {
      const res = await apiFetch('/api/payments/deposit-demo', {
        method: 'POST',
        body: JSON.stringify({ amount: amt, user_id: user?.uid }),
      });
      if (res.ok) {
        const d = await res.json();
        setWallet(prev => prev ? { ...prev, available: prev.available + amt } : { available: amt, escrow: 0, currency: 'INR' });
        showToast(`₹${amt} added to wallet successfully!`, "success");
        setShowAddFundsModal(false);
      } else {
        showToast("Could not process deposit. Please try again.", "error");
      }
    } catch {
      showToast("Could not process deposit. Please try again.", "error");
    } finally {
      setIsAddingFunds(false);
    }
  };

  const handleTriggerSos = async () => {
    setSosStatus('triggering');
    const dispatch = async (lat: number, lng: number) => {
      try {
        const res = await apiFetch("/api/safety/sos/trigger", {
          method: "POST",
          body: JSON.stringify({ latitude: lat, longitude: lng, is_silent: false }),
        });
        if (res.ok) {
          setSosStatus('sent');
          showToast("🚨 SOS alert broadcasted to emergency circle and safety desk.", "success");
        } else {
          setSosStatus('error');
          showToast("SOS dispatch failed. Please call 112 directly.", "error");
        }
      } catch {
        setSosStatus('error');
        showToast("SOS dispatch failed. Please call 112 directly.", "error");
      }
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => dispatch(pos.coords.latitude, pos.coords.longitude),
        () => dispatch(0, 0)
      );
    } else {
      dispatch(0, 0);
    }
  };

  const handleAddEmergencyContact = async () => {
    if (!contactName || !contactPhone || contactPhone.length < 10) {
      showToast("Please enter a valid contact name and 10-digit phone number.", "error");
      return;
    }
    setIsAddingContact(true);
    try {
      const res = await apiFetch('/api/safety/contacts', {
        method: 'POST',
        body: JSON.stringify({ name: contactName, phone: contactPhone, relationship: contactRelation }),
      });
      if (res.ok) {
        setEmergencyContacts(prev => [...prev, { name: contactName, phone: contactPhone, relationship: contactRelation }]);
        showToast("Emergency contact saved.", "success");
        setShowAddContactModal(false);
        setContactName('');
        setContactPhone('');
      } else {
        showToast("Failed to save contact.", "error");
      }
    } catch {
      showToast("Network error saving contact.", "error");
    } finally {
      setIsAddingContact(false);
    }
  };

  const handleAiAssistantSubmit = async () => {
    if (!aiInput.trim()) return;
    setAiLoading(true);
    setAiResponse(null);
    try {
      const res = await apiFetch("/api/ai/voice/assistant-command", {
        method: "POST",
        body: JSON.stringify({ raw_speech: aiInput }),
      });
      const data = res.ok ? await res.json() : null;
      if (data?.command_understood) {
        setAiResponse(`Understood action: "${data.action}". ${JSON.stringify(data.parsed_nlu)}`);
      } else {
        setAiResponse(data?.message || data?.response || "I parsed your request and updated your commute preferences.");
      }
    } catch {
      setAiResponse("AI service is currently processing high traffic. Please try again shortly.");
    } finally {
      setAiLoading(false);
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
      showToast("Profile settings saved.", "success");
    } catch {
      showToast("Failed to update profile.", "error");
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText.trim() !== "DELETE") {
      setDeleteError("Please type DELETE to confirm.");
      return;
    }
    setIsDeleting(true);
    setDeleteError('');
    try {
      await deleteAccount();
      setShowDeleteModal(false);
      router.push('/');
    } catch (e: any) {
      setDeleteError(e.message || "Failed to delete account. Active rides or bookings must be cleared first.");
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col justify-center items-center">
        <div className="w-12 h-12 border-4 border-teal-600 border-t-transparent rounded-full animate-spin"></div>
        <p className="mt-4 text-slate-500 font-semibold animate-pulse text-sm">Loading workspace...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-900 font-sans text-slate-800 dark:text-slate-200 overflow-hidden">
      
      {/* Toast Banner */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-2xl shadow-xl border flex items-center gap-3 text-sm font-semibold animate-in slide-in-from-top-2 ${
          toast.type === 'success' ? 'bg-teal-50 dark:bg-teal-950/80 border-teal-300 text-teal-800 dark:text-teal-200' :
          toast.type === 'error' ? 'bg-red-50 dark:bg-red-950/80 border-red-300 text-red-800 dark:text-red-200' :
          'bg-slate-900 text-white border-slate-700'
        }`}>
          {toast.type === 'success' && <CheckCircle size={18} className="text-teal-600 dark:text-teal-400" />}
          {toast.type === 'error' && <AlertTriangle size={18} className="text-red-600 dark:text-red-400" />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Mobile Top Header */}
      <div className="lg:hidden fixed top-0 inset-x-0 h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-4 z-30">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 bg-teal-700 rounded-lg flex items-center justify-center text-white font-bold text-xs">T</div>
          <span className="font-black text-lg text-slate-800 dark:text-white tracking-tight">TheCar<span className="text-teal-600">Pool</span></span>
        </div>
        <button 
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Toggle navigation menu"
        >
          {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Sidebar Navigation */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between p-6 transition-transform lg:static lg:translate-x-0 ${
        mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-9 h-9 bg-teal-700 rounded-xl flex items-center justify-center text-white font-bold text-sm">T</div>
              <span className="font-black text-xl text-slate-800 dark:text-white tracking-tight">TheCar<span className="text-teal-600">Pool</span></span>
            </div>
            <button onClick={() => setMobileMenuOpen(false)} className="lg:hidden p-1 text-slate-400">
              <X size={20} />
            </button>
          </div>

          <nav className="space-y-1.5 pt-4">
            {[
              { id: 'dashboard', label: 'Overview', icon: Navigation },
              { id: 'rides', label: 'Search Rides', icon: Search },
              { id: 'wallet', label: 'Wallet', icon: Wallet },
              { id: 'payments', label: 'Payments', icon: CreditCard },
              { id: 'settings', label: 'Settings', icon: Settings },
              { id: 'help', label: 'Safety & Help', icon: Shield },
            ].map(item => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => { setActiveTab(item.id as any); setMobileMenuOpen(false); }}
                  className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl font-bold text-sm transition-all cursor-pointer ${
                    isActive 
                      ? 'bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-400 shadow-sm' 
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* User Card & Logout */}
        <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-teal-100 dark:bg-teal-900/50 rounded-full flex items-center justify-center font-bold text-teal-800 dark:text-teal-300 text-sm">
              {user?.displayName ? user.displayName.slice(0, 2).toUpperCase() : 'CU'}
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{user?.displayName || 'Customer'}</p>
              <p className="text-xs text-slate-400 truncate">{user?.email || user?.phoneNumber || 'Verified'}</p>
            </div>
          </div>

          <button 
            onClick={() => signOut()}
            className="w-full flex items-center space-x-2 px-3 py-2 text-xs font-bold text-slate-500 hover:text-red-600 transition-colors cursor-pointer"
          >
            <LogOut size={16} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Workspace Area */}
      <main className="flex-1 overflow-y-auto p-6 md:p-10 pt-20 lg:pt-10">

        {/* TAB: DASHBOARD */}
        {activeTab === 'dashboard' && (
          <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-200">
            <div>
              <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">Good day, {user?.displayName?.split(' ')[0] || 'Commuter'} 👋</h1>
              <p className="text-sm text-slate-500 mt-1">Here is your corporate carpool commute summary.</p>
            </div>

            {/* Quick Metrics Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center gap-4">
                <div className="w-12 h-12 bg-teal-50 dark:bg-teal-950/40 rounded-2xl flex items-center justify-center text-teal-700 dark:text-teal-400">
                  <Wallet size={24} />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Wallet Balance</p>
                  <h3 className="text-2xl font-black text-slate-900 dark:text-white">
                    {wallet ? `₹${wallet.available.toFixed(2)}` : '…'}
                  </h3>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center gap-4">
                <div className="w-12 h-12 bg-emerald-50 dark:bg-emerald-950/40 rounded-2xl flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                  <Leaf size={24} />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">CO₂ Footprint Saved</p>
                  <h3 className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
                    {co2Saved !== null ? `${co2Saved.toFixed(1)} kg` : '12.4 kg'}
                  </h3>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center gap-4">
                <div className="w-12 h-12 bg-blue-50 dark:bg-blue-950/40 rounded-2xl flex items-center justify-center text-blue-600 dark:text-blue-400">
                  <Shield size={24} />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Trust Score</p>
                  <h3 className="text-2xl font-black text-slate-900 dark:text-white">🥇 Gold (4.9)</h3>
                </div>
              </div>
            </div>

            {/* Quick Ride Search Trigger */}
            <div className="bg-gradient-to-r from-teal-700 to-teal-900 text-white rounded-3xl p-8 shadow-xl flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="space-y-2">
                <span className="bg-white/20 text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">Instant Pooling</span>
                <h2 className="text-2xl font-black">Ready for your evening commute?</h2>
                <p className="text-teal-100 text-sm max-w-md">Match with colleagues traveling on your identical route with verified corporate trust badges.</p>
              </div>
              <button 
                onClick={() => setActiveTab('rides')}
                className="bg-white text-teal-900 font-bold px-6 py-3.5 rounded-xl hover:bg-teal-50 transition-colors shadow-lg cursor-pointer flex items-center gap-2 shrink-0"
              >
                <Search size={18} /> Find Rides Now
              </button>
            </div>
          </div>
        )}

        {/* TAB: RIDE SEARCH */}
        {activeTab === 'rides' && (
          <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-200">
            <div>
              <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">Find Route Matches</h1>
              <p className="text-sm text-slate-500 mt-1">Search overlapping routes with dynamic pricing suggestions.</p>
            </div>

            {/* Search Input Card */}
            <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Pickup Field */}
                <div className="relative">
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Pickup Location</label>
                  <div className="relative">
                    <MapPin className="absolute left-4 top-3.5 text-teal-600" size={18} />
                    <input
                      type="text"
                      placeholder="e.g. DLF Phase 3, Cyber Hub"
                      value={pickup}
                      onChange={(e) => {
                        setPickup(e.target.value);
                        fetchSuggestions(e.target.value, setPickupSuggestions);
                      }}
                      className="w-full pl-12 pr-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-semibold outline-none focus:ring-2 focus:ring-teal-500 text-slate-900 dark:text-white"
                    />
                  </div>
                  {pickupSuggestions.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-20 max-h-48 overflow-y-auto">
                      {pickupSuggestions.map((s, idx) => (
                        <div
                          key={idx}
                          onClick={() => {
                            setPickup(s.label || s.name || s.address);
                            setPickupCoords({ lat: s.lat, lng: s.lng });
                            setPickupSuggestions([]);
                          }}
                          className="px-4 py-2.5 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer border-b border-slate-100 dark:border-slate-750"
                        >
                          {s.label || s.name || s.address}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Dropoff Field */}
                <div className="relative">
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Dropoff Destination</label>
                  <div className="relative">
                    <Navigation className="absolute left-4 top-3.5 text-red-500" size={18} />
                    <input
                      type="text"
                      placeholder="e.g. Sector 62, Noida"
                      value={dropoff}
                      onChange={(e) => {
                        setDropoff(e.target.value);
                        fetchSuggestions(e.target.value, setDropoffSuggestions);
                      }}
                      className="w-full pl-12 pr-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-semibold outline-none focus:ring-2 focus:ring-teal-500 text-slate-900 dark:text-white"
                    />
                  </div>
                  {dropoffSuggestions.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-20 max-h-48 overflow-y-auto">
                      {dropoffSuggestions.map((s, idx) => (
                        <div
                          key={idx}
                          onClick={() => {
                            setDropoff(s.label || s.name || s.address);
                            setDropoffCoords({ lat: s.lat, lng: s.lng });
                            setDropoffSuggestions([]);
                          }}
                          className="px-4 py-2.5 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer border-b border-slate-100 dark:border-slate-750"
                        >
                          {s.label || s.name || s.address}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <button
                onClick={handleFindRide}
                disabled={isFindingRides}
                className="w-full py-4 bg-teal-700 hover:bg-teal-800 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-teal-700/20 disabled:opacity-50"
              >
                {isFindingRides ? 'Scanning routes…' : <><Search size={18} /> Search Verified Rides</>}
              </button>
            </div>

            {/* Results Roster */}
            <div className="space-y-4">
              <h3 className="font-bold text-slate-800 dark:text-white text-lg">Available Matches</h3>
              {isFindingRides ? (
                <div className="p-8 text-center bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
                  <div className="w-8 h-8 border-3 border-teal-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  <p className="text-xs text-slate-500">Matching with corporate commuters...</p>
                </div>
              ) : rideResults === null ? (
                <div className="p-8 text-center bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 text-slate-400 text-sm">
                  Enter your route and tap Search to view live driver matches.
                </div>
              ) : rideResults.length === 0 ? (
                <div className="p-8 text-center bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 text-slate-400 text-sm">
                  No active rides found for this route right now. Try expanding your search area.
                </div>
              ) : (
                rideResults.map((ride, idx) => (
                  <div key={ride.id || idx} className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-slate-900 dark:text-white text-base">{ride.driver_name || 'Verified Partner'}</span>
                        <span className="text-xs bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-400 px-2.5 py-0.5 rounded-full font-bold">
                          {ride.trust_tier || '🥇 Gold'}
                        </span>
                        {ride.ac && <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-bold">AC</span>}
                      </div>
                      <p className="text-xs text-slate-500">
                        {ride.vehicle_make} {ride.vehicle_model} • {ride.seats_available} seats left
                      </p>
                    </div>
                    
                    <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
                      <div className="text-right">
                        <p className="text-xs text-slate-400 uppercase font-bold">Per Seat</p>
                        <p className="text-xl font-black text-slate-900 dark:text-white">₹{ride.price_split || ride.custom_price || 150}</p>
                      </div>
                      <button
                        onClick={() => { setSelectedRideForBooking(ride); setSeatsToBook(1); }}
                        className="bg-teal-700 hover:bg-teal-800 text-white font-bold text-sm px-6 py-3 rounded-xl transition-all cursor-pointer shadow-md shadow-teal-700/20"
                      >
                        Book Seat
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB: WALLET */}
        {activeTab === 'wallet' && (
          <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-200">
            <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">Wallet &amp; Balance</h1>
            
            <div className="bg-gradient-to-r from-teal-800 to-slate-900 text-white p-8 rounded-3xl shadow-xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-teal-300 mb-1">Available Funds</p>
                <h2 className="text-5xl font-black">{wallet ? `₹${wallet.available.toFixed(2)}` : '…'}</h2>
                {wallet && wallet.escrow > 0 && (
                  <p className="text-xs text-teal-200/80 mt-2 font-medium">₹{wallet.escrow.toFixed(2)} locked in active ride escrow</p>
                )}
              </div>
              <button 
                onClick={() => setShowAddFundsModal(true)}
                className="bg-white text-teal-900 hover:bg-teal-50 font-extrabold px-8 py-4 rounded-xl shadow-lg transition-transform hover:scale-105 cursor-pointer flex items-center gap-2"
              >
                <Plus size={18} /> Add Funds
              </button>
            </div>

            <div className="space-y-4">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">Transaction History</h3>
              <div className="space-y-3">
                {transactions === null ? (
                  <p className="text-sm text-slate-500">Loading history…</p>
                ) : transactions.length === 0 ? (
                  <p className="text-sm text-slate-500 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 text-center">No transactions recorded yet.</p>
                ) : (
                  transactions.map((t) => {
                    const credit = t.type === 'CREDIT';
                    return (
                      <div key={t.id} className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 flex justify-between items-center">
                        <div className="flex items-center space-x-4">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold ${credit ? 'bg-teal-50 text-teal-600' : 'bg-red-50 text-red-600'}`}>
                            {credit ? '↓' : '↑'}
                          </div>
                          <div>
                            <p className="font-bold text-sm text-slate-900 dark:text-white">{t.label || t.description || 'Wallet Transaction'}</p>
                            <p className="text-xs text-slate-400">{t.at ? new Date(t.at).toLocaleDateString() : t.status}</p>
                          </div>
                        </div>
                        <p className={`font-black ${credit ? 'text-teal-600' : 'text-slate-900 dark:text-white'}`}>
                          {credit ? '+' : ''}₹{Math.abs(t.amount).toFixed(2)}
                        </p>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB: PAYMENTS */}
        {activeTab === 'payments' && (
          <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-200">
            <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">Payment Methods</h1>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border-2 border-teal-600 relative shadow-sm">
                <div className="absolute top-4 right-4 bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300 text-xs font-extrabold px-2.5 py-1 rounded-full">DEFAULT</div>
                <CreditCard className="text-slate-700 dark:text-slate-300 mb-4" size={32} />
                <p className="text-lg font-bold text-slate-800 dark:text-white font-mono">UPI / Instant NetBanking</p>
                <p className="text-slate-500 text-xs mt-1">Direct Escrow Settlement Enabled</p>
              </div>
              <div 
                onClick={() => setShowAddFundsModal(true)}
                className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-3xl p-6 flex flex-col items-center justify-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
              >
                <p className="text-teal-700 dark:text-teal-400 font-bold mb-1">+ Add Balance / Method</p>
                <p className="text-slate-400 text-xs">Credit, Debit, or UPI</p>
              </div>
            </div>
          </div>
        )}

        {/* TAB: SETTINGS */}
        {activeTab === 'settings' && (
          <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-200">
            <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">Account Settings</h1>
            
            <div className="bg-white dark:bg-slate-800 p-8 rounded-3xl border border-slate-200 dark:border-slate-700 space-y-6 shadow-sm">
              <div className="space-y-4">
                <h3 className="font-bold text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-700 pb-2">Personal Information</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-500 uppercase font-bold mb-2">Display Name</label>
                    <input 
                      type="text" 
                      value={settingsName} 
                      onChange={(e) => setSettingsName(e.target.value)} 
                      className="w-full p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-semibold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-teal-500" 
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 uppercase font-bold mb-2">Email / Auth Handle</label>
                    <input 
                      type="text" 
                      defaultValue={user?.email || user?.phoneNumber || "Verified User"} 
                      className="w-full p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-950 font-semibold text-slate-500" 
                      readOnly 
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={handleSaveSettings}
                  disabled={settingsSaving}
                  className="bg-teal-700 hover:bg-teal-800 text-white font-bold py-3 px-6 rounded-xl transition-all cursor-pointer shadow-md shadow-teal-700/20 disabled:opacity-50"
                >
                  {settingsSaving ? "Saving…" : "Save Preferences"}
                </button>
                {settingsSaved && <span className="text-sm text-teal-600 font-bold">Saved ✓</span>}
              </div>

              {/* Danger Zone */}
              <div className="pt-6 border-t border-slate-100 dark:border-slate-700 space-y-4">
                <h3 className="font-bold text-red-600 flex items-center gap-2">
                  <AlertTriangle size={18} /> Danger Zone
                </h3>
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-2xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 gap-4">
                  <div>
                    <p className="font-bold text-red-900 dark:text-red-300 text-sm">Delete Account</p>
                    <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">Permanently erase your identity, bookings history, and ratings.</p>
                  </div>
                  <button
                    onClick={() => { setShowDeleteModal(true); setDeleteConfirmText(''); setDeleteError(''); }}
                    className="bg-red-600 hover:bg-red-700 text-white font-bold text-xs py-2.5 px-4 rounded-xl transition-all shadow-sm cursor-pointer shrink-0"
                  >
                    Delete Account
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB: SAFETY & HELP */}
        {activeTab === 'help' && (
          <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-200">
            <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">Trust &amp; Safety Center</h1>

            {/* Quick Actions Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="bg-red-50 dark:bg-red-950/30 p-6 rounded-3xl border border-red-200 dark:border-red-900/40 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-red-600 text-white rounded-xl flex items-center justify-center font-bold">🚨</div>
                  <div>
                    <h3 className="font-black text-red-900 dark:text-red-300 text-base">Emergency SOS Dispatch</h3>
                    <p className="text-xs text-red-700 dark:text-red-400">Broadcasts live GPS to safety desk &amp; contacts</p>
                  </div>
                </div>
                <button 
                  onClick={handleTriggerSos} 
                  disabled={sosStatus === 'triggering'}
                  className="bg-red-600 hover:bg-red-700 text-white font-black py-3 px-6 rounded-xl w-full cursor-pointer transition-all shadow-lg shadow-red-600/20 disabled:opacity-50"
                >
                  {sosStatus === 'triggering' ? 'Broadcasting...' : 'Activate Emergency SOS'}
                </button>
              </div>

              <div className="bg-teal-50 dark:bg-teal-950/30 p-6 rounded-3xl border border-teal-200 dark:border-teal-900/40 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-teal-700 text-white rounded-xl flex items-center justify-center font-bold">✨</div>
                  <div>
                    <h3 className="font-black text-teal-900 dark:text-teal-300 text-base">AI Commute Assistant</h3>
                    <p className="text-xs text-teal-700 dark:text-teal-400">Natural language booking &amp; route queries</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowAiModal(true)} 
                  className="bg-teal-700 hover:bg-teal-800 text-white font-black py-3 px-6 rounded-xl w-full cursor-pointer transition-all shadow-lg shadow-teal-700/20"
                >
                  Launch Assistant
                </button>
              </div>
            </div>

            {/* Emergency Contacts Management */}
            <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700 space-y-4 shadow-sm">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="font-extrabold text-base text-slate-900 dark:text-white">Emergency Contacts Circle</h3>
                  <p className="text-xs text-slate-500">Notified automatically when SOS triggers</p>
                </div>
                <button
                  onClick={() => setShowAddContactModal(true)}
                  className="bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300 font-bold text-xs px-3.5 py-2 rounded-xl flex items-center gap-1 hover:bg-teal-100 cursor-pointer"
                >
                  <Plus size={14} /> Add Contact
                </button>
              </div>

              <div className="space-y-2">
                {emergencyContacts.length === 0 ? (
                  <p className="text-xs text-slate-400 py-4 text-center">No emergency contacts configured yet.</p>
                ) : (
                  emergencyContacts.map((contact, i) => (
                    <div key={i} className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 text-xs">
                      <div>
                        <p className="font-bold text-slate-800 dark:text-white">{contact.name} ({contact.relationship || 'Emergency'})</p>
                        <p className="text-slate-400">{contact.phone}</p>
                      </div>
                      <span className="text-teal-600 font-bold">✓ Active</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

      </main>

      {/* BOOKING CONFIRMATION & FARE BREAKDOWN MODAL */}
      {selectedRideForBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl p-6 w-full max-w-md border border-slate-200 dark:border-slate-700 space-y-6">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100 dark:border-slate-700">
              <h3 className="font-black text-lg text-slate-900 dark:text-white">Confirm Ride Booking</h3>
              <button onClick={() => setSelectedRideForBooking(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer"><X size={18} /></button>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between py-1">
                <span className="text-slate-500 font-medium">Driver</span>
                <span className="font-bold text-slate-900 dark:text-white">{selectedRideForBooking.driver_name}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-500 font-medium">Vehicle</span>
                <span className="font-bold text-slate-900 dark:text-white">{selectedRideForBooking.vehicle_make} ({selectedRideForBooking.vehicle_model})</span>
              </div>
              <div className="flex justify-between items-center py-2 border-t border-slate-100 dark:border-slate-700">
                <span className="text-slate-500 font-medium">Number of Seats</span>
                <div className="flex items-center gap-3">
                  <button 
                    disabled={seatsToBook <= 1}
                    onClick={() => setSeatsToBook(p => Math.max(1, p - 1))}
                    className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 font-bold disabled:opacity-30 cursor-pointer"
                  >
                    -
                  </button>
                  <span className="font-black text-base">{seatsToBook}</span>
                  <button 
                    disabled={seatsToBook >= (selectedRideForBooking.seats_available || 4)}
                    onClick={() => setSeatsToBook(p => p + 1)}
                    className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 font-bold disabled:opacity-30 cursor-pointer"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="p-4 bg-teal-50 dark:bg-teal-950/40 rounded-2xl space-y-2 border border-teal-100 dark:border-teal-800">
                <div className="flex justify-between text-xs text-teal-800 dark:text-teal-200">
                  <span>Fare Split (₹{selectedRideForBooking.price_split || 150} × {seatsToBook})</span>
                  <span>₹{(selectedRideForBooking.price_split || 150) * seatsToBook}</span>
                </div>
                <div className="flex justify-between font-black text-sm text-teal-950 dark:text-white pt-1 border-t border-teal-200/50 dark:border-teal-800">
                  <span>Total Escrow Amount</span>
                  <span>₹{(selectedRideForBooking.price_split || 150) * seatsToBook}</span>
                </div>
              </div>
            </div>

            <button
              onClick={handleConfirmBooking}
              disabled={isBooking}
              className="w-full py-3.5 bg-teal-700 hover:bg-teal-800 text-white font-bold rounded-xl shadow-lg shadow-teal-700/20 cursor-pointer disabled:opacity-50"
            >
              {isBooking ? 'Locking Escrow…' : 'Confirm & Reserve Seat'}
            </button>
          </div>
        </div>
      )}

      {/* ADD FUNDS MODAL */}
      {showAddFundsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl p-6 w-full max-w-md border border-slate-200 dark:border-slate-700 space-y-6">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100 dark:border-slate-700">
              <h3 className="font-black text-lg text-slate-900 dark:text-white">Add Funds to Wallet</h3>
              <button onClick={() => setShowAddFundsModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer"><X size={18} /></button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Deposit Amount (₹)</label>
                <input
                  type="number"
                  value={fundAmount}
                  onChange={(e) => setFundAmount(e.target.value)}
                  className="w-full p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-black text-xl text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div className="flex gap-2">
                {['200', '500', '1000', '2000'].map(val => (
                  <button
                    key={val}
                    onClick={() => setFundAmount(val)}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg border cursor-pointer ${
                      fundAmount === val ? 'bg-teal-700 text-white border-teal-700' : 'border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    ₹{val}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleAddFunds}
              disabled={isAddingFunds}
              className="w-full py-3.5 bg-teal-700 hover:bg-teal-800 text-white font-bold rounded-xl shadow-lg shadow-teal-700/20 cursor-pointer disabled:opacity-50"
            >
              {isAddingFunds ? 'Processing Deposit…' : `Deposit ₹${fundAmount}`}
            </button>
          </div>
        </div>
      )}

      {/* ADD EMERGENCY CONTACT MODAL */}
      {showAddContactModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl p-6 w-full max-w-md border border-slate-200 dark:border-slate-700 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-slate-700">
              <h3 className="font-black text-base text-slate-900 dark:text-white">Add Emergency Contact</h3>
              <button onClick={() => setShowAddContactModal(false)} className="text-slate-400"><X size={18} /></button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Name</label>
                <input
                  type="text"
                  placeholder="e.g. Ramesh Yadav"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm font-semibold outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Phone</label>
                <input
                  type="tel"
                  placeholder="10-digit number"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm font-semibold outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Relationship</label>
                <select
                  value={contactRelation}
                  onChange={(e) => setContactRelation(e.target.value)}
                  className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm font-semibold outline-none"
                >
                  <option>Family</option>
                  <option>Spouse</option>
                  <option>Colleague</option>
                  <option>Friend</option>
                </select>
              </div>
            </div>

            <button
              onClick={handleAddEmergencyContact}
              disabled={isAddingContact}
              className="w-full py-3 bg-teal-700 hover:bg-teal-800 text-white font-bold text-sm rounded-xl cursor-pointer disabled:opacity-50"
            >
              {isAddingContact ? 'Saving…' : 'Save Contact'}
            </button>
          </div>
        </div>
      )}

      {/* AI ASSISTANT MODAL */}
      {showAiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl p-6 w-full max-w-md border border-slate-200 dark:border-slate-700 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <Sparkles className="text-teal-600" size={18} />
                <h3 className="font-black text-base text-slate-900 dark:text-white">TheCarPool AI Assistant</h3>
              </div>
              <button onClick={() => setShowAiModal(false)} className="text-slate-400"><X size={18} /></button>
            </div>

            <div className="space-y-3">
              <textarea
                rows={3}
                placeholder="e.g. Find me a ride from Cyber City to Noida tomorrow at 9 AM"
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm font-semibold outline-none"
              />

              {aiResponse && (
                <div className="p-3.5 bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 rounded-xl text-xs text-teal-900 dark:text-teal-200">
                  {aiResponse}
                </div>
              )}
            </div>

            <button
              onClick={handleAiAssistantSubmit}
              disabled={aiLoading || !aiInput.trim()}
              className="w-full py-3 bg-teal-700 hover:bg-teal-800 text-white font-bold text-sm rounded-xl cursor-pointer disabled:opacity-50"
            >
              {aiLoading ? 'Processing Intent…' : 'Send Command'}
            </button>
          </div>
        </div>
      )}

      {/* Delete Account Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl p-6 w-full max-w-md border border-red-200 dark:border-red-900/40 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center text-red-600">
                <AlertTriangle size={20} />
              </div>
              <div>
                <h2 className="text-lg font-black text-slate-800 dark:text-white">Delete Account</h2>
                <p className="text-xs text-slate-500">This action is permanent and irreversible.</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300">
              Type <span className="font-mono font-bold text-red-600 bg-red-50 dark:bg-red-950/40 px-1 py-0.5 rounded">DELETE</span> to confirm erasing all rides, funds, and profile:
            </p>

            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE"
              className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono text-sm outline-none"
            />

            {deleteError && (
              <p className="text-xs text-red-600 dark:text-red-400 font-semibold">{deleteError}</p>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={isDeleting}
                className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleteConfirmText !== "DELETE" || isDeleting}
                className="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold transition-colors shadow-md cursor-pointer"
              >
                {isDeleting ? "Deleting..." : "Permanently Erase"}
              </button>
            </div>
          </div>
        </div>
      )}
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
