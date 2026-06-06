# vibeslogger — Project Specification

**Status:** active development  
**Stack:** Vite + React 18 + TypeScript · Supabase (Postgres + Auth) · Vercel  
**Repo:** `github.com/kaiser-factorial/vibeslogger` (auto-deploys `master` → Vercel)

---

## 1. Concept

Vibeslogger is a mood-tracking web app grounded in the **Russell Circumplex Model of Affect** — a 2D psychological model that maps emotional states along two continuous axes:

- **Valence** (x-axis, 1–10): unpleasant → pleasant
- **Arousal** (y-axis, 1–10): low energy → high energy

Rather than asking users to name an emotion, the app asks them to click a point on a grid. That coordinate maps automatically to one of seven named **zones** with deliberately irreverent labels (see §4). The tone is self-aware internet culture, not clinical wellness.

The app started as a personal logging tool and is expanding toward a lightweight social platform where users can see each other's public mood posts, follow each other, and discover people with similar emotional patterns.

---

## 2. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Vite + React 18 (SPA) | No SSR; TypeScript strict mode throughout |
| Styling | Vanilla CSS (index.css) | IBM Plex Mono throughout; no CSS-in-JS |
| Backend / DB | Supabase (Postgres) | RLS enforces all data isolation |
| Auth | Supabase Auth | Magic link + email/password |
| Hosting | Vercel | GitHub integration, auto-deploy on push to `master` |
| Fonts | IBM Plex Mono via Google Fonts | Loaded in `index.html` |
| Testing | Vitest + jsdom + @testing-library/react | 34 tests across logic, hooks, and components |

**Environment variables** (set in Vercel + `.env.local` for local dev):
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=    ← anon/public key only, never service role
```

**TypeScript note:** The project uses TypeScript 6. Due to a TS6 + supabase-js v2 incompatibility, `createClient` is called without the `Database` generic. Table row types are asserted explicitly in hooks instead (e.g. `as { data: Vibe[] | null }`). This gives equivalent type safety without relying on the library generic.

---

## 3. Database Schema

### `vibes`
The core table. One row per mood entry.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `user_id` | uuid | FK → `auth.users.id` |
| `valence` | float | 1.0–10.0 |
| `arousal` | float | 1.0–10.0 |
| `note` | text \| null | free-text annotation |
| `public` | boolean | default `true` — appears in global timeline |
| `note_public` | boolean | default `false` — note shown publicly if both `public` and `note_public` are true |
| `created_at` | timestamptz | set by Supabase |

**RLS policies on `vibes`:**
- `SELECT`: own vibes always readable (`auth.uid() = user_id`) OR `public = true` from any user
- `INSERT`: `auth.uid() = user_id`
- `UPDATE`: own vibes only, and only within 3 hours of creation (`created_at > now() - interval '3 hours'`)
- `DELETE`: same 3-hour window

### `profiles`
Display name store, one row per auth user.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | `= auth.users.id` |
| `username` | text | auto-populated as email prefix (before `@`) on signup via trigger |

**RLS on `profiles`:** SELECT by any authenticated user; UPDATE own row only.

A Postgres trigger (`on_auth_user_created`) populates `profiles` automatically on each new signup. Existing users were backfilled with `split_part(email, '@', 1)`.

### `follows`
Tracks follow relationships between users.

| Column | Type | Notes |
|---|---|---|
| `follower_id` | uuid (PK, FK) | FK → `auth.users.id` |
| `followee_id` | uuid (PK, FK) | FK → `auth.users.id` |
| `created_at` | timestamptz | set by Supabase |

Primary key is `(follower_id, followee_id)` — prevents duplicate follows.

**RLS on `follows`:**
- `SELECT`: own rows only (`auth.uid() = follower_id`)
- `INSERT`: own rows only
- `DELETE`: own rows only

---

## 4. Zone System

Zones are the core classification concept. Every (valence, arousal) coordinate maps to exactly one zone.

### Zone Map

| ID | Label | Color | Location on grid |
|---|---|---|---|
| `lfg` | LETS FUCKING GOOOO | `#c5b800` | Top-right corner (v≥8.0, a≥8.4) |
| `back` | we are so fucking back | `#4a7a1e` | Top-right quadrant (olive) |
| `ball` | fuck it we ball | `#8a2020` | Top-left quadrant (red) |
| `over` | it's so over | `#407A96` | Bottom-left (light blue) |
| `vibing` | we vibing | `#4896A8` | Bottom-right (sage) |
| `whatitis` | it is what it is | `#916018` | Center-left band + narrow column (orange, upside-down T) |
| `mwbs` | log off forever | `#484898` | Bottom-left corner (v≤2.4, a≤2.2) |

