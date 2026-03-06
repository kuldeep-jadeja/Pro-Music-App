import { useEffect } from "react";
import "@/styles/globals.scss";
import { AppProvider } from '@/lib/AppContext';
import AppLayout from '@/components/layout/AppLayout';
import Head from "next/head";

export default function App({ Component, pageProps }) {
  // Register PWA service worker
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch((err) => console.warn('SW registration failed:', err));
    }
  }, []);

  // Pages can export `getLayout` to opt out of AppLayout (e.g. login, signup)
  const getLayout = Component.getLayout ?? ((page) => (
    <AppLayout>{page}</AppLayout>
  ));

  return (
    <AppProvider>
      <Head>
        <title>Demus - Your Music, Your Way</title>
        <meta name="description" content="Import Spotify playlists and stream for free" />
        {/* viewport-fit=cover exposes safe-area-inset-* variables on notched devices */}
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>
      {getLayout(<Component {...pageProps} />)}
    </AppProvider>
  );
}
