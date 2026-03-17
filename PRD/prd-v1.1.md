# PRD v1.1: Demus React Native Mobile App (iOS and Android)

## 1. Product overview

### 1.1 Document title and version

- PRD: Demus React Native Mobile App (iOS and Android)
- Version: 1.1
- Date: March 17, 2026

### 1.2 Product summary

Demus will expand from a web-first Next.js PWA to a mobile-native app on iOS and Android using Expo. MVP will prioritize fast delivery of core value: authentication, Spotify playlist import, playlist browsing, track playback, and import/match progress.

v1.1 adds explicit reliability contracts for mobile playback continuity, auth lifecycle, and observability so the product can ship with fewer hidden failure modes.

## 2. Goals

### 2.1 Business goals

- Launch mobile app without disrupting existing web/PWA behavior.
- Deliver MVP quickly via Expo and existing backend reuse.
- Validate retention and listening engagement in mobile contexts.
- Establish a path to provider abstraction beyond YouTube.

### 2.2 User goals

- Securely sign up and log in from mobile.
- Import public Spotify playlists and track progress.
- Keep playback running in background and lock screen contexts.
- Control playback through lock screen, Bluetooth devices, and car environments.

### 2.3 Non-goals

- Full web parity in MVP.
- Backend rewrite away from Next.js Pages Router.
- Replacing MongoDB/Redis architecture.
- Immediate replacement of YouTube as playback source in MVP.

## 3. Best-fit stack

### 3.1 Primary recommendation

- Expo React Native with TypeScript
- React Navigation
- TanStack Query for server state
- Zustand for app/player UI state
- Secure storage for tokens
- PlaybackProvider abstraction with YouTube-backed implementation first

### 3.2 Fallback recommendation

- Bare React Native CLI only if validated blockers require native-level media control beyond Expo timeline constraints.

## 4. Why this fits current codebase

- Existing API boundaries already support mobile flows for import, playlists, detail, status, and stream lookup.
- Auth guard and parsing can evolve additively for dual cookie plus Bearer modes.
- Existing async matching architecture can remain unchanged for MVP.

Relevant existing files:
- [pages/api/import-playlist.js](pages/api/import-playlist.js)
- [pages/api/playlists.js](pages/api/playlists.js)
- [pages/api/playlist/[id]/index.js](pages/api/playlist/[id]/index.js)
- [pages/api/playlist/[id]/status.js](pages/api/playlist/[id]/status.js)
- [pages/api/stream/[trackId].js](pages/api/stream/[trackId].js)
- [lib/auth.js](lib/auth.js)
- [lib/requireAuth.js](lib/requireAuth.js)
- [lib/youtube.js](lib/youtube.js)
- [workers/ytMatchWorker.js](workers/ytMatchWorker.js)

## 5. Functional requirements

### 5.1 P0 MVP

- Mobile shell and authenticated routing
- Signup, login, logout, bootstrap session
- Playlist import and library
- Playlist details and track readiness states
- Core playback controls: play, pause, seek, next, previous
- Background playback continuity
- Lock screen and Bluetooth transport controls
- Import matching progress and retry for paused state

### 5.2 P1 Post-MVP foundation

- Provider abstraction expansion beyond YouTube
- Car integration hardening and broader compatibility
- Push notifications for long-running import completion

## 6. Critical feasibility gate

### 6.1 Phase 1 playback feasibility gate

A mandatory gate is required before MVP execution continues.

Pass criteria:
- Background playback continues for at least 30 minutes on iOS and Android test devices.
- Lock screen transport controls remain functional across app background and foreground transitions.
- Bluetooth headset actions reliably trigger play/pause and track navigation.
- Failure behavior is deterministic and surfaced with named error codes.

Fail criteria:
- Playback consistently suspends on lock or background without reliable recovery.
- Remote controls are non-deterministic across core supported devices.

Decision outcome:
- Pass: Continue with YouTube-backed provider in MVP.
- Fail: Trigger fallback branch and evaluate playback implementation path without changing original backend contracts.

## 7. Backend and API delta

### 7.1 Must-do changes

- Add Bearer token acceptance while preserving existing cookie flow.
- Add explicit mobile auth response contract.
- Standardize error response shape across auth/import/playback APIs.
- Add refresh endpoint for mobile session continuity.

### 7.2 Optional improvements

- Incremental pagination for very large playlist track lists.
- Import completion notification hooks.

### 7.3 Auth lifecycle contract

- Access token TTL: 15 minutes
- Refresh token TTL: 30 days
- Rotation: refresh token rotates on successful refresh
- Revoke: logout revokes refresh token server-side and clears cookie/session artifacts
- Storage policy: access token in memory where possible, refresh token in secure storage
- Failure handling: if refresh fails with unauthorized, force relogin and preserve return context

## 8. Error taxonomy and UX contract

All critical failures must use named, greppable identifiers.

