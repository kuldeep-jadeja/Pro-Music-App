import "@/styles/globals.scss";
import { AppProvider } from '@/lib/AppContext';
import AppLayout from '@/components/layout/AppLayout';
import Head from "next/head";

export default function App({ Component, pageProps }) {
  // Pages can export `getLayout` to opt out of AppLayout (e.g. login, signup)
  const getLayout = Component.getLayout ?? ((page) => (
    <AppLayout>{page}</AppLayout>
  ));

  return (
    <AppProvider>
      <Head>
        <title>Demus - Your Music, Your Way</title>
        <meta name="description" content="Import Spotify playlists and stream for free" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      {getLayout(<Component {...pageProps} />)}
    </AppProvider>
  );
}
