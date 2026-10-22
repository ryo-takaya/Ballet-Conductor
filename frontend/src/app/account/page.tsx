import type { Metadata } from "next";
import AccountDetail from "@/components/AccountDetail";
import RequireAuth from "@/components/RequireAuth";
import SiteHeader from "@/components/SiteHeader";
import styles from "../page.module.css";

export const metadata: Metadata = {
  title: "ユーザー詳細 | Ballet Conductor",
};

export default function AccountPage() {
  return (
    <main className={styles.main}>
      <SiteHeader />
      <RequireAuth>
        <AccountDetail />
      </RequireAuth>
    </main>
  );
}
