import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import ImportForm from '@/components/ImportForm';
import TrackList from '@/components/TrackList';
import PlaylistGrid from '@/components/PlaylistGrid';
import QuickPicks from '@/components/QuickPicks';
import { useAppContext } from '@/lib/AppContext';
import styles from '@/styles/Home.module.scss';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function Home() {
  const {
    user,
    authChecked,
    playlists,
    loadingPlaylists,
    activePlaylist,
    loadingTracks,
    handleImportSuccess,
    loadPlaylist,
    clearActivePlaylist,
    tracks,
    currentTrack,
    handleTrackSelect,
  } = useAppContext();

  const router = useRouter();
  const displayName = user?.name || user?.email?.split('@')[0] || 'there';

  const matchedCount = !loadingTracks && tracks?.length > 0
    ? tracks.filter(t => t.youtubeVideoId).length
    : 0;
  const matchPct = tracks?.length > 0
    ? Math.round((matchedCount / tracks.length) * 100)
    : 0;

  return (
    <>
      <Head>
        <title>Demus - Your Music, Your Way</title>
        <meta name="description" content="Import Spotify playlists and stream for free" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      {/* While the session cookie is being verified, show nothing to prevent
          the guest CTA flashing briefly after login/signup redirect. */}
      {!authChecked ? null : user ? (
        <>
          {/* Hero greeting */}
          <div className={styles.hero}>
            <h1 className={styles.greeting}>
              {getGreeting()},{' '}
              <span className={styles.greetingName}>{displayName}</span>
            </h1>
            <p className={styles.greetingSub}>What do you want to listen to today?</p>
          </div>

          {/* Quick Picks — fast-access shelf of playable tracks */}
          <QuickPicks
            playlist={activePlaylist}
            tracks={tracks}
            currentTrack={currentTrack}
            onTrackSelect={handleTrackSelect}
          />

          {/* Import card */}
          <div id="import" className={styles.importCard}>
            <div className={styles.importCardHeader}>
              <svg
                className={styles.importCardIcon}
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
              </svg>
              <div>
                <h2 className={styles.importCardTitle}>Import from Spotify</h2>
                <p className={styles.importCardDesc}>
                  Paste a Spotify playlist link to add it to your library
                </p>
              </div>
            </div>
            <ImportForm onImportSuccess={handleImportSuccess} />
          </div>

          {/* Playlists grid */}
          {(loadingPlaylists || playlists?.length > 0) && (
            <PlaylistGrid
              id="playlists"
              title="Your Library"
              playlists={playlists}
              loading={loadingPlaylists}
              onPlaylistClick={(pl) => router.push(`/playlist/${pl.id}`)}
            />
          )}

          {/* Active playlist view */}
          {activePlaylist && (
            <>
              <div id="playlist-view" className={styles.playlistView}>
                {activePlaylist.coverImage && (
                  <div
                    className={styles.playlistBg}
                    style={{ backgroundImage: `url(${activePlaylist.coverImage})` }}
                    aria-hidden="true"
                  />
                )}
                <div className={styles.playlistBgOverlay} aria-hidden="true" />
                {/* Back / close button */}
                <button
                  className={styles.playlistCloseBtn}
                  onClick={clearActivePlaylist}
                  aria-label="Close playlist view"
                >
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
                    <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
                  </svg>
                  Back
                </button>
                <div className={styles.playlistContent}>
                  <div className={styles.playlistArtWrap}>
                    {activePlaylist.coverImage ? (
                      <img
                        src={activePlaylist.coverImage}
                        alt={activePlaylist.name}
                        className={styles.playlistCover}
                      />
                    ) : (
                      <div className={styles.playlistArtPlaceholder}>
                        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className={styles.playlistMeta}>
                    <span className={styles.playlistLabel}>PLAYLIST</span>
                    <h2 className={styles.playlistName}>{activePlaylist.name}</h2>
                    <p className={styles.playlistDesc}>
                      {activePlaylist.owner} &middot; {activePlaylist.trackCount} tracks
                    </p>
                    {!loadingTracks && tracks?.length > 0 && (
                      <div className={styles.matchProgress}>
                        <div className={styles.progressBar}>
                          <div
                            className={styles.progressFill}
                            style={{ width: `${matchPct}%` }}
                          />
                        </div>
                        <span className={styles.progressLabel}>
                          {matchedCount} / {tracks.length} matched
                        </span>
                      </div>
                    )}
                    {activePlaylist.status !== 'ready' && (
                      <span
                        className={`${styles.statusPill} ${styles[`status_${activePlaylist.status}`] ?? ''
                          }`}
                      >
                        {activePlaylist.status === 'matching'
                          ? 'Finding YouTube matches…'
                          : activePlaylist.status === 'paused'
                            ? 'Paused — rate limited'
                            : activePlaylist.status === 'error'
                              ? 'Error'
                              : activePlaylist.status}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {loadingTracks ? (
                <div className={styles.loading}>
                  <span className={styles.spinner} />
                  <p>Loading tracks…</p>
                </div>
              ) : (
                <TrackList
                  tracks={tracks}
                  currentTrackId={currentTrack?.id}
                  onTrackSelect={handleTrackSelect}
                />
              )}
            </>
          )}
        </>
      ) : (
        /* Guest CTA */
        <div className={styles.loginCta}>
          <div className={styles.ctaLogo} aria-hidden="true">
            <svg viewBox="0 0 64 64" fill="none">
              <circle cx="32" cy="32" r="32" fill="#7C5CFF" opacity="0.12" />
              <path
                d="M32 12C20.96 12 12 20.96 12 32s8.96 20 20 20 20-8.96 20-20S43.04 12 32 12zm-4 29V23l14 9-14 9z"
                fill="#7C5CFF"
              />
            </svg>
          </div>
          <h2 className={styles.ctaTitle}>Welcome to Demus</h2>
          <p className={styles.ctaSubtitle}>Import Spotify playlists and stream for free.</p>
          <div className={styles.ctaActions}>
            <Link href="/signup" className={styles.ctaBtn}>
              Get started free
            </Link>
            <Link href="/login" className={styles.ctaBtnSecondary}>
              Log in
            </Link>
          </div>
        </div>
      )}
    </>
  );
}

