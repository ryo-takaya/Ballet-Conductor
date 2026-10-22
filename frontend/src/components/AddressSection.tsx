"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError, type ShippingAddress } from "@/lib/api";
import { PREFECTURES } from "@/lib/prefectures";
import { useAuth } from "./AuthProvider";
import ConfirmDialog from "./ConfirmDialog";
import styles from "./AccountDetail.module.css";

const EMPTY_FORM = {
  recipientName: "",
  postalCode: "",
  prefecture: "",
  city: "",
  addressLine1: "",
  addressLine2: "",
  isDefault: false,
};

const messageOf = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

function formatAddress(a: ShippingAddress) {
  return `${a.prefecture}${a.city}${a.addressLine1}${a.addressLine2 ? ` ${a.addressLine2}` : ""}`;
}

/** CD の送付先住所の一覧と追加 */
export default function AddressSection() {
  const { token } = useAuth();
  const [addresses, setAddresses] = useState<ShippingAddress[] | null>(null);
  const [listError, setListError] = useState("");
  const [actionError, setActionError] = useState("");
  const [deleting, setDeleting] = useState<ShippingAddress | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    apiFetch<{ addresses: ShippingAddress[] }>("/users/me/addresses", { token })
      .then((res) => setAddresses(res.addresses))
      .catch((err) => setListError(messageOf(err, "送付先を読み込めませんでした。")));
  }, [token]);

  const setDefault = async (a: ShippingAddress) => {
    setActionError("");
    try {
      const res = await apiFetch<{ addresses: ShippingAddress[] }>(`/users/me/addresses/${a.id}/default`, {
        method: "PUT",
        token,
      });
      setAddresses(res.addresses);
    } catch (err) {
      setActionError(messageOf(err, "デフォルトの送付先を変えられませんでした。"));
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setActionError("");
    setDeleteBusy(true);
    try {
      const res = await apiFetch<{ addresses: ShippingAddress[] }>(`/users/me/addresses/${deleting.id}`, {
        method: "DELETE",
        token,
      });
      setAddresses(res.addresses);
    } catch (err) {
      setActionError(messageOf(err, "送付先を削除できませんでした。"));
    } finally {
      setDeleteBusy(false);
      setDeleting(null);
    }
  };

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>CD の送付先住所</h2>
        {!formOpen && (
          <button type="button" className={styles.primary} onClick={() => setFormOpen(true)}>
            ＋ 住所を追加
          </button>
        )}
      </div>
      <p className={styles.hint}>CD の作成を依頼したときに、ここに登録した住所へお送りします。</p>

      {listError ? (
        <p className={styles.error}>{listError}</p>
      ) : addresses === null ? (
        <p className={styles.hint}>読み込んでいます…</p>
      ) : addresses.length === 0 ? (
        !formOpen && <p className={styles.emptyBox}>まだ送付先が登録されていません。</p>
      ) : (
        <ul className={styles.addressList}>
          {addresses.map((a) => (
            <li key={a.id} className={`${styles.addressItem} ${a.isDefault ? styles.addressDefault : ""}`}>
              <div className={styles.addressBody}>
                {a.isDefault && <span className={styles.badge}>デフォルト</span>}
                <p className={styles.addressName}>{a.recipientName} 様</p>
                <p className={styles.addressText}>
                  〒{a.postalCode}
                  <br />
                  {formatAddress(a)}
                </p>
              </div>
              <div className={styles.addressActions}>
                {!a.isDefault && (
                  <button type="button" className={styles.secondary} onClick={() => setDefault(a)}>
                    デフォルトにする
                  </button>
                )}
                <button type="button" className={styles.secondary} onClick={() => setDeleting(a)}>
                  削除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {actionError && <p className={styles.error}>{actionError}</p>}

      {formOpen && (
        <AddressForm
          isFirst={(addresses?.length ?? 0) === 0}
          onCancel={() => setFormOpen(false)}
          onSaved={(next) => {
            setAddresses(next);
            setFormOpen(false);
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="この送付先を削除しますか？"
        confirmLabel={deleteBusy ? "削除しています…" : "削除する"}
        danger
        busy={deleteBusy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      >
        {deleting && (
          <p>
            {deleting.recipientName} 様（〒{deleting.postalCode} {formatAddress(deleting)}）
            {deleting.isDefault && "。デフォルトの送付先を削除すると、残りの住所のうち最初に登録したものがデフォルトになります"}
          </p>
        )}
      </ConfirmDialog>
    </section>
  );
}

function AddressForm({
  isFirst,
  onCancel,
  onSaved,
}: {
  isFirst: boolean;
  onCancel: () => void;
  onSaved: (addresses: ShippingAddress[]) => void;
}) {
  const { token } = useAuth();
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = <K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const res = await apiFetch<{ addresses: ShippingAddress[] }>("/users/me/addresses", {
        method: "POST",
        token,
        body: JSON.stringify(form),
      });
      onSaved(res.addresses);
    } catch (err) {
      setError(messageOf(err, "送付先を追加できませんでした。"));
      setSaving(false);
    }
  };

  return (
    <form className={`${styles.form} ${styles.addressForm}`} onSubmit={handleSubmit} noValidate>
      <h3 className={styles.formTitle}>新しい送付先</h3>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>宛名</span>
        <input
          className={styles.input}
          value={form.recipientName}
          onChange={(e) => set("recipientName", e.target.value)}
          autoComplete="name"
          placeholder="例：山田 花子"
        />
      </label>
      <div className={styles.fieldRow}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>郵便番号</span>
          <input
            className={styles.input}
            value={form.postalCode}
            onChange={(e) => set("postalCode", e.target.value)}
            autoComplete="postal-code"
            inputMode="numeric"
            placeholder="例：150-0001"
            maxLength={8}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>都道府県</span>
          <select
            className={styles.input}
            value={form.prefecture}
            onChange={(e) => set("prefecture", e.target.value)}
            autoComplete="address-level1"
          >
            <option value="">選んでください</option>
            {PREFECTURES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>市区町村</span>
        <input
          className={styles.input}
          value={form.city}
          onChange={(e) => set("city", e.target.value)}
          autoComplete="address-level2"
          placeholder="例：渋谷区"
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>町名・番地</span>
        <input
          className={styles.input}
          value={form.addressLine1}
          onChange={(e) => set("addressLine1", e.target.value)}
          autoComplete="address-line1"
          placeholder="例：神宮前1-2-3"
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>
          建物名・部屋番号<span className={styles.optional}>（任意）</span>
        </span>
        <input
          className={styles.input}
          value={form.addressLine2}
          onChange={(e) => set("addressLine2", e.target.value)}
          autoComplete="address-line2"
          placeholder="例：バレエビル 3F"
        />
      </label>
      {isFirst ? (
        <p className={styles.hint}>最初に登録した住所が、デフォルトの送付先になります。</p>
      ) : (
        <label className={styles.checkbox}>
          <input type="checkbox" checked={form.isDefault} onChange={(e) => set("isDefault", e.target.checked)} />
          デフォルトの送付先にする
        </label>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.formActions}>
        <button type="button" className={styles.secondary} onClick={onCancel} disabled={saving}>
          キャンセル
        </button>
        <button type="submit" className={styles.primary} disabled={saving}>
          {saving ? "追加しています…" : "この住所を追加"}
        </button>
      </div>
    </form>
  );
}
