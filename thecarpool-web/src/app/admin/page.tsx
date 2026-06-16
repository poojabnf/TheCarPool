"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import { auth } from "../../lib/firebase";
import Dashboard from "../../components/Dashboard";

export default function AdminPortal() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    if (loading) return;

    if (!user) {
      router.replace("/");
      return;
    }

    // Verify the user holds the `admin` custom claim. Claims are set
    // server-side via admin.auth().setCustomUserClaims(uid, { admin: true }).
    (async () => {
      try {
        const token = await auth.currentUser?.getIdTokenResult(true);
        if (token?.claims.admin === true) {
          setAuthorized(true);
        } else {
          setAuthorized(false);
          router.replace("/customer");
        }
      } catch {
        setAuthorized(false);
        router.replace("/customer");
      }
    })();
  }, [user, loading, router]);

  if (loading || authorized === null) {
    return (
      <div className="min-h-screen flex flex-col justify-center items-center bg-slate-50 dark:bg-slate-900">
        <div className="w-16 h-16 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        <p className="mt-4 text-slate-600 dark:text-slate-400 font-semibold">Verifying admin access…</p>
      </div>
    );
  }

  if (!authorized) return null;

  return (
    <main>
      <Dashboard />
    </main>
  );
}
