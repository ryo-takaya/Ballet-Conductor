import Link from "next/link";
import AccountMenu, { AuthButton } from "./AccountMenu";
import ThemeToggle from "./ThemeToggle";
import styles from "./SiteHeader.module.css";

export default function SiteHeader({ lead }: { lead?: string }) {
  return (
    <header className={styles.header}>
      <Link href="/" className={styles.brand}>
        <svg className={styles.logo} viewBox="0 0 48 48" aria-hidden="true">
          <path d="M24 22c-6-8-16-11-18-6s7 9 16 7" className={styles.ribbon} strokeWidth="2" strokeLinejoin="round" />
          <path d="M24 22c6-8 16-11 18-6s-7 9-16 7" className={styles.ribbon} strokeWidth="2" strokeLinejoin="round" />
          <path d="M22 24l-6 16 5-2 3 4 1-17M26 24l6 16-5-2-3 4" className={styles.ribbonTail} strokeWidth="2" strokeLinejoin="round" />
          <circle cx="24" cy="23" r="4" className={styles.ribbonKnot} strokeWidth="2" />
        </svg>
        <span className={styles.title}>Ballet Conductor</span>
      </Link>
      {/* 1 段目の右端：色の切り替えとログイン・ログアウト */}
      <div className={styles.actions}>
        <ThemeToggle />
        <AuthButton />
      </div>
      {/* 2 段目：それ以外のボタンは左寄せ */}
      <div className={styles.navRow}>
        <AccountMenu />
      </div>
      {lead && <p className={styles.lead}>{lead}</p>}
    </header>
  );
}