- AUTH_INVALID_CREDENTIALS
- AUTH_TOKEN_EXPIRED
- AUTH_REFRESH_FAILED
- IMPORT_INVALID_SPOTIFY_URL
- IMPORT_QUEUE_UNAVAILABLE
- MATCH_RESUME_COOLDOWN
- PLAYBACK_SOURCE_UNAVAILABLE
- PLAYBACK_BACKGROUND_BLOCKED
- REMOTE_CONTROL_BIND_FAILED
- NETWORK_OFFLINE_RETRYABLE

UX behavior:
- Each named error maps to a user-facing message and a defined recovery action.
- No generic unknown error message for critical paths unless an explicit fallback code is emitted.

## 9. Observability requirements

### 9.1 Logging

- Structured logs at all decision points in auth, import, playback, and remote command handling.
- Correlation IDs propagated from mobile client to backend.

### 9.2 Metrics

- Auth success/failure by endpoint and platform
- Time to first playback
- Background playback session duration
- Remote command success rate
- Import completion latency
- Error-rate by named error code

### 9.3 Tracing

- Trace context from mobile request to API and worker-side matching actions where relevant.

## 10. Performance and scalability requirements

- Status polling frequency: every 2 seconds while actively matching
- Backoff policy: 2s to 4s to 8s after repeated transient failures, reset on success
- Poll stop conditions: ready, paused, error, or app background timeout threshold
- First audio start target: p95 under 3.5 seconds on stable network
- Resume-to-audio target: p95 under 2.5 seconds after foreground return

## 11. UX flows and edge cases

### 11.1 Core flows

- Authenticated app launch
- Playlist import and progress
- Queue playback with now-playing state
- Background and lock screen control continuity

### 11.2 Required edge-case handling

- Empty or invalid import result
- Playlist with zero matched tracks
- Expired token while app is backgrounded
- Bluetooth disconnect during playback
- Network handoff between Wi-Fi and mobile
- OS process reclaim and session restore

## 12. Phased rollout

### Phase 1: Foundation and feasibility (2 to 3 weeks)

- Expo app skeleton and navigation
- Dual-mode auth compatibility and API contract docs
- Playback feasibility gate prototype and decision

### Phase 2: MVP build (5 to 7 weeks)

- Auth, import, library, playlist detail, core playback
- Named error handling and UI recovery patterns
- Initial analytics and reliability instrumentation

### Phase 3: Continuity and controls hardening (3 to 4 weeks)

- Background playback reliability improvements
- Lock screen and Bluetooth hardening
- Car environment baseline validation

### Phase 4: Beta and production hardening (4 to 6 weeks)

- Full test matrix execution
- Crash and performance tuning
- Staged rollout and parity backlog sequencing

## 13. Test plan requirements

Critical path diagram:

Entry -> Auth bootstrap -> token valid?
YES -> Fetch playlists -> Open playlist -> Playable track?
YES -> Start playback -> App backgrounded -> Remote action -> Continue playback -> Success
NO -> Show unavailable state -> Resume matching -> Ready or paused
NO token -> Refresh available?
YES -> Refresh -> Retry bootstrap
NO -> Controlled relogin with context restore

Required test coverage:
- Auth valid login and bootstrap success
- Token refresh success and failure branches
- Playlist import success, invalid URL, and queue/matching degradation paths
- Playback start, seek, next/previous, and end-of-track queue advance
- Background lock, unlock, and remote media action reliability
- Bluetooth disconnect/reconnect behavior
- Paused matching resume and cooldown behavior
- Network failure and retryability behavior

## 14. Success metrics

### 14.1 User metrics

- Signup to first playback completion rate
- Day 7 retention among users with at least one import
- Background session completion rate

### 14.2 Business metrics

- Mobile WAU
- Imports per active mobile user
- Web to mobile adoption rate

### 14.3 Technical metrics

- Crash-free sessions and ANR rate
- p95 first audio start and resume-to-audio latency
- Named error rates and top recovery outcomes

## 15. Risk register

- R-001: YouTube background playback limitations on specific device/OS combinations
  - Mitigation: Phase 1 feasibility gate and fallback branch
- R-002: Auth regressions from dual-mode token support
  - Mitigation: additive compatibility and explicit lifecycle contract
- R-003: Bluetooth and car integration fragmentation
  - Mitigation: device matrix and phased support commitments
- R-004: Import-to-play latency impacting user trust
  - Mitigation: progress transparency, retry UX, and caching-first play strategy

## 16. Open decisions

- Final state-management choice confirmation if team prefers Redux Toolkit over Zustand
- Exact supported device matrix for launch
- Car environment scope for MVP versus post-MVP

## 17. What is not in scope

- Full feature parity with all web-only UI polish in MVP
- Data model redesign in MongoDB
- Replacing Redis queue architecture
- Multi-provider playback implementation in MVP
