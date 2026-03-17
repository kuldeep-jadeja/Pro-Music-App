# PRD v1.2: Demus React Native Mobile App (iOS and Android)

## 1. Product overview

### 1.1 Document title and version

- PRD: Demus React Native Mobile App (iOS and Android)
- Version: 1.2
- Date: March 17, 2026

### 1.2 Product summary

Demus will expand from a web-first Next.js PWA to a mobile-native app on iOS and Android using Expo. MVP focuses on fast delivery of core value: auth, Spotify playlist import, playlist browsing, track playback, and import/match progress.

v1.2 locks architecture and operations contracts to eliminate ambiguity before implementation: dual-auth contract, provider boundary, deterministic error envelope, adaptive polling, test matrix, and queue-lag SLO policy.

## 2. Goals

### 2.1 Business goals

- Launch mobile app without disrupting existing web/PWA behavior.
- Deliver MVP quickly by reusing existing backend boundaries.
- Validate mobile retention and listening engagement.
- Preserve optional path to non-YouTube providers in later phases.

### 2.2 User goals

- Securely sign up and log in from mobile.
- Import public Spotify playlists and track progress.
- Keep playback running through background and lock screen transitions.
- Control playback through lock screen, Bluetooth devices, and baseline car transport controls.

### 2.3 Non-goals

- Full web feature parity in MVP.
- Backend rewrite away from Next.js Pages Router.
- Replacing MongoDB or Redis architecture.
- Multi-provider playback implementation in MVP.
- Full CarPlay/Android Auto feature parity in MVP.

## 3. Best-fit stack

### 3.1 Primary recommendation

- Expo React Native with TypeScript
- React Navigation
- TanStack Query for server state
- Zustand for app/player UI state
- Secure token storage
- PlaybackProvider interface with YouTube provider first

### 3.2 Fallback recommendation

- Bare React Native CLI only if feasibility gate fails due to native media limitations that cannot be resolved in Expo timeline.

## 4. What already exists

This plan explicitly reuses existing backend architecture and avoids rebuild.

- Import pipeline and async match orchestration: [pages/api/import-playlist.js](pages/api/import-playlist.js), [lib/youtube.js](lib/youtube.js), [workers/ytMatchWorker.js](workers/ytMatchWorker.js)
- Auth and authorization foundation: [lib/auth.js](lib/auth.js), [lib/requireAuth.js](lib/requireAuth.js)
- Playlist and status retrieval boundaries: [pages/api/playlists.js](pages/api/playlists.js), [pages/api/playlist/[id]/index.js](pages/api/playlist/[id]/index.js), [pages/api/playlist/[id]/status.js](pages/api/playlist/[id]/status.js)
- Stream lookup and cache path: [pages/api/stream/[trackId].js](pages/api/stream/[trackId].js)

## 5. Locked architecture

### 5.1 System architecture

```text
Mobile App (Expo)
  ├─ Auth Client
  │   ├─ Access token (short TTL)
  │   └─ Refresh token (secure storage, rotating)
  ├─ Playback Core
  │   ├─ PlaybackProvider interface
  │   ├─ YouTubeProvider (MVP)
  │   └─ Remote controls adapter (lockscreen/bluetooth/car baseline)
  └─ API Client
      ├─ /api/import-playlist
      ├─ /api/playlists
      ├─ /api/playlist/[id], /status
      └─ /api/stream/[trackId]

Next.js Pages API
  ├─ Dual auth acceptance: cookie + bearer
  ├─ Standard error envelope + named codes + correlation id
  ├─ MongoDB source of truth
  └─ Redis optional cache/queue
       └─ ytMatchWorker async matching
```

### 5.2 Production failure scenarios for new codepaths

- Auth bootstrap: expired access token after background resume can cause retry loops.
- Playback continuity: OS may suspend or downgrade media session during lock transition.
- Remote controls: Bluetooth events may race app state hydration.
- Import progress: reconnect storms can spike status polling load.

## 6. Functional requirements

### 6.1 P0 MVP

- Mobile shell and authenticated routing
- Signup, login, logout, bootstrap session
- Playlist import and library
- Playlist detail and track readiness states
- Core playback controls: play, pause, seek, next, previous
- Background playback continuity
- Lock screen and Bluetooth transport controls
- Car baseline transport controls only
- Import matching progress and paused-state resume

