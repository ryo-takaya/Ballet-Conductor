import type { Metadata } from "next";
import { Suspense } from "react";
import SiteHeader from "@/components/SiteHeader";
import AuthForm from "@/components/AuthForm";
import styles from "../page.module.css";

export const metadata: Metadata = {
  title: "ログイン | Ballet Conductor",
};

export default function LoginPage() {
  return (
    <main className={styles.main}>
      <SiteHeader />
      <Suspense>
        <AuthForm />
      </Suspense>
    </main>
  );
}
