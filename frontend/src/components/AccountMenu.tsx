"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import styles from "./AccountMenu.module.css";

// 曲の編集はトラックの中の曲から開くので、メニューには出さない
const NAV_ITEMS = [
  { href: "/tracks", label: "トラック" },
  { href: "/orders", label: "CD の依頼" },
];

/** ヘッダー 2 段目の左側：メニューと、ユーザー詳細へのリンク（ログイン中だけ） */
export default function AccountMenu() {
  const pathname = usePathname();
  const { user } = useAuth();
  if (!user) return null;

  const accountActive = pathname.startsWith("/account");
  return (
    <nav className={styles.nav} aria-label="メニュー">
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`${styles.navLink} ${active ? styles.navLinkActive : ""}`}
            aria-current={active ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
      <Link
        href="/account"
        className={`${styles.navLink} ${styles.name} ${accountActive ? styles.navLinkActive : ""}`}
        title="ユーザー詳細を開く"
        aria-current={accountActive ? "page" : undefined}
      >
        {user.name} さん
      </Link>
    </nav>
  );
}

/** ヘッダー 1 段目の右端：ログイン・ログアウトのボタン */
export function AuthButton() {
  const router = useRouter();
  const { user, loading, logout } = useAuth();

  if (loading) return <div className={styles.placeholder} aria-hidden="true" />;

  if (!user) {
    return (
      <Link href="/login" className={styles.loginLink}>
        ログイン
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={styles.logout}
      onClick={() => {
        logout();
        router.replace("/");
      }}
    >
      ログアウト
    </button>
  );
}
