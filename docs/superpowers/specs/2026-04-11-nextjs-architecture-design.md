# Demus Next.js Architecture Design

## Scope
This document captures the current production architecture for global playback in the Pages Router app.

## Canonical global playback architecture

1. **`pages/_app.js` mounts global playback shell**
   - Wraps app with `PlayerProvider` and `AppProvider`.
   - Renders `<GlobalPlayer />` once at app root so the YouTube player survives page navigation.

2. **`context/PlayerContext.js` owns playback engine**
   - Initializes and manages the single `YT.Player` instance (`initPlayer`).
   - Owns playback state (`currentTrack`, `isPlaying`, `currentTime`, queue, repeat/shuffle, volume).
   - Exposes playback actions (`playTrack`, `togglePlay`, `seek`, `playNext`, `playPrevious`).

3. **`lib/AppContext.js` owns app/library state and routes selection into playback**
   - Tracks session, playlists, active playlist, and imported track lists.
   - On track select, calls `playTrack(track, index, tracks)` to hand off playback to `PlayerContext`.

4. **`components/Player.js` is controls-only UI**
   - Consumes `usePlayer()` state/actions to render transport controls, progress, and volume.
   - Does **not** create or own YouTube iframe lifecycle.

## Playback flow (selection to audio)

1. User selects a track from list/grid surfaces.
2. `AppContext.handleTrackSelect` updates selected track/index and calls `playTrack`.
3. `PlayerContext.playTrack` resolves a YouTube ID (cached or `/api/match-youtube`) and calls `loadVideoById`.
4. `GlobalPlayer` keeps the hidden persistent iframe mounted, while `Player.js` reflects and controls state.
