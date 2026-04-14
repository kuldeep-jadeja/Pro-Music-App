# PRD: Demus React Native Mobile App (iOS and Android)

## 1. Product overview

### 1.1 Document title and version

- PRD: Demus React Native Mobile App (iOS and Android)
- Version: 1.0

### 1.2 Product summary

The project will extend Demus from a web-first Next.js PWA into a mobile-native experience on iOS and Android using Expo. The mobile app will preserve the existing core product value: import public Spotify playlists, match tracks to YouTube, and play music with a smooth queue experience.

The initial release will be MVP-first to get into users' hands quickly. MVP will include authentication, playlist import, playlist browsing, track playback, and progress tracking for YouTube matching. The backend will remain the existing Next.js Pages Router API, with additive mobile compatibility improvements so current web behavior stays intact.

## 2. Goals

### 2.1 Business goals

- Launch a mobile app for iOS and Android without disrupting current web/PWA users.
- Reduce time-to-market by choosing Expo and reusing the current backend and data models.
- Validate mobile retention and playback engagement before investing in full feature parity.
- Build a foundation for future provider abstraction beyond YouTube.

### 2.2 User goals

- Sign up and log in securely from mobile.
- Import a public Spotify playlist and see matching progress.
- Start music quickly and keep listening while app is backgrounded.
- Control playback from lock screen, Bluetooth accessories, and car integrations.

### 2.3 Non-goals

- Full feature parity with the current web app in the MVP release.
- Replacing MongoDB or Redis architecture.
- Rewriting existing web frontend routes.
- Migrating away from YouTube as initial playback source in MVP.

## 3. User personas

### 3.1 Key user types

- Casual mobile listener importing existing Spotify playlists.
- Power user with long listening sessions across commuting and driving.
- Returning web user expecting the same Demus account and playlist data on mobile.

### 3.2 Basic persona details

- **Commuter listener**: Wants quick playlist import and reliable background playback on mobile data.
- **Hands-free driver**: Needs lock screen, Bluetooth, and car-friendly controls for safe playback interaction.
- **Cross-platform user**: Starts on web and continues on mobile with synced playlists and progress.

### 3.3 Role-based access

- **Guest**: Can open app and navigate auth screens only.
- **Authenticated user**: Can import playlists, browse own playlists, play matched tracks, and resume paused matching.

## 4. Functional requirements

- **Mobile app shell and navigation** (Priority: P0)
  - Build React Native app with Expo for iOS and Android.
  - Provide authenticated and unauthenticated navigation stacks.
  - Persist auth and playback session state across app restarts.

- **Authentication and session management** (Priority: P0)
  - Support signup, login, logout, and current-user bootstrap on app launch.
  - Introduce additive Bearer token support in backend while preserving existing cookie flow for web.
  - Store tokens using secure device storage.

- **Playlist import and library** (Priority: P0)
  - Allow users to submit Spotify playlist URL.
  - Show playlist cards with status and import progress.
  - Fetch and display playlist details with track lists.

- **Playback and queue controls** (Priority: P0)
  - Play matched tracks in queue order with next/previous controls.
  - Support pause, resume, seek, and volume controls where supported by platform/player implementation.
  - Keep playback active in background.

- **System media integration** (Priority: P0)
  - Provide lock screen media controls.
  - Support Bluetooth headphone media buttons.
  - Add car playback compatibility plan with phased support (CarPlay readiness).

- **Matching progress and recovery** (Priority: P1)
  - Poll playlist status while matching is in progress.
  - Surface paused/error states and allow retry/resume flows.

- **Provider abstraction foundation** (Priority: P1)
  - Define internal playback-provider interface in mobile app.
  - Implement YouTube provider first; keep contract ready for future providers.

- **Analytics and observability** (Priority: P1)
  - Track auth success/failure, import starts/completions, playback starts, playback errors, and background interruptions.

## 5. User experience

### 5.1 Entry points and first-time user flow

- User installs app from store and launches onboarding/auth flow.
- User signs up or logs in.
- User lands on home/library, pastes Spotify playlist URL, and starts import.
- User sees import status and can begin playback as matches become available.

### 5.2 Core experience

- **Authenticate**: User signs in and lands in library.
  - Ensures personalized and secure access to user-scoped playlists.
- **Import playlist**: User submits playlist URL and receives immediate feedback.
  - Ensures confidence with clear progress and status messaging.
- **Play music**: User starts track playback with queue controls.
  - Ensures low-friction listening comparable to native music apps.
- **Continue in background**: Playback persists when app is minimized or screen is locked.
  - Ensures uninterrupted listening during multitasking and commuting.

### 5.3 Advanced features and edge cases

- Playlist has no immediately matched tracks.
- Playlist matching moves to paused/error state.
- User switches network from Wi-Fi to mobile mid-playback.
- Token expires while app is backgrounded.
- OS reclaims app process and user relaunches.
- Bluetooth device disconnects during playback.

### 5.4 UI/UX highlights

