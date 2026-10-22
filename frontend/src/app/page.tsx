import SiteHeader from "@/components/SiteHeader";
import TopActions from "@/components/TopActions";
import styles from "./top.module.css";
import pageStyles from "./page.module.css";

const FEATURES = [
  {
    title: "好きな区間だけテンポを変える",
    body: "曲の中の区間を選んで、速さを 50%〜150% に。音の高さは変わりません。",
  },
  {
    title: "レッスン用のトラックをつくる",
    body: "プリエ、タンデュ、グラン・ワルツ…。曲名で探して、クラスの流れどおりに並べられます。",
  },
  {
    title: "ブラウザだけで使える",
    body: "インストールは不要です。パソコンでも、スマホやタブレットでも使えます。",
  },
];

export default function TopPage() {
  return (
    <main className={pageStyles.main}>
      <SiteHeader />
      <section className={styles.hero}>
        <p className={styles.eyebrow}>バレエを習う人・教える人のための曲づくり</p>
        <h1 className={styles.heroTitle}>
          レッスンの曲を、
          <br />
          ちょうどいい速さに。
        </h1>
        <p className={styles.heroLead}>
          Ballet Conductor は、バレエの曲の速さを区間ごとに調整したり、レッスンで使う曲をトラックにまとめたりできるツールです。
        </p>
        <TopActions />
      </section>

      <ul className={styles.features}>
        {FEATURES.map((f) => (
          <li key={f.title} className={styles.feature}>
            <h2 className={styles.featureTitle}>{f.title}</h2>
            <p className={styles.featureBody}>{f.body}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
