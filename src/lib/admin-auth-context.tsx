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

function readStoredAdminKey(): string | null {
  if (typeof window === "undefined") return null;

  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [adminKey, setAdminKey] = useState<string | null>(null);

  useEffect(() => {
    setAdminKey(readStoredAdminKey());
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
    const currentKey = readStoredAdminKey();
    return currentKey ? { "x-admin-key": currentKey } : {};
  }, []);

  const authedFetch = useCallback((url: string, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const currentKey = readStoredAdminKey();
    if (currentKey) headers.set("x-admin-key", currentKey);
    return fetch(url, { ...init, headers });
  }, []);

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
