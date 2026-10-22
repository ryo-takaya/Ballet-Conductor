"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ApiError } from "@/lib/api";
import { useAuth } from "./AuthProvider";
import styles from "./AuthForm.module.css";

type Mode = "login" | "signup";

export default function AuthForm() {
  const router = useRouter();
  const { user, login, signup, logout } = useAuth();
  // トップページの「新規登録」から来たときは ?mode=signup で新規登録を開く
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>(searchParams.get("mode") === "signup" ? "signup" : "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (mode === "login") await login(email, password);
      else await signup(name, email, password);
      router.push("/tracks");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "うまくいきませんでした。もう一度お試しください。");
    } finally {
      setSubmitting(false);
    }
  };

  // すでにログインしているときは、フォームの代わりに状態を表示する
  if (user) {
    return (
      <section className={styles.card}>
        <h2 className={styles.title}>ログイン中です</h2>
        <p className={styles.note}>
          {user.name} さん（{user.email}）としてログインしています。
        </p>
        <div className={styles.row}>
          <Link href="/tracks" className={`${styles.submit} ${styles.linkButton}`}>
            トラックへ
          </Link>
          <button type="button" className={styles.secondary} onClick={logout}>
            ログアウト
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.card}>
      <div className={styles.tabs} role="tablist" aria-label="ログインか新規登録かを選ぶ">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "login"}
          className={`${styles.tab} ${mode === "login" ? styles.tabActive : ""}`}
          onClick={() => switchMode("login")}
        >
          ログイン
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "signup"}
          className={`${styles.tab} ${mode === "signup" ? styles.tabActive : ""}`}
          onClick={() => switchMode("signup")}
        >
          新規登録
        </button>
      </div>

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        {mode === "signup" && (
          <label className={styles.field}>
            <span className={styles.label}>名前</span>
            <input
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
              maxLength={255}
            />
          </label>
        )}
        <label className={styles.field}>
          <span className={styles.label}>メールアドレス</span>
          <input
            className={styles.input}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
            required
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>パスワード</span>
          <input
            className={styles.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
          />
          {mode === "signup" && <span className={styles.hint}>8文字以上</span>}
        </label>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <button type="submit" className={styles.submit} disabled={submitting}>
          {submitting ? "確認しています…" : mode === "login" ? "ログイン" : "登録してログイン"}
        </button>
      </form>
    </section>
  );
}
