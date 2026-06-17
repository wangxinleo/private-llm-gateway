"use client";

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";

interface AdminAuthContextValue {
  adminKey: string | null;
  authenticated: boolean;
  login: (key: string) => void;
  logout: () => void;
  authHeaders: () => Record<string, string>;
  authedFetch: (url: string, init?: RequestInit) => Promise<Response>;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

const STORAGE_KEY = "pp_admin_key";

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [adminKey, setAdminKey] = useState<string | null>(null);

  useEffect(() => {
    setAdminKey(sessionStorage.getItem(STORAGE_KEY));
  }, []);

  const login = useCallback((key: string) => {
    sessionStorage.setItem(STORAGE_KEY, key);
    setAdminKey(key);
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    setAdminKey(null);
  }, []);

  const authHeaders = useCallback((): Record<string, string> => {
    return adminKey ? { "x-admin-key": adminKey } : {};
  }, [adminKey]);

  const authedFetch = useCallback((url: string, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    if (adminKey) headers.set("x-admin-key", adminKey);
    return fetch(url, { ...init, headers });
  }, [adminKey]);

  return (
    <AdminAuthContext.Provider value={{ adminKey, authenticated: !!adminKey, login, logout, authHeaders, authedFetch }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth(): AdminAuthContextValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error("useAdminAuth must be used within AdminAuthProvider");
  return ctx;
}
