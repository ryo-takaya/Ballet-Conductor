"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiFetch, ApiError, type AuthResponse, type User } from "@/lib/api";

const TOKEN_KEY = "authToken";

type AuthContextValue = {
  user: User | null;
  /** API を呼ぶときに付けるトークン（ログインしていなければ null） */
  token: string | null;
  /** 保存済みのトークンでログイン状態を確かめている間は true */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  /** プロフィールを変えたあとに、画面に出している利用者の情報を差し替える */
  updateUser: (user: User) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 開いたときに、保存してあるトークンが使えるかを確かめる
  useEffect(() => {
    const token = readToken();
    const check = token ? apiFetch<{ user: User }>("/auth/me", { token }) : Promise.resolve(null);
    check
      .then((result) => {
        setUser(result?.user ?? null);
        setToken(result ? token : null);
      })
      .catch((err) => {
        // トークンが無効なときだけ消す（サーバーに届かないときは残しておく）
        if (err instanceof ApiError && err.status === 401) writeToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const applyAuth = useCallback(({ token, user }: AuthResponse) => {
    writeToken(token);
    setToken(token);
    setUser(user);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      applyAuth(await apiFetch<AuthResponse>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }));
    },
    [applyAuth],
  );

  const signup = useCallback(
    async (name: string, email: string, password: string) => {
      applyAuth(
        await apiFetch<AuthResponse>("/auth/signup", { method: "POST", body: JSON.stringify({ name, email, password }) }),
      );
    },
    [applyAuth],
  );

  const logout = useCallback(() => {
    writeToken(null);
    setToken(null);
    setUser(null);
  }, []);

  const updateUser = useCallback((next: User) => setUser(next), []);

  const value = useMemo(
    () => ({ user, token, loading, login, signup, logout, updateUser }),
    [user, token, loading, login, signup, logout, updateUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth は AuthProvider の中で使ってください");
  return ctx;
}
