import type { Metadata } from "next";
import CdOrderList from "@/components/orders/CdOrderList";
import RequireAuth from "@/components/RequireAuth";
import SiteHeader from "@/components/SiteHeader";
import styles from "../page.module.css";

export const metadata: Metadata = {
  title: "CD の依頼 | Ballet Conductor",
};

export default function OrdersPage() {
  return (
    <main className={styles.main}>
      <SiteHeader />
      <RequireAuth>
        <CdOrderList />
      </RequireAuth>
    </main>
  );
}
