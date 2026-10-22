import type { Metadata } from "next";
import { Suspense } from "react";
import CdOrderDetailView from "@/components/orders/CdOrderDetailView";
import RequireAuth from "@/components/RequireAuth";
import SiteHeader from "@/components/SiteHeader";
import styles from "../../page.module.css";

export const metadata: Metadata = {
  title: "CD の依頼の詳細 | Ballet Conductor",
};

export default function OrderDetailPage() {
  return (
    <main className={styles.main}>
      <SiteHeader />
      <RequireAuth>
        <Suspense>
          <CdOrderDetailView />
        </Suspense>
      </RequireAuth>
    </main>
  );
}
