"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  apiFetch,
  ApiError,
  returnBaseUrl,
  type CdOrderDetail,
  type Price,
  type ShippingAddress,
  type TrackDetail,
} from "@/lib/api";
import { formatPrice } from "@/lib/orderStatus";
import { useAuth } from "../AuthProvider";
import styles from "./orders.module.css";

const messageOf = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/** トラックを CD にする依頼の確認画面。送付先と料金を確かめて、Stripe の支払い画面へ進む */
export default function CdOrderNew() {
  const trackId = useSearchParams().get("trackId") ?? "";
  const { token } = useAuth();
  const [track, setTrack] = useState<TrackDetail | null>(null);
  const [addresses, setAddresses] = useState<ShippingAddress[] | null>(null);
  const [addressId, setAddressId] = useState<number | null>(null);
  const [price, setPrice] = useState<Price | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch<{ track: TrackDetail }>(`/tracks/${encodeURIComponent(trackId)}`, { token }),
      apiFetch<{ addresses: ShippingAddress[] }>("/users/me/addresses", { token }),
      apiFetch<{ price: Price }>("/cd-orders/price", { token }),
    ])
      .then(([t, a, p]) => {
        setTrack(t.track);
        setAddresses(a.addresses);
        setPrice(p.price);
        // デフォルトの送付先を最初から選んでおく
        setAddressId(a.addresses.find((x) => x.isDefault)?.id ?? a.addresses[0]?.id ?? null);
      })
      .catch((err) => setLoadError(messageOf(err, "依頼の準備ができませんでした。")));
  }, [trackId, token]);

  const handleOrder = async () => {
    if (!track || addressId === null) return;
    setError("");
    setSubmitting(true);
    try {
      // 依頼を「支払い待ち」で作り、Stripe の支払い画面へ移る。支払い済みになるのは Stripe からの通知が届いたとき
      const { checkoutUrl } = await apiFetch<{ order: CdOrderDetail; checkoutUrl: string }>("/cd-orders", {
        method: "POST",
        token,
        body: JSON.stringify({ trackId: track.id, shippingAddressId: addressId, returnBaseUrl: returnBaseUrl() }),
      });
      window.location.assign(checkoutUrl);
    } catch (err) {
      setError(messageOf(err, "支払いに進めませんでした。"));
      setSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <section className={styles.card}>
        <p className={styles.error}>{loadError}</p>
        <Link href="/tracks" className={styles.link}>
          トラック一覧へ
        </Link>
      </section>
    );
  }
  if (!track || !addresses || !price) return <p className={styles.empty}>読み込んでいます…</p>;

  return (
    <div className={styles.stack}>
      <Link href={`/tracks/detail?id=${track.id}`} className={styles.back}>
        ← 『{track.name}』へ戻る
      </Link>

      <section className={styles.card}>
        <p className={styles.label}>CD を依頼する</p>
        <h1 className={styles.title}>{track.name}</h1>
        <p className={styles.hint}>このトラックの曲を、いまの順番とテンポのまま CD にします。</p>
        {track.musics.length === 0 ? (
          <p className={styles.error}>曲が入っていないトラックは依頼できません。トラックに曲を追加してください。</p>
        ) : (
          <ol className={styles.list}>
            {track.musics.map((m, i) => (
              <li key={m.trackMusicId} className={styles.item}>
                <span className={styles.index}>{i + 1}</span>
                <div className={styles.itemMain}>
                  <p className={styles.itemName}>{m.name}</p>
                  <p className={styles.itemMeta}>
                    {m.editCount > 0 ? `テンポを変えた区間 ${m.editCount} か所` : "テンポの変更なし"}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>送付先</h2>
        {addresses.length === 0 ? (
          <p className={styles.hint}>
            送付先が登録されていません。
            <Link href="/account" className={styles.link}>
              ユーザー詳細
            </Link>
            で住所を追加してから依頼してください。
          </p>
        ) : (
          <div className={styles.list} role="radiogroup" aria-label="送付先">
            {addresses.map((a) => (
              <label key={a.id} className={styles.choice}>
                <input
                  type="radio"
                  name="address"
                  checked={addressId === a.id}
                  onChange={() => setAddressId(a.id)}
                />
                <span className={styles.address}>
                  <span className={styles.addressName}>
                    {a.recipientName} 様{a.isDefault && "（デフォルト）"}
                  </span>
                  <br />〒{a.postalCode} {a.prefecture}
                  {a.city}
                  {a.addressLine1} {a.addressLine2 ?? ""}
                </span>
              </label>
            ))}
          </div>
        )}

      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>お支払い</h2>
        <div className={styles.priceRow}>
          <span>CD 1 枚（税込・送料込）</span>
          <span className={styles.priceAmount}>{formatPrice(price)}</span>
        </div>
        <p className={styles.hint}>
          「支払いに進む」を押すと、Stripe の支払い画面に移ります。支払いが済むと依頼が確定します。
          受け付ける前（「依頼済み」のうち）なら、取り消して全額返金できます。
        </p>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            onClick={handleOrder}
            disabled={submitting || addressId === null || track.musics.length === 0}
          >
            {submitting ? "支払い画面を用意しています…" : `支払いに進む（${formatPrice(price)}）`}
          </button>
        </div>
      </section>
    </div>
  );
}
