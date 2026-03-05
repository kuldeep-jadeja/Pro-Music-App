import "@/styles/globals.scss";
import { AppProvider } from '@/lib/AppContext';
import AppLayout from '@/components/layout/AppLayout';

export default function App({ Component, pageProps }) {
  // Pages can export `getLayout` to opt out of AppLayout (e.g. login, signup)
  const getLayout = Component.getLayout ?? ((page) => (
    <AppLayout>{page}</AppLayout>
  ));

  return (
    <AppProvider>
      {getLayout(<Component {...pageProps} />)}
    </AppProvider>
  );
}
