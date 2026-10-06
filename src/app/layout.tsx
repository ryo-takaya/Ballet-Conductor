import type { Metadata, Viewport } from "next";
import { M_PLUS_Rounded_1c } from "next/font/google";
import "./globals.css";

const rounded = M_PLUS_Rounded_1c({
  variable: "--font-rounded",
  weight: ["400", "700", "800"],
  subsets: ["latin"],
  preload: false,
});

export const metadata: Metadata = {
  title: "Ballet Conductor",
  description: "バレエの曲を、ブラウザでかんたんに編集できるツール",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3faff" },
    { media: "(prefers-color-scheme: dark)", color: "#0c1a28" },
  ],
};

// 保存済みのテーマを描画前に反映して、読み込み時のちらつきを防ぐ
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className={rounded.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
