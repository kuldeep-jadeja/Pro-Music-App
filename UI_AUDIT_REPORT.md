# Demus — UI / UX Audit Report

**Date:** 2026-03-05  
**Application:** Demus (Next.js 16 / Pages Router)  
**Audit method:** Automated browser screenshots at 320 px, 375 px, 768 px, 1 440 px, 1 920 px + full source-code analysis of every component and SCSS module.

---

## Table of Contents

1. [Global Layout Issues](#1-global-layout-issues)
2. [Home Page Issues](#2-home-page-issues)
3. [Playlist Screen Issues](#3-playlist-screen-issues)
4. [Player UI Issues](#4-player-ui-issues)
5. [Import Flow Issues](#5-import-flow-issues)
6. [Responsiveness Issues](#6-responsiveness-issues)
7. [Component Consistency Issues](#7-component-consistency-issues)
8. [UX Flow Problems](#8-ux-flow-problems)
9. [Prioritized Improvement Plan](#9-prioritized-improvement-plan)

---

## 1. Global Layout Issues

### 1.1 Sidebar never collapses on small viewports

|                    |                                                                                                                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description**    | The sidebar is a fixed 240 px panel (`$sidebar-width`) with no breakpoint that hides or collapses it. At 375 px the sidebar consumes ~64 % of the viewport width, leaving the main content area nearly unusable. At 320 px the CTA buttons and subtitle text are clipped behind the sidebar edge. |
| **Screenshot ref** | Mobile 375 px screenshot, Mobile 320 px screenshot                                                                                                                                                                                                                                                |
| **Severity**       | **High**                                                                                                                                                                                                                                                                                          |
| **Suggested fix**  | Add a hamburger toggle. Below ~768 px, hide the sidebar off-screen with `transform: translateX(-100%)` and overlay it on tap. Add a semi-transparent backdrop scrim.                                                                                                                              |

### 1.2 Navbar left offset hard-coded to sidebar width

|                    |                                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Description**    | `.navbar { left: $sidebar-width; }` means the navbar never adjusts when the sidebar collapses. On mobile the navbar starts 240 px from the left while the sidebar is still visible — content and navbar fight for space. |
| **Screenshot ref** | Mobile 375 px screenshot — search bar and auth links pushed far right                                                                                                                                                    |
| **Severity**       | **High**                                                                                                                                                                                                                 |
| **Suggested fix**  | When the sidebar is hidden (mobile), set `left: 0` on `.navbar` via a responsive breakpoint.                                                                                                                             |

### 1.3 Content padding-bottom compensation is fragile

|                    |                                                                                                                                                                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description**    | `.content` uses `padding-bottom: calc(#{$player-height} + 28px)` to prevent the fixed player from overlapping content. This is a magic-number approach that will break if the player height changes or if the player gains a "now playing" expansion. |
| **Screenshot ref** | Desktop 1 440 px screenshot — bottom content just above player bar                                                                                                                                                                                    |
| **Severity**       | **Low**                                                                                                                                                                                                                                               |
| **Suggested fix**  | Consider a flexbox approach where the player is part of the document flow, or use a CSS custom property `--player-height` updated if the player resizes.                                                                                              |

### 1.4 No maximum content width on ultrawide screens

|                    |                                                                                                                                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description**    | On a 1 920 px viewport, the main content area stretches to ~1 680 px (1920 − 240). Text lines in the hero CTA and track lists become very long. There is no `max-width` container to constrain content for readability. |
| **Screenshot ref** | Desktop 1 920 px screenshot                                                                                                                                                                                             |
| **Severity**       | **Medium**                                                                                                                                                                                                              |
| **Suggested fix**  | Add a `max-width: 1 200px` (or similar) wrapper inside `.content` with `margin: 0 auto`.                                                                                                                                |

### 1.5 Inconsistent z-index layering

|                    |                                                                                                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description**    | Sidebar z-index is `110`, navbar is `100`, player slot is `120`. The navbar is _under_ the sidebar, which is correct, but the player overlaps everything including potential modals. There is no documented z-index scale. |
| **Screenshot ref** | Source code analysis: `AppLayout.module.scss`, `Sidebar.module.scss`, `Navbar.module.scss`                                                                                                                                 |
| **Severity**       | **Low**                                                                                                                                                                                                                    |
| **Suggested fix**  | Define a z-index token system in `_variables.scss` (e.g., `$z-sidebar: 200; $z-navbar: 100; $z-player: 300; $z-overlay: 400; $z-modal: 500;`).                                                                             |

---

## 2. Home Page Issues

### 2.1 Guest CTA feels empty and lacks visual weight

|                    |                                                                                                                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description**    | For logged-out users, the entire main area shows only a small play icon, a heading, a subtitle, and two buttons — centered in a vast dark void. There is no feature showcase, illustration, or social proof to motivate sign-up. |
| **Screenshot ref** | Desktop 1 440 px home screenshot (guest state)                                                                                                                                                                                   |
| **Severity**       | **Medium**                                                                                                                                                                                                                       |
| **Suggested fix**  | Add a hero illustration or gradient background card. Consider showing a few sample playlist cards (blurred or locked) to demonstrate what the product offers.                                                                    |

### 2.2 Duplicate "Log in" affordance

|                    |                                                                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description**    | The guest homepage has a "Log in" button _in the CTA area_ **and** a "Log in" link in the navbar, both visible simultaneously. This redundancy clutters the interface. |
| **Screenshot ref** | Desktop 1 440 px home screenshot                                                                                                                                       |
| **Severity**       | **Low**                                                                                                                                                                |
| **Suggested fix**  | Keep the navbar auth links but make the CTA area focus on sign-up only, or differentiate the two more clearly (e.g., navbar: text link; hero: outline button).         |

### 2.3 Search bar is non-functional for guests

|                    |                                                                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description**    | The search bar is visible and focusable for logged-out users but has no functionality. Typing in it does nothing, which risks confusing new visitors. |
| **Screenshot ref** | Desktop 1 440 px home screenshot — search bar in navbar                                                                                               |
| **Severity**       | **Medium**                                                                                                                                            |
| **Suggested fix**  | Either hide the search bar for guests or show a disabled state with a tooltip ("Log in to search").                                                   |

### 2.4 No `id` anchors for sidebar links

|                    |                                                                                                                                                                                                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Description**    | Sidebar links "Playlists" → `/#playlists` and "Import" → `/#import` point to fragment anchors that don't exist in the DOM. Clicking them navigates to the homepage but scrolls nowhere (for guests). Even for authenticated users, the `PlaylistGrid` and `ImportForm` sections don't have corresponding `id="playlists"` or `id="import"` attributes. |
| **Screenshot ref** | Snapshot of sidebar: `href="/#playlists"`, `href="/#import"`                                                                                                                                                                                                                                                                                           |
| **Severity**       | **High**                                                                                                                                                                                                                                                                                                                                               |
| **Suggested fix**  | Add `id="playlists"` to the `PlaylistGrid` wrapper and `id="import"` to the `importCard` div, or change these links to actual routes if separate pages are intended.                                                                                                                                                                                   |

### 2.5 "Playlists" and "Import" sidebar items never show active state

|                    |                                                                                                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Description**    | Only the "Home" nav item computes an `.active` class (via `router.pathname === '/'`). "Playlists" and "Import" never highlight even when you've scrolled to those sections, because there is no scroll-spy logic or route matching for hash fragments. |
| **Screenshot ref** | All screenshots show only "Home" highlighted                                                                                                                                                                                                           |
| **Severity**       | **Medium**                                                                                                                                                                                                                                             |
| **Suggested fix**  | Implement a scroll-spy using `IntersectionObserver` or, if these become separate routes, match on `router.pathname`.                                                                                                                                   |

---

## 3. Playlist Screen Issues

### 3.1 Playlist view is inline on the home page — no dedicated route

|                    |                                                                                                                                                                                                                                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description**    | When a user clicks a playlist, the `activePlaylist` state renders a hero banner + track list inline on the home page. There is no `/playlist/[id]` client-side page (the API route exists at `pages/api/playlist/[id]/index.js`, but there is no matching page route). This means you cannot share or bookmark a playlist view URL. |
| **Screenshot ref** | Code analysis: `pages/index.js` renders the playlist view conditionally                                                                                                                                                                                                                                                             |
| **Severity**       | **High**                                                                                                                                                                                                                                                                                                                            |
| **Suggested fix**  | Create `pages/playlist/[id].js` as a proper page component, or use `router.push` with shallow routing so the URL updates when a playlist is selected.                                                                                                                                                                               |

### 3.2 Playlist header content hierarchy on tablet

|                    |                                                                                                                                                                                                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description**    | At ≤ 900 px, the playlist content switches to column layout (`flex-direction: column; align-items: center`), which is good. However, the playlist name truncates with `@include truncate` (single-line ellipsis), which cuts off longer names when the container narrows. Combined with `text-align: center`, the single-line truncation looks awkward. |
| **Screenshot ref** | Code analysis: `Home.module.scss` responsive block at 900 px                                                                                                                                                                                                                                                                                            |
| **Severity**       | **Medium**                                                                                                                                                                                                                                                                                                                                              |
| **Suggested fix**  | Allow 2–3 lines via `-webkit-line-clamp` instead of single-line truncation, or let the name wrap naturally.                                                                                                                                                                                                                                             |

### 3.3 No back/close button for playlist view

|                    |                                                                                                                                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description**    | Once a playlist expands on the home page, there is no visible way to "close" it and return to the playlist grid overview. The user must mentally map that clicking a different playlist will swap the view. |
| **Screenshot ref** | Code analysis: `pages/index.js` — no close/back affordance in playlist view                                                                                                                                 |
| **Severity**       | **Medium**                                                                                                                                                                                                  |
| **Suggested fix**  | Add a back arrow or "× Close" button at the top of the playlist hero to deselect the active playlist.                                                                                                       |

---

## 4. Player UI Issues

### 4.1 Player bottom bar partially hidden behind OS nav / browser chrome on mobile

|                    |                                                                                                                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description**    | The player is `position: fixed; bottom: 0`. On mobile Safari and some Android browsers with bottom address bars, the 80 px player can be partially obscured. No `env(safe-area-inset-bottom)` compensation is applied. |
| **Screenshot ref** | Mobile 375 px screenshot — player barely visible at bottom                                                                                                                                                             |
| **Severity**       | **High**                                                                                                                                                                                                               |
| **Suggested fix**  | Add `padding-bottom: env(safe-area-inset-bottom)` to `.player` and adjust `$player-height` or use a CSS variable.                                                                                                      |

### 4.2 Volume control hidden on mobile with no alternative

|                    |                                                                                                                                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description**    | At ≤ 768 px, `Player.module.scss` sets `.volume { display: none; }`. There is no alternative volume control — users on mobile have no way to adjust volume within the app (they must use hardware buttons). |
| **Screenshot ref** | Code: `Player.module.scss` responsive block at 768 px                                                                                                                                                       |
| **Severity**       | **Medium**                                                                                                                                                                                                  |
| **Suggested fix**  | Either keep a compact volume icon that opens a vertical slider overlay, or document that hardware volume is expected.                                                                                       |

### 4.3 Empty player state is full-width and uninformative

|                    |                                                                                                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description**    | When no track is selected, the player shows "Select a track to start listening" centered in a full-width 80 px bar. This wastes screen real estate and offers no visual cue about _how_ to select a track. |
| **Screenshot ref** | Desktop 1 440 px home screenshot — bottom bar                                                                                                                                                              |
| **Severity**       | **Low**                                                                                                                                                                                                    |
| **Suggested fix**  | Consider hiding the player entirely when no track is loaded, or reducing it to a slim 40 px hint bar with an upward arrow and instruction.                                                                 |

### 4.4 Progress bar click target is usable but the scrubber thumb is invisible by default

|                    |                                                                                                                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description**    | The progress bar's scrubber (`::after` on `.progressFill`) is `opacity: 0` by default and only appears on hover. On touch devices there is no hover state so users cannot see the thumb at all; they must guess where to tap. |
| **Screenshot ref** | Code: `Player.module.scss` `.progressFill::after { opacity: 0 }`                                                                                                                                                              |
| **Severity**       | **Medium**                                                                                                                                                                                                                    |
| **Suggested fix**  | Show the scrubber thumb at reduced opacity by default on touch devices using `@media (pointer: coarse)`.                                                                                                                      |

### 4.5 No shuffle or repeat controls

|                    |                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description**    | The player has Previous, Play/Pause, and Next buttons only. There are no Shuffle or Repeat toggles, which are standard in music player UIs. |
| **Screenshot ref** | Code: `Player.js` button section                                                                                                            |
| **Severity**       | **Low**                                                                                                                                     |
| **Suggested fix**  | Add Shuffle and Repeat toggle buttons to the left and right of the transport controls respectively.                                         |

---

## 5. Import Flow Issues

### 5.1 Import form is buried inside the home page, not in a dedicated location

|                    |                                                                                                                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description**    | The import flow is only visible to authenticated users as a card on the home page. The sidebar "Import" link goes to `/#import`, but there is no element with `id="import"`. New users may not discover the import feature. |
| **Screenshot ref** | Desktop home (authenticated state) — Import card section in source                                                                                                                                                          |
| **Severity**       | **Medium**                                                                                                                                                                                                                  |
| **Suggested fix**  | Add `id="import"` to the import card wrapper. Consider also creating a dedicated `/import` page for a cleaner UX.                                                                                                           |

### 5.2 No input validation feedback before submission

|                    |                                                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Description**    | The import form only validates that the URL is non-empty after submission. There is no pattern matching for Spotify URLs, so users can paste any text and only learn it's invalid after a server round-trip. |
| **Screenshot ref** | Code: `ImportForm.js` `handleSubmit()` — only checks `url.trim()`                                                                                                                                            |
| **Severity**       | **Medium**                                                                                                                                                                                                   |
| **Suggested fix**  | Add client-side regex validation for Spotify playlist URL patterns (`https://open.spotify.com/playlist/...`) and show an inline error immediately.                                                           |

### 5.3 No cancel mechanism during import

|                    |                                                                                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description**    | Once the import starts (PROCESSING → MATCHING phases), there is no "Cancel" button. The user is locked into waiting for the operation to complete or error out. |
| **Screenshot ref** | Code: `ImportForm.js` — no cancel/abort logic in PROCESSING or MATCHING phases                                                                                  |
| **Severity**       | **Medium**                                                                                                                                                      |
| **Suggested fix**  | Add a Cancel button that stops polling, resets to IDLE state, and optionally calls a cancel API endpoint.                                                       |

### 5.4 Import success auto-redirects without user confirmation

|                    |                                                                                                                                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description**    | After the COMPLETE phase, `onImportSuccess` is called after a 1.8 s timeout, which likely triggers navigation or state change. The user has no control over when this happens and may miss the success animation. |
| **Screenshot ref** | Code: `ImportForm.js` `setTimeout(() => { onImportSuccess?.(playlist); }, 1800)`                                                                                                                                  |
| **Severity**       | **Low**                                                                                                                                                                                                           |
| **Suggested fix**  | Show a "View Playlist" button in the success state instead of auto-navigating.                                                                                                                                    |

---

## 6. Responsiveness Issues

### 6.1 Sidebar does not collapse — critical mobile breakage

|                    |                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Description**    | _See §1.1._ The sidebar remains a fixed 240 px panel at all viewport widths. At ≤ 768 px, this makes the entire app nearly unusable. |
| **Screenshot ref** | Mobile 375 px and 320 px screenshots                                                                                                 |
| **Severity**       | **High**                                                                                                                             |
| **Suggested fix**  | Implement a collapsible sidebar with hamburger menu at ≤ 768 px.                                                                     |

### 6.2 Navbar auth buttons overflow at 320 px

|                    |                                                                                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description**    | At 320 px, the navbar area (320 − 240 = 80 px left for navbar) cannot fit the search icon + "Log in" + "Sign up" button. The elements overflow or are squished. |
| **Screenshot ref** | Mobile 320 px screenshot — "Log in" and "Sign up" barely visible                                                                                                |
| **Severity**       | **High**                                                                                                                                                        |
| **Suggested fix**  | Tied to sidebar collapse. Additionally, hide the search bar on very small screens and show only a search icon.                                                  |

### 6.3 CTA heading font size too large for mobile

|                    |                                                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description**    | `.ctaTitle` is `font-size: 2.5rem` with no responsive reduction. On a 375 px screen (minus the sidebar), the "Welcome to Demus" heading breaks across 3+ lines with huge type, dominating the small viewport. |
| **Screenshot ref** | Mobile 375 px screenshot — heading wraps awkwardly                                                                                                                                                            |
| **Severity**       | **Medium**                                                                                                                                                                                                    |
| **Suggested fix**  | Add a `@media (max-width: 768px)` rule reducing `.ctaTitle` to `1.5rem` or use `clamp(1.5rem, 5vw, 2.5rem)`.                                                                                                  |

### 6.4 PlaylistGrid card minimum width may cause overflow on narrow screens

|                    |                                                                                                                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description**    | `grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))` means cards won't shrink below 180 px. On a very narrow content area (e.g., 375 − 240 = 135 px with sidebar), cards will overflow horizontally. |
| **Screenshot ref** | Code: `PlaylistGrid.module.scss`                                                                                                                                                                               |
| **Severity**       | **Medium**                                                                                                                                                                                                     |
| **Suggested fix**  | Reduce the minimum to `minmax(140px, 1fr)` and/or add `overflow-x: hidden` on the container. This is primarily resolved by collapsing the sidebar on mobile.                                                   |

### 6.5 Auth pages lack `viewport` meta tag management

|                    |                                                                                                                                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description**    | Login and Signup pages set their own `<Head>` with only `<title>`, inheriting the viewport meta from `index.js`. This works currently, but if the index page's viewport meta is ever removed, auth pages would lose mobile scaling. |
| **Screenshot ref** | Code: `login.js`, `signup.js` — no viewport meta                                                                                                                                                                                    |
| **Severity**       | **Low**                                                                                                                                                                                                                             |
| **Suggested fix**  | Add the `viewport` meta to `_document.js` so it applies globally.                                                                                                                                                                   |

---

## 7. Component Consistency Issues

### 7.1 Button style inconsistencies across contexts

|                    |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description**    | Multiple distinct button styles exist with no shared base class: (a) `.ctaBtn` — pill, `$accent` bg, white text; (b) `.authBtn` in Navbar — pill, `$accent` bg, white text but smaller padding; (c) `.button` in Auth — rounded-md, `$accent` bg, **black** text; (d) `.button` in ImportForm — pill, `$accent` bg, white text; (e) `.resumeBtn` in PlaylistCard — `$warning` bg, `$bg-primary` text. The auth button uses black text on purple while all others use white text on the same purple. |
| **Screenshot ref** | Login page screenshot vs. Home page screenshot — button text color differs                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Severity**       | **Medium**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Suggested fix**  | Create shared button mixins or utility classes for primary, secondary, and danger button variants. Standardize text color to white on `$accent` backgrounds.                                                                                                                                                                                                                                                                                                                                        |

### 7.2 Border radius inconsistency on cards

|                    |                                                                                                                                                                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description**    | `PlaylistCard` uses `$radius-xl` (16 px). Auth card uses `$radius-lg` (12 px). `ImportForm` state cards use `$radius-xl`. The import input wrapper uses `$radius-full` (pill). While intentional variety is fine, the auth card looking less rounded than feature cards creates visual disharmony. |
| **Screenshot ref** | Login screenshot vs. Home import card                                                                                                                                                                                                                                                              |
| **Severity**       | **Low**                                                                                                                                                                                                                                                                                            |
| **Suggested fix**  | Standardize interactive cards to `$radius-xl` consistently, or document the intent behind each variation.                                                                                                                                                                                          |

### 7.3 Badge styles defined in multiple modules

|                    |                                                                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description**    | `.badge` appears in both `PlaylistCard.module.scss` and `TrackList.module.scss` with similar but not identical styles. Both use `font-size: 0.6875rem`, `border-radius: $radius-full`, but the `background` and `padding` values differ slightly. |
| **Screenshot ref** | Source code comparison                                                                                                                                                                                                                            |
| **Severity**       | **Low**                                                                                                                                                                                                                                           |
| **Suggested fix**  | Extract a shared `badge` mixin or component style that both modules reference.                                                                                                                                                                    |

### 7.4 Typography scale not formally documented

|                    |                                                                                                                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description**    | Font sizes range from `0.625rem` to `2.5rem` across modules with no type-scale system. Sizes like `0.6875rem`, `0.8125rem`, `0.9375rem` (11 px, 13 px, 15 px) are used extensively but aren't defined as tokens. |
| **Screenshot ref** | Source code: `_variables.scss` — no type-size tokens                                                                                                                                                             |
| **Severity**       | **Low**                                                                                                                                                                                                          |
| **Suggested fix**  | Define a type-scale in `_variables.scss` (e.g., `$text-xs`, `$text-sm`, `$text-base`, `$text-lg`, `$text-xl`, `$text-2xl`, `$text-3xl`) and reference them throughout.                                           |

---

## 8. UX Flow Problems

### 8.1 Playlist browsing requires authentication

|                    |                                                                                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Description**    | Guest users see only a CTA to sign up. There is no way to preview or browse any content without creating an account. This creates a significant acquisition friction point — users must commit before they can evaluate the product. |
| **Screenshot ref** | Desktop home (guest) screenshot — no content visible                                                                                                                                                                                 |
| **Severity**       | **High**                                                                                                                                                                                                                             |
| **Suggested fix**  | Show sample or featured playlists for guest users. Allow browsing playlist metadata (names, cover art, track counts) without requiring login. Gate playback and import behind auth instead.                                          |

### 8.2 Track selection and playback relationship unclear

|                    |                                                                                                                                                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description**    | Clicking a track in the `TrackList` simultaneously selects it _and_ starts playback (via `onTrackSelect`). There is no visual distinction between "selected" and "playing" — the active row shows an animated bars icon. Users cannot inspect a track without playing it. |
| **Screenshot ref** | Code: `TrackList.js` onClick → `onTrackSelect`, `Player.js` auto-plays on track change                                                                                                                                                                                    |
| **Severity**       | **Low**                                                                                                                                                                                                                                                                   |
| **Suggested fix**  | This is standard behavior for music apps (Spotify, Apple Music). Consider it acceptable but add a right-click / long-press context menu in the future for additional actions.                                                                                             |

### 8.3 No feedback when clicking "No match" tracks

|                    |                                                                                                                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description**    | Tracks without a YouTube match have `cursor: not-allowed` and reduced opacity (`0.4`), but clicking them produces no error message or tooltip. Users may be unsure why a track is grayed out. |
| **Screenshot ref** | Code: `TrackList.module.scss` `.unavailable` and `TrackList.js` — click is ignored silently                                                                                                   |
| **Severity**       | **Medium**                                                                                                                                                                                    |
| **Suggested fix**  | Show a tooltip on hover/tap: "No YouTube match found for this track" or display a toast notification on click.                                                                                |

### 8.4 Search bar is entirely non-functional

|                    |                                                                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description**    | The search bar in the navbar is a plain `<input>` with no `onChange` handler, no debounced search, and no backend search API. It is a visual placeholder only. |
| **Screenshot ref** | Code: `Navbar.js` — search input has no event handler                                                                                                          |
| **Severity**       | **Medium**                                                                                                                                                     |
| **Suggested fix**  | Either implement search functionality or remove/disable the search bar to avoid misleading users.                                                              |

### 8.5 No loading states for playlist grid

|                    |                                                                                                                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description**    | When playlists are being fetched from the API, there is no skeleton loader or spinner in the `PlaylistGrid` component. The grid either shows playlists or "No playlists yet" — there's no intermediate loading state. |
| **Screenshot ref** | Code: `PlaylistGrid.js` — no loading prop                                                                                                                                                                             |
| **Severity**       | **Medium**                                                                                                                                                                                                            |
| **Suggested fix**  | Add skeleton card placeholders during the loading phase.                                                                                                                                                              |

### 8.6 Sidebar playlist items have no "View" action — only a click handler

|                    |                                                                                                                                                                                                                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Description**    | Sidebar playlist items call `onPlaylistClick` which loads the playlist inline on the home page. But there is no visual response (no navigation, no scroll-to-section). If the user is on a different page (e.g., if routes were added), clicking a sidebar playlist would do nothing visible. |
| **Screenshot ref** | Code: `Sidebar.js` — playlist button with `onClick`                                                                                                                                                                                                                                           |
| **Severity**       | **Low**                                                                                                                                                                                                                                                                                       |
| **Suggested fix**  | Combine `onPlaylistClick` with `router.push('/')` to ensure the user is on the home page when a playlist is loaded.                                                                                                                                                                           |

---

## 9. Prioritized Improvement Plan

### Phase 1 — Critical (High severity, blocking issues)

| #   | Task                                                                                                                                                                                                      | Related issues         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1   | **Implement responsive sidebar collapse** — Add a hamburger menu toggle at ≤ 768 px, hide sidebar off-canvas, add backdrop overlay. Update `.navbar` and `.body` to use `left: 0` when sidebar is hidden. | §1.1, §1.2, §6.1, §6.2 |
| 2   | **Fix broken sidebar anchor links** — Add `id="playlists"` and `id="import"` to the corresponding sections on the home page, or convert them to actual routes.                                            | §2.4                   |
| 3   | **Add proper playlist URL routing** — Create `pages/playlist/[id].js` or use shallow routing so playlist views have unique, shareable URLs.                                                               | §3.1                   |
| 4   | **Add `env(safe-area-inset-bottom)` to player** — Prevent the player from being hidden behind mobile browser chrome.                                                                                      | §4.1                   |
| 5   | **Show sample content for guest users** — Display featured or sample playlists on the guest home page to reduce sign-up friction.                                                                         | §8.1                   |

### Phase 2 — Important (Medium severity, UX improvements)

| #   | Task                                                                                                                                        | Related issues |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 6   | **Add a max-width container** for main content to prevent overly wide lines on large screens.                                               | §1.4           |
| 7   | **Standardize button styles** — Create shared primary, secondary, and danger button mixins. Fix auth button text color from black to white. | §7.1           |
| 8   | **Implement active-state highlighting** for Playlists and Import sidebar items.                                                             | §2.5           |
| 9   | **Reduce CTA heading size on mobile** using `clamp()` or media queries.                                                                     | §6.3           |
| 10  | **Disable or hide the search bar** until search functionality is implemented.                                                               | §2.3, §8.4     |
| 11  | **Add client-side Spotify URL validation** to the import form.                                                                              | §5.2           |
| 12  | **Add a Cancel button** to the import flow during PROCESSING/MATCHING phases.                                                               | §5.3           |
| 13  | **Add "No match" tooltip/toast** for unavailable tracks.                                                                                    | §8.3           |
| 14  | **Add skeleton loading states** for the playlist grid.                                                                                      | §8.5           |
| 15  | **Show progress scrubber on touch devices** by default.                                                                                     | §4.4           |
| 16  | **Add a back/close button** to the inline playlist view.                                                                                    | §3.3           |
| 17  | **Improve playlist name wrapping** on tablet with multi-line clamp.                                                                         | §3.2           |
| 18  | **Add a mobile volume control alternative** (icon + vertical slider).                                                                       | §4.2           |

### Phase 3 — Polish (Low severity, fit & finish)

| #   | Task                                                                                           | Related issues |
| --- | ---------------------------------------------------------------------------------------------- | -------------- |
| 19  | **Establish a design token system** for z-index, type scale, and spacing in `_variables.scss`. | §1.5, §7.4     |
| 20  | **Unify badge styles** into a shared mixin.                                                    | §7.3           |
| 21  | **Standardize border-radius** across card components.                                          | §7.2           |
| 22  | **Replace auto-navigate** after import success with a "View Playlist" button.                  | §5.4           |
| 23  | **Add shuffle/repeat controls** to the player.                                                 | §4.5           |
| 24  | **Reduce CTA redundancy** — remove duplicate "Log in" from guest hero.                         | §2.2           |
| 25  | **Use `padding-bottom` with CSS variable** for player height compensation.                     | §1.3           |
| 26  | **Move viewport meta** to `_document.js` for global coverage.                                  | §6.5           |
| 27  | **Consolidate sidebar `onPlaylistClick`** with `router.push('/')`.                             | §8.6           |

### Spacing System Improvements

Currently, spacing values (padding, margin, gap) are hard-coded throughout all SCSS modules (`4px`, `6px`, `8px`, `10px`, `12px`, `14px`, `16px`, `20px`, `24px`, `28px`, `32px`, `40px`). Recommended approach:

- Define a spacing scale in `_variables.scss`: `$space-1: 4px; $space-2: 8px; $space-3: 12px; $space-4: 16px; $space-5: 20px; $space-6: 24px; $space-8: 32px; $space-10: 40px;`
- Replace all hard-coded values with token references
- This ensures global spacing consistency and easier future adjustments

### Interaction Improvements

1. **Hover/focus states:** Most interactive elements have hover states but many lack visible `:focus-visible` styles for keyboard navigation accessibility.
2. **Touch targets:** Some buttons (control buttons at 36 px) are below the recommended 44 px minimum touch target for mobile.
3. **Transitions:** Good use of `$transition-fast` and `$transition-normal` throughout. Consider adding `prefers-reduced-motion` media query to respect user preferences.
4. **Keyboard navigation:** The track list items use `<li onClick>` without `tabindex` or `role="button"`, making them inaccessible to keyboard-only users.

---

_End of audit. No code was modified during this review._
