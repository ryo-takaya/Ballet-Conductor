import type { Metadata } from "next";
import { Suspense } from "react";
import RequireAuth from "@/components/RequireAuth";
import SiteHeader from "@/components/SiteHeader";
import TrackMusicEditor from "@/components/TrackMusicEditor";
import styles from "../page.module.css";

export const metadata: Metadata = {
  title: "曲の編集 | Ballet Conductor",
};

// 編集するのはトラックに入っている曲だけ。/editor?trackMusicId=1 のように受け取る
export default function EditorPage() {
  return (
    <main className={styles.main}>
      <SiteHeader />
      <RequireAuth>
        <Suspense>
          <TrackMusicEditor />
        </Suspense>
      </RequireAuth>
    </main>
  );
}