### Classification Logic (`src/lib/zones.ts`)

Split points derived from an SVG mockup (615×615px grid):
- Valence splits: **4.8** (42%), **6.1** (57%), **8.0** (78%)
- Arousal splits: **4.5** (61% from top), **6.1** (43% from top), **8.4** (18% from top)

```
getZone(valence, arousal):
  if v≥8.0 && a≥8.4   → lfg
  if v≤2.4 && a≤2.2   → mwbs
  if a>6.1             → (v<4.8 ? ball : back)
  if a≥4.5             → (v<6.1 ? whatitis : back)
  if v<4.8             → over
  if v<6.1             → whatitis   // orange column (bottom center)
  else                 → vibing
```

The "it is what it is" zone is intentionally unusual: it forms an upside-down T shape, with a wide horizontal band across the middle and a narrow column dropping through the center. This requires two rectangles in the visual layer and two code paths in `getZone`.

### Dot Color Encoding (`src/lib/vibeColor.ts`)

Each logged vibe is rendered as a colored dot. Color encodes both dimensions:
- **Hue** = valence (0° = red/unpleasant → 120° = green/pleasant)
- **Saturation** = arousal (35% at low energy → 90% at high)
- **Lightness** = arousal (28% at low energy → 50% at high)

Low-arousal states get dark, muted colors; high-arousal states get bright, vivid ones.

`vibeColor` still drives the **Timeline** dots and the **share cards**. The **mood grid points** (in explore mode) and the **"recorded moods" table dots** instead use `gridColor(valence, arousal)` from `lib/zones.ts`, which returns the bright vibe-square color of the zone the point sits in (`GRID_ZONE_COLOR`). This makes a logged mood's dot match the square it lives in and match across the grid and table. (Three palettes coexist by design: muted `ZONE_META` for accents/labels, bright `GRID_ZONE_COLOR` for the square/points/table dots, and the `vibeColor` HSL gradient for timeline/share.)

---

## 5. Feature Inventory (current)

### Mood Grid (`src/components/MoodGrid.tsx`)
- Full-viewport clickable grid; click places a pending dot
- SVG overlay renders all logged dots with vibe color encoding
- Zone backgrounds rendered as absolute-positioned divs (using `left/top/right/bottom` %)
- **Labels toggle**: shows/hides zone text labels (black, centered per zone)
- **Emotion wheel toggle**: overlays Russell Circumplex affect labels (e.g. "tense", "serene", "excited") as ghosted text at their canonical circumplex positions
- **Explore mode toggle**: makes the grid read-only (no click-to-log); dots show a timestamp tooltip on hover. Useful for reviewing past entries without accidentally logging. On enter, the background zones dim/desaturate and each point's glyph animates (via `currentColor` + a CSS `color` transition) from white to its zone's `gridColor`; a stronger drop-shadow keeps it legible against the same-hue square. The hover tooltip picks up the same zone color on its left accent bar, coordinate text, and sun/moon glyph (all `currentColor`, inherited from the point).
- **Time-of-day glyphs**: each dot renders a small sun (logged 6:00–17:59) or crescent moon (18:00–5:59) SVG overlay, indicating time of day at logging. Moon uses an SVG mask (circle minus offset circle) for a proper crescent curve; each instance gets a unique mask ID via `useRef` to prevent DOM conflicts.
- **Background**: body has two tiled linear-gradient layers (135° and 45°) at 0.11–0.13 opacity sampling the zone color palette, giving the page a subtle mood-map texture.
- Responsive: scales font sizes at `<768px` via `labelScale = isMobile ? 0.58 : 1`

