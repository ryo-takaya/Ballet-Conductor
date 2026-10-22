"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "./AuthProvider";
import styles from "./RequireAuth.module.css";

/** ログインしていなければトップページへ移動する。ログイン中だけ中身を表示する */
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) router.replace("/");
  }, [loading, user, router]);

  if (!user) {
    return (
      <p className={styles.checking} role="status">
        {loading ? "ログイン状態を確認しています…" : "トップページへ移動しています…"}
      </p>
    );
  }
  return <>{children}</>;
}
