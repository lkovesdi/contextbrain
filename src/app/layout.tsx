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
        {/* The same deployed frontend serves web and the Tauri desktop shell,
            so desktop detection must happen at runtime. Tauri's init script
            (window.isTauri) runs before page scripts, and this inline script
            runs before first paint — the titlebar inset applies with no jump.
            The MutationObserver guards the attribute afterwards: when React
            recovers from a hydration mismatch it client-re-renders the root
            and strips attributes it didn't render onto <html>, which silently
            removed data-desktop (and the titlebar inset with it). Re-stamping
            on removal keeps the inset alive no matter what hydration does. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if((window.isTauri||window.__TAURI_INTERNALS__)&&/Mac/.test(navigator.userAgent)){var d=document.documentElement;d.setAttribute("data-desktop","mac");new MutationObserver(function(){if(d.getAttribute("data-desktop")!=="mac")d.setAttribute("data-desktop","mac")}).observe(d,{attributes:true,attributeFilter:["data-desktop"]})}}catch(e){}`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
