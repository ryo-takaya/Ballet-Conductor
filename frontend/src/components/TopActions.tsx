"use client";

import Link from "next/link";
import { useAuth } from "./AuthProvider";
import styles from "./TopActions.module.css";

/** トップページのボタン。ログイン中かどうかで出し分ける */
export default function TopActions() {
  const { user, loading } = useAuth();

  if (loading) return <div className={styles.placeholder} aria-hidden="true" />;

  if (user) {
    return (
      <div className={styles.actions}>
        <Link href="/tracks" className={`${styles.button} ${styles.primary}`}>
          トラックを見る
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.actions}>
      <Link href="/login?mode=signup" className={`${styles.button} ${styles.primary}`}>
        新規登録してはじめる
      </Link>
      <Link href="/login" className={styles.button}>
        ログイン
      </Link>
    </div>
  );
}
