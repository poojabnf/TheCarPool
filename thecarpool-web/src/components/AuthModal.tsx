import React, { useState } from 'react';
import { X, Lock } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AuthModal({ isOpen, onClose, onSuccess }: AuthModalProps) {
  const [formData, setFormData] = useState({ firstName: '', lastName: '', mobile: '', email: '' });

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.firstName && formData.mobile) {
      onSuccess();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-800 w-full max-w-md rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
        
        <div className="flex justify-between items-center p-6 border-b border-slate-100 dark:border-slate-700">
          <div className="flex items-center space-x-2">
            <Lock className="text-emerald-500" size={24} />
            <h2 className="text-xl font-bold text-slate-800 dark:text-white">Secure Sign In</h2>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="flex space-x-4">
            <div className="flex-1 space-y-1">
              <label className="text-xs font-semibold text-slate-500 uppercase">First Name *</label>
              <input required type="text" placeholder="e.g. Pooja" value={formData.firstName} onChange={(e) => setFormData({...formData, firstName: e.target.value})} className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" />
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-xs font-semibold text-slate-500 uppercase">Last Name</label>
              <input type="text" placeholder="Optional" value={formData.lastName} onChange={(e) => setFormData({...formData, lastName: e.target.value})} className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500 uppercase">Mobile Number *</label>
            <input required type="tel" placeholder="+91 9876543210" value={formData.mobile} onChange={(e) => setFormData({...formData, mobile: e.target.value})} className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500 uppercase">Email Address</label>
            <input type="email" placeholder="Optional" value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})} className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" />
          </div>

          <button type="submit" className="w-full py-3.5 mt-2 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl shadow-lg shadow-emerald-200 dark:shadow-none transition-colors">
            Continue securely
          </button>
        </form>

      </div>
    </div>
  );
}