- Mobile-first layouts with thumb-reachable primary controls.
- Persistent mini-player plus full now-playing screen.
- Real-time import progress and status chips.
- Clear error recovery actions for auth and matching failures.

## 6. Narrative

The user installs the mobile app, logs in, pastes a Spotify playlist link, and quickly sees tracks appear with matching progress. They start listening immediately, lock the phone, and continue controlling playback from lock screen and Bluetooth controls. Across sessions, their library stays synced with Demus backend data, creating a dependable cross-platform music experience that starts simple and improves toward full parity.

## 7. Success metrics

### 7.1 User-centric metrics

- Signup to first playback completion rate.
- Median time from app open to first track playback.
- Day 7 retention for users who import at least one playlist.
- Background playback session completion rate.

### 7.2 Business metrics

- Mobile weekly active users.
- Playlist imports per active mobile user.
- Percentage of web users adopting mobile app.

### 7.3 Technical metrics

- Mobile API auth success rate.
- Playback start success rate and rebuffer/error rate.
- Import pipeline completion time percentile.
- Crash-free sessions and ANR rate.

## 8. Technical considerations

### 8.1 Integration points

- Reuse current APIs for auth, import, playlists, playlist status, and stream resolution.
- Keep MongoDB as source of truth and Redis as optional queue/cache layer.
- Preserve worker-based YouTube matching architecture.

### 8.2 Data storage and privacy

- Store access tokens in platform secure storage.
- Avoid storing sensitive user data in plain-text device storage.
- Keep user data scoped by authenticated identity and existing backend authorization checks.

### 8.3 Scalability and performance

- Continue fire-and-forget import and matching behavior to keep app responses fast.
- Use lightweight polling strategy for status updates during active matching.
- Add API response caching where already supported by existing stream endpoint behavior.

### 8.4 Potential challenges

- YouTube playback constraints on mobile platforms and background behavior.
- Lock screen and transport controls reliability across OS/device combinations.
- Token migration and dual auth mechanism complexity.
- Car integration requirements and platform-specific certification constraints.

### 8.5 Best-fit stack

- **Recommended stack**: Expo React Native, TypeScript, React Navigation, TanStack Query, Zustand or Redux Toolkit, secure storage for tokens, and a mobile media control layer supporting lock screen and remote commands.
- **Fallback stack**: Bare React Native CLI if a hard native media requirement cannot be met inside managed Expo workflow timeline.

### 8.6 Why this fits current codebase

- Existing API boundaries already map to mobile needs, especially [pages/api/import-playlist.js](pages/api/import-playlist.js), [pages/api/playlists.js](pages/api/playlists.js), [pages/api/playlist/[id]/index.js](pages/api/playlist/[id]/index.js), [pages/api/playlist/[id]/status.js](pages/api/playlist/[id]/status.js), and [pages/api/stream/[trackId].js](pages/api/stream/[trackId].js).
- Current auth middleware can evolve additively from cookie-only in [lib/auth.js](lib/auth.js) and [lib/requireAuth.js](lib/requireAuth.js) to dual cookie plus Bearer support without breaking web.
- Existing matching and queue architecture in [lib/youtube.js](lib/youtube.js) and [workers/ytMatchWorker.js](workers/ytMatchWorker.js) remains unchanged for MVP.

### 8.7 Backend and API delta

- **Must-do changes**
  - Add Bearer token acceptance to auth parsing while preserving current cookie path.
  - Add mobile-oriented auth response payload for secure token storage and refresh handling strategy.
  - Standardize error contract across auth/import/playback endpoints for mobile UX consistency.
- **Optional improvements**
  - Add dedicated mobile session refresh endpoint.
  - Add incremental playlist track pagination endpoint for very large playlists.
  - Add push-notification hooks for long-running import completion.

## 9. Milestones and sequencing

### 9.1 Project estimate

- Medium-Large: 14 to 20 weeks to MVP plus parity groundwork.

### 9.2 Team size and composition

- 5 to 7 people: 2 mobile engineers, 1 backend engineer, 1 product designer, 1 QA engineer, part-time DevOps and PM.

### 9.3 Suggested phases

- **Phase 1**: Architecture and backend readiness (2 to 3 weeks)
  - Key deliverables: Expo app foundation, navigation skeleton, dual-auth backend changes, API contract document.
  - Effort and risk: Medium effort, medium risk due to auth compatibility.
- **Phase 2**: MVP feature build (5 to 7 weeks)
  - Key deliverables: Auth flows, playlist import, library views, playlist details, core playback, progress polling.
  - Effort and risk: High effort, medium risk from playback edge cases.
- **Phase 3**: Background playback and system controls (3 to 4 weeks)
  - Key deliverables: Background audio behavior, lock screen controls, Bluetooth transport controls, car integration baseline.
  - Effort and risk: High effort, high risk due to OS and device fragmentation.
- **Phase 4**: Hardening, beta, and rollout (4 to 6 weeks)
  - Key deliverables: Analytics, crash/perf tuning, test matrix completion, staged rollout, parity backlog prioritization.
  - Effort and risk: Medium effort, medium risk tied to production behavior variance.

