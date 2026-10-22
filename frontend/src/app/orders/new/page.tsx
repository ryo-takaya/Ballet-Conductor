import type { Metadata } from "next";
import { Suspense } from "react";
import CdOrderNew from "@/components/orders/CdOrderNew";
import RequireAuth from "@/components/RequireAuth";
import SiteHeader from "@/components/SiteHeader";
import styles from "../../page.module.css";

export const metadata: Metadata = {
  title: "CD を依頼する | Ballet Conductor",
};

export default function NewOrderPage() {
  return (
    <main className={styles.main}>
      <SiteHeader />
      <RequireAuth>
        <Suspense>
          <CdOrderNew />
        </Suspense>
      </RequireAuth>
    </main>
  );
}
