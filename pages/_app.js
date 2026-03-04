import "@/styles/globals.scss";
import { useEffect } from "react";
import { PlayerProvider } from "@/context/PlayerContext";
import GlobalPlayer from "@/components/GlobalPlayer";

export default function App({ Component, pageProps }) {

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/eruda";
    script.onload = () => window.eruda.init();
    document.body.appendChild(script);
  }, []);

  return (
    <PlayerProvider>
      <Component {...pageProps} />
      {/* GlobalPlayer mounts the YouTube iframe once.
          It persists across page navigation — never recreated. */}
      <GlobalPlayer />
    </PlayerProvider>
  );
}