## 10. User stories

### 10.1 Account signup on mobile

- **ID**: GH-001
- **Description**: As a new user, I want to create an account from the mobile app so I can save and access my playlists.
- **Acceptance criteria**:
  - Given valid email and password, signup succeeds and user is authenticated in app.
  - Given invalid inputs, user sees field-level validation messages.
  - Given duplicate email, user sees clear account-exists message.

### 10.2 Account login and secure session

- **ID**: GH-002
- **Description**: As a returning user, I want to log in and remain signed in securely across app restarts.
- **Acceptance criteria**:
  - Login succeeds with valid credentials.
  - Access token is stored in secure storage.
  - On app relaunch, user session is restored without manual re-login when token is valid.

### 10.3 Authentication and authorization enforcement

- **ID**: GH-003
- **Description**: As a user, I want my data protected so only I can access my playlists and import actions.
- **Acceptance criteria**:
  - Protected endpoints reject missing or invalid auth with 401.
  - User can access only own playlists and playlist details.
  - Existing web cookie auth behavior remains functional after mobile auth changes.

### 10.4 Import Spotify playlist

- **ID**: GH-004
- **Description**: As a user, I want to paste a Spotify playlist URL and import it into my library.
- **Acceptance criteria**:
  - Valid public Spotify playlist URL starts import successfully.
  - Invalid URL returns actionable error.
  - Imported playlist appears in library with status and progress.

### 10.5 View playlist library

- **ID**: GH-005
- **Description**: As a user, I want to see all my imported playlists in one mobile-friendly view.
- **Acceptance criteria**:
  - Library screen displays user playlists with cover, name, status, and progress.
  - Pull-to-refresh updates latest statuses.
  - Empty state explains how to import first playlist.

### 10.6 View playlist tracks and statuses

- **ID**: GH-006
- **Description**: As a user, I want to open a playlist and see available tracks and match readiness.
- **Acceptance criteria**:
  - Playlist detail shows track list and metadata.
  - Tracks without match are visibly marked unavailable.
  - Status updates reflect progress polling results.

### 10.7 Start and control playback

- **ID**: GH-007
- **Description**: As a user, I want to play tracks with standard controls so I can listen continuously.
- **Acceptance criteria**:
  - User can play, pause, seek, next, and previous.
  - Queue advances automatically when track ends.
  - Playback errors show user-friendly recovery message.

### 10.8 Continue playback in background

- **ID**: GH-008
- **Description**: As a user, I want music to continue when the app is backgrounded or screen is locked.
- **Acceptance criteria**:
  - Playback continues when app goes to background.
  - Playback remains controllable after screen lock.
  - App restores playback state after foreground return.

### 10.9 Lock screen and remote media controls

- **ID**: GH-009
- **Description**: As a user, I want lock screen and accessory controls so I can control playback hands-free.
- **Acceptance criteria**:
  - Lock screen displays current track metadata and transport controls.
  - Bluetooth headset controls trigger play/pause/next/previous.
  - Car-connected media controls can start and control playback in supported environments.

### 10.10 Resume paused matching

- **ID**: GH-010
- **Description**: As a user, I want to retry paused playlist matching so unavailable tracks can become playable.
- **Acceptance criteria**:
  - Paused state is surfaced with retry action.
  - Retry respects backend cooldown and returns proper feedback.
  - Successful resume updates status from paused to matching to ready.

### 10.11 Handle network disruptions gracefully

- **ID**: GH-011
- **Description**: As a mobile user, I want clear handling of connectivity issues so I can recover quickly.
- **Acceptance criteria**:
  - Import and playback requests show retriable errors on network failure.
  - App does not crash when connection changes mid-session.
  - User can retry failed action from UI without force-closing app.

### 10.12 Observability for mobile reliability

- **ID**: GH-012
- **Description**: As a product and engineering team, we want mobile analytics and error telemetry to improve release quality.
- **Acceptance criteria**:
  - Core funnel events are tracked (auth, import, playback start, playback error).
  - Crash and non-fatal error capture is available in release builds.
  - Dashboard can segment by platform and app version.

## Risk register

- **R-001**: Background playback limitations due to YouTube integration approach on mobile.
  - Mitigation: Early prototype in Phase 1 and fallback decisions by end of Phase 2.
- **R-002**: Auth regression risk when introducing Bearer tokens.
  - Mitigation: Additive parsing path and regression tests for web cookie flow.
- **R-003**: Device fragmentation across Bluetooth and car integrations.
  - Mitigation: Explicit device matrix and phased support guarantees.
- **R-004**: Import/matching latency impacts first-play experience.
  - Mitigation: Prioritize cached/matched tracks, clear progress, and retry UX.

## Open decisions

- Final mobile state management library selection.
- Final playback implementation details for YouTube-backed background behavior in Expo.
- Scope of car integration in MVP versus post-MVP.
- Token refresh strategy and expiration UX details.

After generating the PRD, I will ask if you want to proceed with creating GitHub issues for the user stories. If you agree, I will create them and provide you with the links.