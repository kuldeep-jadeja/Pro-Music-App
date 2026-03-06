import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* PWA manifest */}
        <link rel="manifest" href="/manifest.json" />

        {/* Theme colour — used by Chrome / Android for the browser chrome */}
        <meta name="theme-color" content="#7c5cff" />

        {/* ── iOS PWA ──────────────────────────────────────────── */}
        {/* Enables "Add to Home Screen" standalone mode on iOS */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        {/* Status-bar overlaps the app (blends with our dark header) */}
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Demus" />

        {/* Touch icons — iOS ignores the manifest icons so we need these */}
        <link rel="apple-touch-icon" href="/icons/icon-180.png" />
        <link rel="apple-touch-icon" sizes="192x192" href="/icons/icon-192.png" />

        {/* iOS splash screens (portrait, common device sizes) */}
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />

        {/* ── Android / General ──────────────────────────────── */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="application-name" content="Demus" />
        <meta name="msapplication-TileColor" content="#7c5cff" />
        <meta name="msapplication-tap-highlight" content="no" />

        {/* Favicon */}
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/icons/icon-192.png" type="image/png" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
