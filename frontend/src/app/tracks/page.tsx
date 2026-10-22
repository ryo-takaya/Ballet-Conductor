import type { Metadata } from "next";
import RequireAuth from "@/components/RequireAuth";
import SiteHeader from "@/components/SiteHeader";
import TrackList from "@/components/tracks/TrackList";
import styles from "../page.module.css";

export const metadata: Metadata = {
  title: "トラック | Ballet Conductor",
};

export default function TracksPage() {
  return (
    <main className={styles.main}>
      <SiteHeader />
      <RequireAuth>
        <TrackList />
      </RequireAuth>
    </main>
  );
}