### Log Modal (`src/components/MoodModal.tsx`)
- Opens on grid click; shows coordinate, optional note textarea
- Word count hint if 1–2 words (notes <3 words are excluded from word analysis)
- **Privacy toggles:**
  - "post to timeline" (default: on) → sets `public` column
  - "include note publicly" (shown only when public + note present) → sets `note_public`
- Enter submits; Escape closes
- **Theme preview**: the modal previews the accent this click is about to apply (see Dynamic Vibe Accent). The backdrop gets a faint radial wash of the clicked zone's color and the submit ("log it") button is the full zone color, while the modal's own controls stay neutral cream/charcoal. Implemented by setting CSS vars inline on the backdrop: `--accent*` are overridden to the neutral palette (`paletteFor(null)`) and `--preview-*` carry the zone palette, which only `.btn-primary--preview` consumes.

### Mood Table (`src/components/MoodTable.tsx`)
- Lists all entries for the logged-in user, newest first; each row's `.vibe-dot` uses `gridColor` so it matches the point's color on the grid
- **3-hour edit window**: edit + delete buttons visible for `created_at` within 3 hours; locked indicator (`·`) after that
- Inline note editing: click edit → input replaces note cell → Enter saves, Escape cancels
- **Undo delete**: clicking × immediately hides the row and shows a sticky toast ("entry deleted · undo (Xs)") with a 5-second live countdown. The actual Supabase `DELETE` fires only when the timer expires. Clicking undo cancels the timer and restores the row. Multiple simultaneous pending deletes are supported.
- **Share button** (`↗`): visible on public entries regardless of edit lock. Opens `ShareModal`.
- 3-hour lock enforced client-side (UI hides buttons) and server-side (RLS policies)

### Analysis Panel (`src/components/Analysis.tsx`)
- **Locked until 10 entries** (total, not date-filtered) — progress bar shown
- **Date filter**: from/to inputs filter all sections below
- **Export CSV/JSON**: "↓ csv" and "↓ json" buttons — download the current filtered slice. Disabled when filtered set is empty. CSV headers: date, time, valence, arousal, zone, note. JSON includes all Vibe fields plus computed zone.
- **Stats strip**: entry count, avg valence, avg arousal, note count (≥3 words), current streak, best streak. Streak is computed from all-time data (ignores the date filter).
- **Trend line**: daily-average valence and arousal sparklines with dashed least-squares regression overlays and ↑↓→ direction arrows. Appears when ≥2 calendar days of data exist in the filtered window.
- **Time-of-day analysis**: 4-slot grid (morning 6–11, afternoon 12–16, evening 17–20, night 21–5) showing entry count and avg valence/arousal per slot. Each slot's border is tinted by the dominant zone color.
- **Heatmap**: 10×10 grid colored by entry density
- **Zone breakdown**: horizontal bar chart sorted by frequency
- **Word analysis**: top 5 words per zone, stop-words filtered, only notes with ≥3 words counted

