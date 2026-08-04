import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ContextBrain",
  description: "Capture, structure, and chat with your meetings.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Pre-paint environment stamps on <html>:
            - data-desktop="mac" inside the Tauri shell (drives the titlebar
              inset), detected via Tauri's injected globals.
            - data-theme="dark" from localStorage cb_theme (light|dark|system;
              system follows prefers-color-scheme) — before first paint, so
              no light flash.
            The MutationObserver guards both: React hydration-mismatch
            recovery client-re-renders the root and strips attributes it
            didn't render onto <html>; re-stamping (idempotently, so the
            observer can't loop) keeps them alive no matter what hydration
            does. window.__cbApplyTheme lets the Settings toggle re-resolve. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var d=document.documentElement;var set=function(n,v){if(v===null){if(d.hasAttribute(n))d.removeAttribute(n)}else if(d.getAttribute(n)!==v)d.setAttribute(n,v)};var desktop=(window.isTauri||window.__TAURI_INTERNALS__)&&/Mac/.test(navigator.userAgent);var mq=window.matchMedia("(prefers-color-scheme: dark)");var apply=function(){set("data-desktop",desktop?"mac":null);var p=null;try{p=localStorage.getItem("cb_theme")}catch(e){}var dark=p==="dark"||(p!=="light"&&mq.matches);set("data-theme",dark?"dark":null)};apply();window.__cbApplyTheme=apply;mq.addEventListener("change",apply);new MutationObserver(apply).observe(d,{attributes:true,attributeFilter:["data-desktop","data-theme"]})}catch(e){}`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
