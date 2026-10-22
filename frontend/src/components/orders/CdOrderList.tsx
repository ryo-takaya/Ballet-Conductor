"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch, ApiError, type CdOrderSummary } from "@/lib/api";
import { formatDateTime, ORDER_STATUS_LABEL, paymentSummary } from "@/lib/orderStatus";
import { useAuth } from "../AuthProvider";
import styles from "./orders.module.css";

/** 自分の CD の依頼の一覧 */
export default function CdOrderList() {
  const { token } = useAuth();
  const [orders, setOrders] = useState<CdOrderSummary[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<{ orders: CdOrderSummary[] }>("/cd-orders", { token })
      .then((res) => setOrders(res.orders))
      .catch((err) => setError(err instanceof ApiError ? err.message : "依頼を読み込めませんでした。"));
  }, [token]);

  return (
    <section className={styles.card}>
      <h1 className={styles.cardTitle}>CD の依頼</h1>
      <p className={styles.hint}>依頼は、トラックの画面の「CD を依頼する」からできます。</p>
      {error ? (
        <p className={styles.error}>{error}</p>
      ) : orders === null ? (
        <p className={styles.empty}>読み込んでいます…</p>
      ) : orders.length === 0 ? (
        <p className={styles.empty}>
          まだ依頼はありません。
          <Link href="/tracks" className={styles.link}>
            トラック
          </Link>
          から依頼してみましょう。
        </p>
      ) : (
        <ul className={styles.list}>
          {orders.map((o) => (
            <li key={o.id}>
              <Link href={`/orders/detail?id=${o.id}`} className={styles.item}>
                <div className={styles.itemMain}>
                  <p className={styles.itemName}>{o.trackName}</p>
                  <p className={styles.itemMeta}>
                    {o.musicCount} 曲 ・ {formatDateTime(o.createdAt)} に依頼
                  </p>
                  <p className={styles.itemMeta}>{paymentSummary(o)}</p>
                </div>
                <span className={styles.status} data-status={o.status}>
                  {ORDER_STATUS_LABEL[o.status]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