### 6.2 P1 Post-MVP

- Provider expansion beyond YouTube
- Car integration hardening and broader compatibility
- Import completion notification hooks

## 7. Critical feasibility gate

### 7.1 Phase 1 playback feasibility gate

A mandatory gate must pass before MVP execution continues.

Pass criteria:
- Background playback continues at least 30 minutes on core iOS and Android devices.
- Lock screen transport controls remain functional across background and foreground transitions.
- Bluetooth actions reliably trigger play/pause and track navigation.
- Failures are deterministic and mapped to named error codes.

Fail criteria:
- Playback consistently suspends on lock/background without reliable recovery.
- Remote controls are non-deterministic across core supported devices.

Decision outcomes:
- Pass: continue YouTube provider in MVP.
- Fail: trigger fallback branch evaluation without changing backend contracts.

## 8. Backend and API contract

### 8.1 Must-do backend deltas

- Accept Bearer token while preserving existing cookie flow.
- Provide explicit mobile auth response contract.
- Standardize response envelope for all mobile-critical endpoints.
- Add refresh endpoint for mobile session continuity.

### 8.2 Optional backend deltas

- Incremental pagination for very large playlist track lists.
- Import completion notification hooks.

### 8.3 Auth lifecycle contract (locked)

- Access token TTL: 15 minutes
- Refresh token TTL: 30 days
- Rotation: refresh token rotates on successful refresh
- Revoke: logout revokes refresh token server-side and clears session artifacts
- Storage policy: access token in memory where possible, refresh token in secure storage
- Failure policy: if refresh fails unauthorized, force relogin and preserve return context

### 8.4 Canonical API error envelope (locked)

```json
{
  "ok": false,
  "error": {
    "code": "AUTH_TOKEN_EXPIRED",
    "message": "Session expired. Please sign in again.",
    "retryable": false,
    "correlationId": "req_1234567890"
  }
}
```

Rules:
- Every mobile-critical error must include `code`, `message`, `retryable`, `correlationId`.
- Every code maps to one explicit user recovery path.
- No silent fallback for critical failures.

## 9. Error taxonomy and UX contract

Named codes:
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

UX policy:
- Each code maps to one clear user message and one primary recovery action.
- Unknown codes must map to explicit fallback code with support context.

## 10. Observability requirements

### 10.1 Logging

- Structured logs at auth, import, playback, and remote command decision points.
- Correlation IDs propagated from mobile client through API and worker paths where applicable.

### 10.2 Metrics

- Auth success/failure by endpoint and platform
- Time to first playback
- Resume-to-audio time after foreground
- Background playback session duration
- Remote command success rate
- Import completion latency
- Named error rate by code
- Matching queue lag

### 10.3 Tracing

- Trace context from mobile request through API and matching pipeline boundaries.

## 11. Performance and scalability requirements

### 11.1 Locked implementation constants

| Constant | Value | Notes |
|---|---:|---|
| Status poll base interval | 2s | During active matching |
| Poll backoff sequence | 2s, 4s, 8s | On transient failures |
| Poll jitter | +/- 20% | Reduce synchronized bursts |
| Poll stop states | ready, paused, error | No wasted polling |
| Prefetch window | next 1 to 2 tracks | Bound network and memory |
| First audio start SLO | p95 < 3.5s | Stable network |
| Resume-to-audio SLO | p95 < 2.5s | Foreground resume |
| Queue-lag SLO | p95 queue wait < 90s | Beyond this triggers degrade policy |

### 11.2 Adaptive polling policy (locked)

- Use adaptive polling with jitter and optional server hints.
- Stop polling immediately on terminal states.
- On sustained transient failures, escalate to UI degrade state and manual retry affordance.

### 11.3 Queue-lag degrade policy (locked)

- If queue-lag SLO breached, UI surfaces delayed matching banner.
- Prioritize playback-ready tracks.
- Reduce polling aggressiveness while preserving user awareness.

## 12. UX flows and edge cases

### 12.1 Core flows

- Authenticated app launch
- Playlist import and progress
- Queue playback with now-playing state
- Background and lock screen continuity

### 12.2 Required edge cases

- Empty or invalid import result
- Playlist with zero matched tracks
- Expired token while app backgrounded
- Bluetooth disconnect during playback
- Network handoff between Wi-Fi and mobile
- OS process reclaim and session restore

