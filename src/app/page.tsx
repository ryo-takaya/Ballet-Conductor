import Editor from "@/components/Editor";
import ThemeToggle from "@/components/ThemeToggle";
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <svg className={styles.logo} viewBox="0 0 48 48" aria-hidden="true">
          <path d="M24 22c-6-8-16-11-18-6s7 9 16 7" className={styles.ribbon} strokeWidth="2" strokeLinejoin="round" />
          <path d="M24 22c6-8 16-11 18-6s-7 9-16 7" className={styles.ribbon} strokeWidth="2" strokeLinejoin="round" />
          <path d="M22 24l-6 16 5-2 3 4 1-17M26 24l6 16-5-2-3 4" className={styles.ribbonTail} strokeWidth="2" strokeLinejoin="round" />
          <circle cx="24" cy="23" r="4" className={styles.ribbonKnot} strokeWidth="2" />
        </svg>
        <div className={styles.headerText}>
          <h1 className={styles.title}>Ballet Conductor</h1>
          <p className={styles.lead}>レッスンの曲の、好きな区間だけ速さを変えられます。ブラウザだけで編集できます。</p>
        </div>
        <ThemeToggle />
      </header>
      <Editor />
      <footer className={styles.footer}>編集はすべてこの端末の中で行われ、曲がどこかに送られることはありません。</footer>
    </main>
  );
}