### Timeline (`src/components/Timeline.tsx`)
- Feed of all `public = true` entries from all users
- Each entry: colored dot, zone label (in zone color), `@username`, time-ago, optional note (if `note_public = true`)
- Own entries highlighted subtly
- **Feed filter**: toggle between "everyone" (all public vibes) and "following (N)" (own entries + followed users' entries)
- **Cursor-based pagination**: loads 20 entries at a time using `.lt('created_at', cursor)`. A "load more" button appears at the bottom of the everyone feed when more entries exist. Profile lookups are batched per page (only new user IDs fetched, accumulated across pages via `useRef`).
- **Similar vibers**: computes 7-dimensional zone distribution vector per user; ranks all other users by Euclidean distance; shows top 5 with a % match score and a follow/unfollow button per row. Requires ≥5 public entries from current user and ≥3 from candidates to appear.

### Dynamic Vibe Accent (`src/lib/accent.ts` + `src/hooks/useAccent.ts`)
- The site's accent color (buttons, focus rings, active tabs, glows, own-entry tints) is dynamic. Before any vibe is logged this session — including the auth screen — it is a neutral **cream/charcoal** scheme.
- When a vibe is logged, `App.handleModalSubmit` calls `setAccentFromVibe(valence, arousal)`, which maps the click to a zone via `getZone()` and repaints the accent in that zone's color (e.g. logging in the yellow "LFG" area → yellow accents).
- The accent is driven by CSS custom properties on `:root` (`--accent`, `--accent-hover`, `--accent-ink`, `--accent-rgb`, `--accent-glow`); `applyAccent()` sets them all at once. `--accent-ink` (button text) is chosen per zone by perceptual luminance so light accents like yellow get dark text.
- **Persistence:** the chosen zone is stored in `sessionStorage` (`vl-accent-zone`), so it survives reloads within the browser session but resets to cream on sign-out or when a different user signs in. `--danger` (red) is intentionally left fixed for destructive actions (delete, unfollow).
- **Neutral chrome:** all non-accent UI chrome (surfaces, borders, input/hover backgrounds, tooltips) uses neutral charcoal grays rather than the previous blue/purple-tinted darks, so the dynamic accent and the rainbow background carry the color. Exceptions that stay colored on purpose: the seven zone squares in `MoodGrid`, the background gradient, and the valence/arousal trend-line series in `Analysis` (two distinct data colors).
- **Palette tokens:** the neutral charcoal→off-white scale lives as named CSS variables in `index.css` `:root` (`--surface-*`, `--track`, `--hairline`, `--elevate`, `--border-*`, `--fg-*`), ordered dark→light, so the whole theme is retunable from one place. The two trend-line colors are `--chart-valence` / `--chart-arousal`; because SVG presentation attributes can't read `var()`, the chart applies them via classes (`.trend-stroke-v/a`, `.trend-fill-v/a`, `.trend-grid`) and the text spans via inline `style`.

### Auth (`src/components/Auth.tsx`)
- Two tabs: magic link (OTP email) and email/password
- Sign-up/sign-in toggle in password mode
- `emailRedirectTo: window.location.origin`

### Set Password Modal (`src/components/SetPasswordModal.tsx`)
- Accessible from header; allows users who signed in via magic link to set a password
- Uses `supabase.auth.updateUser({ password })`

### Shareable Vibe Card (`src/components/ShareModal.tsx` + `src/components/PublicShareView.tsx`)
- `ShareModal`: opened from the `↗` button in MoodTable. Previews the vibe as a styled card. "Copy link" encodes vibe data (zone, valence, arousal, timestamp, note if `note_public`) as base64 JSON in `?share=<token>` — no server required, no auth required to view.
- `PublicShareView`: rendered by `App.tsx` when `?share=` is detected in the URL (checked before auth). Decodes the token and renders the share card. Falls back to an error message for malformed tokens. Includes a CTA link back to the app.

### Username Editing (`src/components/EditUsernameModal.tsx` + `src/hooks/useProfile.ts`)
- Header shows `@username` as a clickable button (only when username is loaded)
- Clicking opens `EditUsernameModal`: text input pre-filled with current username, validates non-empty / max 30 chars / alphanumeric+underscore only
- `useProfile` hook fetches username from `profiles` on mount and exposes `updateUsername` which writes to Supabase and updates local state
- Username defaults to email prefix (set by signup trigger); modal allows changing it to any valid handle

### PWA
- `public/manifest.json` + `public/icon.svg` in place
- Apple meta tags in `index.html`
- **No service worker yet** — "add to home screen" works but app is not offline-capable

---

## 6. Key Architectural Decisions

### RLS as the source of truth
All data isolation is enforced at the Postgres RLS layer, not in application code. The frontend uses the anon key only — no service role key is ever exposed. Client-side checks (e.g. hiding edit buttons after 3 hours) are UX, not security.

### Optimistic updates
`useVibes` applies mutations locally before the Supabase round-trip completes. On error the optimistic update is not rolled back (known gap — low stakes for a personal tool). `useFollows` does roll back optimistic follow/unfollow on error.

### Timeline data fetching strategy
Timeline uses two sequential queries (vibes → profiles for unique user IDs) joined in JS, rather than a PostgREST relationship join. This sidesteps the FK chain (`vibes.user_id → auth.users → profiles`) which PostgREST can't traverse automatically without explicit FK declarations.

### Zone layout
Zone rectangles use `left/top/right/bottom` CSS positioning (not `left/top/width/height`). This avoids subpixel rounding gaps between zones. The orange "whatitis" zone requires two overlapping `z-index: 2` rectangles.

### 3-hour mutation window
`LOCK_AFTER_MS = 3 * 60 * 60 * 1000` in `MoodTable.tsx` matches the RLS policy `created_at > now() - interval '3 hours'`. If this value changes it must be updated in both places.

### Undo delete architecture
All undo logic lives in `MoodTable` — no changes to `useVibes`. A `pendingDeletes: Map<string, PendingDelete>` tracks hidden rows and their timer IDs. `displayedVibes = vibes.filter(v => !pendingDeletes.has(v.id))` drives rendering. The actual `onDelete` callback fires only when the 5-second `setTimeout` expires.

---

## 7. File Structure

```
src/
  components/
    Auth.tsx              magic link + password auth UI
    Analysis.tsx          full analysis panel (filter, export, trend, tod, heatmap, etc.)
    EditUsernameModal.tsx username edit modal (validation + Supabase write)
    MoodGrid.tsx          the clickable 2D grid with zones/dots/overlays
    MoodModal.tsx         post-click entry modal (note + privacy toggles)
    MoodTable.tsx         entries list with inline edit, undo delete, share, 3hr lock
    PublicShareView.tsx   auth-free card view for ?share= URLs
    SetPasswordModal.tsx  upgrade magic-link account to password auth
    ShareModal.tsx        share modal — card preview + copy-link button
    Timeline.tsx          global feed, following filter, similar vibers + follow buttons
  hooks/
    useVibes.ts           CRUD for current user's entries (optimistic)
    useTimeline.ts        fetches public entries + profiles; cursor-based pagination
    useFollows.ts         follow/unfollow state with optimistic updates + error revert
    useProfile.ts         fetch + update username from profiles table
    useAccent.ts          dynamic UI accent: cream default → most-recent-vibe zone color
  lib/
    accent.ts             accent palette computation + apply to :root CSS vars
    database.types.ts     Supabase schema types (vibes, profiles, follows)
    supabase.ts           Supabase client init (plain, non-generic — see §2)
    vibeColor.ts          HSL color encoding from (valence, arousal)
    wordAnalysis.ts       stop-word filtering + top-N word frequency
    zones.ts              ZoneId type, ZONE_META, ZONE_ORDER, getZone()
  test/
    setup.ts              vitest + @testing-library/jest-dom setup
    analysis.test.ts      exportCSV, buildTimeSeries, regressionSlope, slopeArrow
    undoDelete.test.tsx   MoodTable undo delete behavior (8 scenarios)
    follows.test.ts       useFollows hook: load, follow, unfollow, error revert
  types.ts                shared domain types (Vibe, TimelineEntry, PendingVibe)
  App.tsx                 root: auth gate, nav tabs, layout state
  index.css               all styles (single file, no CSS modules)
  main.tsx                Vite entry point
  vite-env.d.ts           /// <reference types="vite/client" />

public/
  manifest.json           PWA manifest
  icon.svg                app icon
  sw.js                   service worker (cache-first assets, pass-through Supabase)

index.html                PWA meta tags + Google Fonts link
vite.config.js            base: '/', vitest config (jsdom environment)
tsconfig.json             strict mode, bundler moduleResolution, react-jsx
CLAUDE_IDEAS.md           ideas log (implemented + proposed)
SPEC.md                   this file
```

---

## 8. Roadmap

Items are loosely ordered by effort/value. Nothing here is committed — all are open for discussion.

### Completed

- ✓ **Friends / following system** — `follows` table + RLS, `useFollows` hook, follow buttons in similar vibers, following feed filter
- ✓ **Export CSV** — filter-aware download button in analysis panel
- ✓ **Undo delete** — 5-second undo toast replacing two-click confirm
- ✓ **Trend line** — daily avg valence/arousal sparklines + regression overlays in analysis panel
- ✓ **Timeline pagination** — cursor-based, 20 entries/page, "load more" button
- ✓ **Username editing** — clickable `@handle` in header opens edit modal
- ✓ **Time-of-day glyphs** — sun/moon overlay on each dot based on logging hour
- ✓ **Vibrant background** — tiled zone-color gradient layers behind the whole app
- ✓ **Streak tracking** — current and all-time best streak shown in analysis stats strip (all-time, not date-filtered)
- ✓ **Time-of-day analysis** — analysis section bucketing entries by morning/afternoon/evening/night with count and avg v/a per slot
- ✓ **JSON export** — `↓ json` button alongside CSV; exports filtered slice with all fields including zone
- ✓ **Shareable vibe card** — `↗` on public entries opens share modal; "copy link" produces a `?share=<token>` URL with base64-encoded vibe data. `PublicShareView` renders the card without auth for any share URL.
- ✓ **Dynamic vibe accent** — UI accent defaults to cream/charcoal and recolors to the most recently logged vibe's zone color; session-scoped (resets to cream on sign-out). See `src/lib/accent.ts`.
- ✓ **PWA service worker** — `public/sw.js`: cache-first for `/assets/` (Vite content-hashed bundles), network-first for navigation, pass-through for Supabase. Registered in `main.tsx`.

### Longer-term / speculative

**Weekly digest email**  
Supabase Edge Function + email provider (Resend or Postmark). Sends a weekly summary: avg mood, top zone, top words. Significant scope expansion toward a service.

**Anonymous aggregate heatmap (opt-in)**  
An opt-in toggle that shows a blurred heatmap of all users' activity for today. "Are other people also having a bad week?" Significant privacy surface area — opt-in is essential.

**Custom zone labels**  
Per-user rename of the seven zone labels, stored in a `zone_labels` column on `profiles`. The existing names are central to the app's personality, so this would probably be a power-user feature.

**Mutual follows / follow-back indicator**  
Show a "follows you back" badge next to usernames in similar vibers. Requires a second query or join on the `follows` table.

---

## 9. Known Gaps & Gotchas

- **Optimistic updates in `useVibes` don't roll back** on error (see §6). `useFollows` does roll back correctly.
- **`labelScale` on mobile** scales all label font sizes by 0.58. If label sizes are adjusted, verify at mobile widths.
- **The 3-hour lock constant exists in two places**: `MoodTable.tsx` (client) and the Supabase RLS policy (server). They must stay in sync.
- **No error boundary.** An uncaught render error will crash the whole app.
- **Similar vibers uses all-time data.** The zone distribution vectors are computed from a user's full public history, not a recent window. Could be noisy for users whose mood patterns have shifted.
- **Timeline pagination only applies to the "everyone" feed.** The "following" filter is applied client-side over already-loaded entries, so it only covers the pages fetched so far.
- **Share links encode vibe data client-side** — they are not validated against the DB when viewed. A share link for a private-later-made vibe will still show the original data.
- **PWA is not offline-capable for data.** Static assets are cached; Supabase API calls are always network-only. The app requires connectivity to log or fetch vibes.
- **`package-lock.json` is out of sync with `package.json`.** The committed lockfile is missing entries (e.g. several `esbuild` platform packages), so `npm ci` fails with `EUSAGE` ("can only install packages when your package.json and package-lock.json ... are in sync"). Use `npm install` instead, which reconciles the difference. For this reason the CI workflow (§10) runs `npm install`, not `npm ci`. The lockfile could be regenerated (`npm install` then commit the result) in a standalone cleanup if a reproducible `npm ci` is wanted.

---

## 10. Continuous Integration

`.github/workflows/ci.yml` runs on every pull request and on pushes to `master`:

1. Checkout (`actions/checkout@v4`)
2. Node 22 (`actions/setup-node@v4`)
3. `npm install` — **not `npm ci`**, because the committed lockfile is out of sync (see §9)
4. `npm run typecheck` (`tsc --noEmit`)
5. `npm test` (`vitest run` — the full suite)

A failing type check or test blocks the green check on the PR. This is separate from Vercel, which independently builds and deploys a preview on each push (the `Vercel` status check). No env vars are needed in CI: the only test that touches Supabase (`follows.test.ts`) mocks `../lib/supabase`, and the rest are pure logic or props-driven.
