"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch, ApiError, type UserDetail } from "@/lib/api";
import AddressSection from "./AddressSection";
import { useAuth } from "./AuthProvider";
import styles from "./AccountDetail.module.css";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
}

const messageOf = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

export default function AccountDetail() {
  const { token, updateUser } = useAuth();
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    apiFetch<{ user: UserDetail }>("/users/me", { token })
      .then((res) => setDetail(res.user))
      .catch((err) => setLoadError(messageOf(err, "ユーザー情報を読み込めませんでした。")));
  }, [token]);

  if (loadError) return <p className={styles.error}>{loadError}</p>;
  if (!detail) return <p className={styles.loading}>読み込んでいます…</p>;

  return (
    <div className={styles.stack}>
      <section className={styles.card}>
        <p className={styles.label}>ユーザー詳細</p>
        <h1 className={styles.name}>{detail.name} さん</h1>
        <dl className={styles.facts}>
          <div>
            <dt>メールアドレス</dt>
            <dd>{detail.email}</dd>
          </div>
          <div>
            <dt>登録日</dt>
            <dd>{formatDate(detail.createdAt)}</dd>
          </div>
          <div>
            <dt>トラック</dt>
            <dd>
              <Link href="/tracks" className={styles.link}>
                {detail.trackCount} 件
              </Link>
            </dd>
          </div>
        </dl>
      </section>

      <ProfileForm
        detail={detail}
        onSaved={(next) => {
          setDetail(next);
          updateUser({ id: next.id, name: next.name, email: next.email });
        }}
      />
      <AddressSection />
    </div>
  );
}

function ProfileForm({ detail, onSaved }: { detail: UserDetail; onSaved: (next: UserDetail) => void }) {
  const { token } = useAuth();
  const [name, setName] = useState(detail.name);
  const [email, setEmail] = useState(detail.email);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const changed = name.trim() !== detail.name || email.trim() !== detail.email;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const res = await apiFetch<{ user: UserDetail }>("/users/me", {
        method: "PATCH",
        token,
        body: JSON.stringify({ name, email }),
      });
      onSaved(res.user);
      setName(res.user.name);
      setEmail(res.user.email);
      setMessage({ kind: "info", text: "保存しました。" });
    } catch (err) {
      setMessage({ kind: "error", text: messageOf(err, "保存できませんでした。") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>名前とメールアドレス</h2>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>名前</span>
          <input
            className={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            maxLength={255}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>メールアドレス</span>
          <input
            className={styles.input}
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </label>
        {message && (
          <p className={message.kind === "error" ? styles.error : styles.notice} role="status">
            {message.text}
          </p>
        )}
        <div className={styles.actions}>
          <button type="submit" className={styles.primary} disabled={!changed || saving}>
            {saving ? "保存しています…" : "変更を保存"}
          </button>
        </div>
      </form>
    </section>
  );
}
