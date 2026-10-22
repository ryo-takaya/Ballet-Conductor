import type { Metadata } from "next";
import { Suspense } from "react";
import RequireAuth from "@/components/RequireAuth";
import SiteHeader from "@/components/SiteHeader";
import TrackDetail from "@/components/tracks/TrackDetail";
import styles from "../../page.module.css";

export const metadata: Metadata = {
  title: "トラックの編集 | Ballet Conductor",
};

// 静的サイトとして公開するため、トラックの id は /tracks/detail?id=1 のようにクエリで受け取る
export default function TrackDetailPage() {
  return (
    <main className={styles.main}>
      <SiteHeader />
      <RequireAuth>
        <Suspense>
          <TrackDetail />
        </Suspense>
      </RequireAuth>
    </main>
  );
}
