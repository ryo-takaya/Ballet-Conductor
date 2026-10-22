"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, ApiError, returnBaseUrl, type CdOrderDetail } from "@/lib/api";
import { formatDateTime, formatPrice, ORDER_STATUS_LABEL, PAYMENT_STATUS_LABEL } from "@/lib/orderStatus";
import { useAuth } from "../AuthProvider";
import ConfirmDialog from "../ConfirmDialog";
import styles from "./orders.module.css";

const messageOf = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

function formatSeconds(sec: number) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

// Stripe の支払い画面から戻ったあと、支払いの通知（Webhook）が届くのを待つ間隔と回数
const POLL_INTERVAL_MS = 2000;
const POLL_MAX = 15;

/** CD の依頼の詳細。依頼した時点の中身・送付先・料金と、状態の履歴を出す */
export default function CdOrderDetailView() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "";
  // Stripe の支払い画面から戻ってきたとき: success（支払った）/ cancel（戻るを押した）
  const checkout = searchParams.get("checkout");
  const { token } = useAuth();
  const [order, setOrder] = useState<CdOrderDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [paying, setPaying] = useState(false);
  const [polls, setPolls] = useState(0);

  useEffect(() => {
    apiFetch<{ order: CdOrderDetail }>(`/cd-orders/${encodeURIComponent(id)}`, { token })
      .then((res) => setOrder(res.order))
      .catch((err) => setLoadError(messageOf(err, "依頼を読み込めませんでした。")));
  }, [id, token]);

  // 支払いのあとに戻ってきた直後は、まだ通知が届いていないことがあるので、しばらく読み直す
  const waitingForPayment = checkout === "success" && order?.status === "awaiting_payment" && polls < POLL_MAX;
  useEffect(() => {
    if (!waitingForPayment) return;
    const timer = setTimeout(() => {
      apiFetch<{ order: CdOrderDetail }>(`/cd-orders/${encodeURIComponent(id)}`, { token })
        .then((res) => setOrder(res.order))
        .catch(() => {})
        .finally(() => setPolls((n) => n + 1));
    }, POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [waitingForPayment, polls, id, token]);

  const resumePayment = async () => {
    if (!order) return;
    setError("");
    setPaying(true);
    try {
      const { checkoutUrl } = await apiFetch<{ checkoutUrl: string }>(`/cd-orders/${order.id}/checkout`, {
        method: "POST",
        token,
        body: JSON.stringify({ returnBaseUrl: returnBaseUrl() }),
      });
      window.location.assign(checkoutUrl);
    } catch (err) {
      setError(messageOf(err, "支払いに進めませんでした。"));
      setPaying(false);
    }
  };

  const cancelOrder = async () => {
    if (!order) return;
    setError("");
    setCancelling(true);
    try {
      const res = await apiFetch<{ order: CdOrderDetail }>(`/cd-orders/${order.id}/cancel`, { method: "POST", token });
      setOrder(res.order);
    } catch (err) {
      setError(messageOf(err, "依頼を取り消せませんでした。"));
    } finally {
      setCancelling(false);
      setConfirming(false);
    }
  };

  if (loadError) {
    return (
      <section className={styles.card}>
        <p className={styles.error}>{loadError}</p>
        <Link href="/orders" className={styles.link}>
          CD の依頼の一覧へ
        </Link>
      </section>
    );
  }
  if (!order) return <p className={styles.empty}>読み込んでいます…</p>;

  const a = order.shippingAddress;
  const isUnpaid = order.status === "awaiting_payment";
  const willRefund = order.status === "requested" && order.paymentStatus === "paid";

  return (
    <div className={styles.stack}>
      <Link href="/orders" className={styles.back}>
        ← CD の依頼の一覧へ
      </Link>

      <section className={styles.card}>
        <p className={styles.label}>CD の依頼</p>
        <h1 className={styles.title}>{order.trackName}</h1>
        <p className={styles.hint}>
          <span className={styles.status} data-status={order.status}>
            {ORDER_STATUS_LABEL[order.status]}
          </span>{" "}
          {formatDateTime(order.createdAt)} に依頼
        </p>
        {waitingForPayment && <p className={styles.notice}>支払いを確認しています…</p>}
        {checkout === "success" && order.status === "awaiting_payment" && !waitingForPayment && (
          <p className={styles.notice}>
            支払いの確認に時間がかかっています。しばらくしてからページを読み込み直してください。
          </p>
        )}
        {checkout === "success" && order.status === "requested" && (
          <p className={styles.notice}>支払いが済み、CD の依頼が確定しました。</p>
        )}
        {checkout === "cancel" && order.status === "awaiting_payment" && (
          <p className={styles.notice}>支払いはまだ済んでいません。「支払いに進む」から続けられます。</p>
        )}
        {(isUnpaid || order.status === "requested") && (
          <div className={styles.actions}>
            {isUnpaid && (
              <button type="button" className={styles.primary} onClick={resumePayment} disabled={paying}>
                {paying ? "支払い画面を用意しています…" : `支払いに進む（${formatPrice(order.price)}）`}
              </button>
            )}
            <button type="button" className={styles.secondary} onClick={() => setConfirming(true)}>
              依頼を取り消す
            </button>
          </div>
        )}
        {error && <p className={styles.error}>{error}</p>}
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>お支払い</h2>
        {order.price.amount === 0 || !order.paymentStatus ? (
          <p className={styles.hint}>料金をいただく前の依頼のため、お支払いはありません。</p>
        ) : (
          <div className={styles.priceRow}>
            <span>
              CD 1 枚（税込・送料込）・
              <strong>{PAYMENT_STATUS_LABEL[order.paymentStatus]}</strong>
            </span>
            <span className={styles.priceAmount}>{formatPrice(order.price)}</span>
          </div>
        )}
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>CD に入れる曲（{order.track.musics.length} 曲）</h2>
        <p className={styles.hint}>依頼した時点の順番とテンポです。あとでトラックを変えても、この内容は変わりません。</p>
        <ol className={styles.list}>
          {order.track.musics.map((m) => (
            <li key={m.position} className={styles.item}>
              <span className={styles.index}>{m.position}</span>
              <div className={styles.itemMain}>
                <p className={styles.itemName}>{m.name}</p>
                <p className={styles.itemMeta}>
                  {m.edits.length === 0
                    ? "テンポの変更なし"
                    : m.edits
                        .map((e) => `${formatSeconds(e.startSecond)}〜${formatSeconds(e.endSecond)} を ${e.tempo}%`)
                        .join("、")}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>送付先</h2>
        <p className={`${styles.address} ${styles.hint}`}>
          <span className={styles.addressName}>{a.recipientName} 様</span>
          <br />〒{a.postalCode}
          <br />
          {a.prefecture}
          {a.city}
          {a.addressLine1} {a.addressLine2 ?? ""}
        </p>
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>状態の履歴</h2>
        <ol className={styles.timeline}>
          {order.events.map((e, i) => (
            <li key={i} className={styles.timelineItem}>
              <p className={styles.timelineEvent}>{ORDER_STATUS_LABEL[e.event]}</p>
              <p className={styles.timelineMeta}>
                {formatDateTime(e.createdAt)}
                {e.note && ` ・ ${e.note}`}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <ConfirmDialog
        open={confirming}
        title="この依頼を取り消しますか？"
        confirmLabel={cancelling ? "取り消しています…" : "取り消す"}
        danger
        busy={cancelling}
        onConfirm={cancelOrder}
        onCancel={() => setConfirming(false)}
      >
        {willRefund && <p>支払った {formatPrice(order.price)} は、全額を返金します（カード会社によって反映に数日かかります）。</p>}
        {isUnpaid && <p>支払いの手続きを閉じて取り消します。</p>}
        <p>取り消した依頼は元に戻せません。もう一度依頼するときは、トラックの画面から依頼してください。</p>
      </ConfirmDialog>
    </div>
  );
}
