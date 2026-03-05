import "@/styles/globals.scss";
import { PlayerProvider } from "@/context/PlayerContext";
import GlobalPlayer from "@/components/GlobalPlayer";

export default function App({ Component, pageProps }) {
  return (
    <PlayerProvider>
      <Component {...pageProps} />
      {/* GlobalPlayer mounts the YouTube iframe once.
          It persists across page navigation — never recreated. */}
      <GlobalPlayer />
    </PlayerProvider>
  );
}