## 13. Test plan requirements

### 13.1 Critical path diagram

```text
[App Launch]
  -> [Auth Bootstrap]
     -> token valid?
        -> YES -> [Fetch playlists] -> [Open playlist]
                  -> playable track?
                     -> YES -> [Start playback] -> [Background app]
                              -> [Remote action] -> action success?
                                 -> YES -> [Continue playback]
                                 -> NO  -> [Named error + recovery]
                     -> NO  -> [Unavailable state] -> [Resume matching]
        -> NO  -> refresh available?
                  -> YES -> [Refresh] -> success?
                             -> YES -> [Retry bootstrap]
                             -> NO  -> [Controlled relogin]
                  -> NO  -> [Controlled relogin]
```

### 13.2 Required automated coverage

- Auth valid login and bootstrap success
- Token refresh success and failure branches
- Playlist import success and invalid URL handling
- Queue/matching degradation path handling
- Playback start, seek, next/previous, end-of-track advance
- Background lock/unlock and remote action reliability
- Bluetooth disconnect and reconnect handling
- Paused matching resume and cooldown behavior
- Network failure and retryability behavior
- API contract tests for dual-auth acceptance and error envelope
- Fault-injection tests for token expiry, network handoff, and remote-action race

### 13.3 Tiered device matrix (locked)

Must-pass tier:
- Current iOS stable major version on two device classes
- Current Android stable major version on two OEM classes

Best-effort tier:
- Previous major iOS and Android versions
- Additional Bluetooth accessory models

## 14. Phased rollout

### Phase 1: Foundation and feasibility (2 to 3 weeks)

- Expo app skeleton and navigation
- Dual-auth contract draft and API envelope contract
- Playback feasibility gate prototype and decision

### Phase 2: MVP build (5 to 7 weeks)

- Auth, import, library, playlist detail, core playback
- PlaybackProvider interface with YouTube provider
- Named error handling and recovery UX
- Initial analytics and reliability instrumentation

### Phase 3: Continuity hardening (3 to 4 weeks)

- Background playback reliability improvements
- Lock screen and Bluetooth hardening
- Car baseline validation across defined matrix

### Phase 4: Beta and production hardening (4 to 6 weeks)

- Full matrix and fault-injection test execution
- Crash and performance tuning
- Staged rollout and parity backlog sequencing

## 15. Success metrics

### 15.1 User metrics

- Signup to first playback completion rate
- Day 7 retention for users with at least one import
- Background session completion rate

### 15.2 Business metrics

- Mobile WAU
- Imports per active mobile user
- Web to mobile adoption rate

### 15.3 Technical metrics

- Crash-free sessions and ANR rate
- p95 first audio start and resume-to-audio latency
- Named error rates and top recovery outcomes
- Queue-lag SLO breach frequency

## 16. Risk register

- R-001: YouTube background playback limitations on specific OS/device combinations
  - Mitigation: Phase 1 feasibility gate and fallback branch
- R-002: Auth regressions from dual-mode token support
  - Mitigation: additive compatibility and contract tests
- R-003: Bluetooth and car integration fragmentation
  - Mitigation: tiered device matrix and baseline-only MVP scope
- R-004: Import-to-play latency reducing user trust
  - Mitigation: queue-lag SLO, degrade policy, bounded prefetch

## 17. Deferred items register

| Item | Why deferred | Trigger to prioritize | Size estimate |
|---|---|---|---|
| Full CarPlay/Android Auto parity | Outside MVP value/effort ratio | Sustained MAU growth and transport demand | 3 to 5 weeks |
| Multi-provider playback implementation | Requires validated provider demand | Feasibility or licensing shift post-MVP | 4 to 8 weeks |
| Push notification completion flow | Nice-to-have for MVP | High import volume with long waits | 1 to 2 weeks |

## 18. Open decisions

- Confirm final state management choice if team strongly prefers Redux Toolkit over Zustand.
- Finalize exact launch device model list in must-pass tier.
- Confirm fallback execution owner and deadline if feasibility gate fails.

## 19. Not in scope

- Full web UI parity in MVP
- Data model redesign in MongoDB
- Redis queue architecture replacement
- Multi-provider playback implementation in MVP
- Full car platform parity in MVP
