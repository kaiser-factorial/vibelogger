# vibelogger — Project Specification

**Status:** active development  
**Stack:** Vite + React 18 + TypeScript · Supabase (Postgres + Auth) · Vercel  
**Repo:** `github.com/kaiser-factorial/vibelogger` (auto-deploys `master` → Vercel)

---

## 1. Concept

Vibelogger is a mood-tracking web app grounded in the **Russell Circumplex Model of Affect** — a 2D psychological model that maps emotional states along two continuous axes:

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
- `SELECT`: own rows only (`auth.uid() = follower_id`) **OR** any authenticated user (additive policy — see below)
- `INSERT`: own rows only
- `DELETE`: own rows only

> **Additive policy note:** `supabase_social_setup.sql` adds a second, permissive `SELECT` policy — `"follows are viewable by any authenticated user" ... using (true)` — alongside the original. Postgres RLS OR's permissive policies together, so this *opens* visibility (needed for follower/following counts, lists, and mutual-follow badges) without requiring the original policy to be dropped or renamed. This is the general pattern for adding visibility to an RLS table without knowing/risking existing policy names.

### `blocks`
Tracks block/mute relationships. Lets a user hide another user's content from their own view.

| Column | Type | Notes |
|---|---|---|
| `blocker_id` | uuid (PK, FK) | FK → `auth.users.id` |
| `blocked_id` | uuid (PK, FK) | FK → `auth.users.id` |
| `created_at` | timestamptz | set by Supabase |

Primary key is `(blocker_id, blocked_id)`.

**RLS on `blocks`:** `SELECT`/`INSERT`/`DELETE` — own rows only (`auth.uid() = blocker_id`). Nobody can see who has blocked them.

> **Resolved:** Blocking now also prevents the blocked user from following (or continuing to follow) the blocker — see `supabase_block_follow_fix.sql`: a *restrictive* `INSERT` policy on `follows` blocks new follow attempts from someone you've blocked (AND-combines with the existing permissive check, mirroring the additive-OR pattern used for the `follows` SELECT policy but for narrowing instead of widening), plus an `AFTER INSERT` trigger on `blocks` that retroactively deletes any existing reverse-follow at the moment of blocking.

Both the `blocks` table and the additive `follows` SELECT policy live in **`supabase_social_setup.sql`**, and the block/follow interaction fix lives in **`supabase_block_follow_fix.sql`** — run both once, in order, in the Supabase SQL editor before testing/using the social features (neither is applied via migration tooling).

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

The **mood grid points** (in explore mode), the **"recorded moods" table dots**, the **timeline dots**, and the **share cards** all use `gridColor(valence, arousal)` from `lib/zones.ts`, which returns the bright vibe-square color of the zone the point sits in (`GRID_ZONE_COLOR`). This makes a logged mood's dot match the square it lives in, consistently across every surface. (Two palettes coexist by design: muted `ZONE_META` for accents/labels, and bright `GRID_ZONE_COLOR` for grid points, table/timeline dots, and share card dots. `vibeColor` from `lib/vibeColor.ts` is retained in the codebase but no longer used in the display layer.)

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
- **Empty state**: when the user has zero entries, shows a large, prominent, fully-centered message (`.table-empty-state` — flexbox-centered both axes, fills the column height) reading "no logs yet / click on the grid to log a mood" — replacing a much smaller, low-contrast one-line note that was easy to miss for new accounts
- **3-hour edit window**: row action ellipsis (`•••`) button visible for `created_at` within 3 hours; locked indicator (`·`) after that
- Row actions open the `VibeActionModal` for both web and mobile, allowing editing the note, deleting the entry, or sharing it.
- **Undo delete**: clicking Delete in the action modal immediately hides the row and shows a sticky toast ("entry deleted · undo (Xs)") with a 5-second live countdown. The actual Supabase `DELETE` fires only when the timer expires. Clicking undo cancels the timer and restores the row. Multiple simultaneous pending deletes are supported.
- **Share action**: available in the action modal on public entries regardless of edit lock. Opens `ShareModal`.
- 3-hour lock enforced client-side (UI hides buttons) and server-side (RLS policies)

### Analysis Panel (`src/components/Analysis.tsx`)
- **Locked until 5 entries** (total, not date-filtered) — progress bar shown
- **Date filter**: from/to inputs filter all sections below
- **Export CSV/JSON**: "↓ csv" and "↓ json" buttons — download the current filtered slice. Disabled when filtered set is empty. CSV headers: date, time, valence, arousal, zone, note. JSON includes all Vibe fields plus computed zone.
- **Stats strip**: entry count, avg valence, avg arousal, note count (≥3 words), current streak, best streak. Both streak values come from the `get_streak_stats` Supabase RPC (see §7 / `useStreaks.ts`); computed all-time (ignores the date filter), using the browser's local timezone so day boundaries match the user's midnight.
- **Trend line**: daily-average valence and arousal sparklines with dashed least-squares regression overlays and ↑↓→ direction arrows. Appears when ≥2 calendar days of data exist in the filtered window.
- **Time-of-day analysis**: 4-slot grid (morning 6–11, afternoon 12–16, evening 17–20, night 21–5) showing entry count and avg valence/arousal per slot. Each slot's border is tinted by the dominant zone color.
- **Heatmap**: 10×10 grid colored by entry density
- **Zone breakdown**: horizontal bar chart sorted by frequency
- **Word analysis**: top 5 words per zone, stop-words filtered, only notes with ≥3 words counted

### Streak Badge (header)
Present in both the web app and the Android app. The `@username` pill and streak text are grouped in a `.user-block` flex column (right-aligned) in the top-right corner of the header — username on top, streak directly below it as plain right-aligned text with a text-shadow for legibility over the colorful background. Displays as `Nd streak`; when the all-time best is longer than the current run, appends ` · best: Nd`. Hidden when streak is 0. Refreshes on mount, after a successful vibe add, and after a delete (since deleting the only log for a day can break a streak). Both values (`current_streak`, `longest_streak`) are returned in one call to the `get_streak_stats` Supabase RPC (`src/hooks/useStreaks.ts`), which lives in both codebases.

### Timeline (`src/components/Timeline.tsx`)
- Feed of all `public = true` entries from all users
- Each entry: a `gridColor` dot (matching the grid/table), zone label (in `ZONE_META` color), a clickable `@username` (opens `UserProfileModal`), time-ago, optional note (if `note_public = true`). Entries render as translucent dark cards (with a shadow on the meta text) so `@username` · time-ago stay legible over the rainbow page background.
- Own entries highlighted subtly
- **Feed filter**: toggle between "everyone" (all public vibes) and "following (N)" (own entries + followed users' entries)
- **Date range filter**: `from`/`to` date inputs (reusing `Analysis.tsx`'s `filter-input`/`filter-label` pattern); a local `inDateRange` helper duplicates `Analysis`'s date-filter logic intentionally (avoids a premature shared abstraction for two small, independently-evolving filters)
- **Mood/zone filter**: a row of toggleable zone chips (`Set<ZoneId>`) housed in a collapsible "Filter Vibes" dropdown. Entries are shown only if their `getZone(valence, arousal)` is in the active set. Date and zone filters combine (AND) and stack with the everyone/following toggle. A "clear filters" button appears whenever any filter is active.
- **Blocked-user filtering**: entries from any `user_id` in `blockedIds` are filtered out of the feed entirely (`entries.filter(e => !blockedIds.has(e.user_id))`), applied before the everyone/following and date/zone filters
- **User search** (`UserSearchBox`, via `useUserSearch`): debounced (300ms) `ilike` search on `profiles.username`, limit 20, excludes the current user; shows an explicit "no users found" empty state; each result row has a clickable `@username` (opens profile) and a follow/unfollow button
- **Cursor-based pagination**: loads 20 entries at a time using `.lt('created_at', cursor)`. A "load more" button appears at the bottom of the everyone feed when more entries exist (and no date/zone filter is active — pagination is page-local, see §9). Profile lookups are batched per page (only new user IDs fetched, accumulated across pages via `useRef`).
- **Similar vibers**: a collapsible section that computes a 7-dimensional zone distribution vector per user; ranks all other users by Euclidean distance; shows top 5 with a % match score, a clickable `@username` (opens profile), and a follow/unfollow button per row. Requires ≥5 public entries from current user and ≥3 from candidates to appear.

### Profile Views (`src/components/UserProfileModal.tsx` + `src/hooks/useUserProfile.ts`)
- Opened by clicking any `@username` across the app (timeline cards, similar vibers, search results, settings lists)
- Shows: `@username`, a "follows you" badge when the relationship is mutual (and it isn't the viewer's own profile), follow/unfollow + block/unblock buttons, follower/following counts, and a feed of that user's public vibes (reusing the `tl-entry`/`tl-dot`/`tl-zone` timeline styling)
- `useUserProfile` runs 5 Supabase queries in parallel via `Promise.all`: profile lookup, public vibes (limit 50), follower count, following count, and a `.maybeSingle()` mutual-follow check. Requires the additive `follows` SELECT policy (see §3) — without it, counts/lists/badges for other users return empty.
- If the viewed user is blocked, a `.profile-blocked-note` is shown in place of their vibes feed
- `handleBlockToggle` unfollows before blocking (a user can't simultaneously follow and block someone)

### Account Settings Modal (`src/components/AccountSettingsModal.tsx` + `src/hooks/useSocialLists.ts`)
- Opened from the `@username` button in the header (replaces the previous scattered `btn-username`/`btn-setpw`/`btn-signout` header buttons — all account-related actions now live in one place)
- Tabbed: **account** (username display + edit trigger, email, password status + set-password trigger, sign-out), **following**, **followers**, **blocked**
- The following/followers tabs use `useSocialLists` (two `follows` queries + a batched `profiles` lookup, mirroring `useTimeline`'s join-in-JS strategy — also requires the additive `follows` policy); the blocked tab does a local `profiles` lookup for IDs in `blockedIds`
- Each row (`PersonRow`) shows a clickable `@username` (opens profile, closing settings first) and a context-appropriate action button (unfollow / unblock)
- `onOpenEditUsername`/`onOpenSetPassword` close the settings modal before opening `EditUsernameModal`/`SetPasswordModal` (modals don't stack)

### Block / Mute (`src/hooks/useBlocks.ts`)
- Mirrors `useFollows` exactly: `blockedIds: Set<string>`, optimistic `block`/`unblock` with error rollback, queries the `blocks` table filtered by `blocker_id = session.user.id`
- Hides the blocked user's entries from the timeline and (via `UserProfileModal`) their profile's vibe feed
- Blocking also severs/prevents the reverse follow relationship at the DB level — see §3 and `supabase_block_follow_fix.sql`

### Onboarding Hint (`App.tsx`)
- A modal (`.hint-modal-backdrop`/`.hint-modal`, cream `var(--accent)` background with dark text) explains how to use the grid: "click anywhere on the grid to log your vibe" + an explanation of the valence (left↔right) and arousal (bottom↔top) axes, mirroring the grid's own `← unpleasant · pleasant →` / `↓ low energy · high energy ↑` axis labels
- Shown whenever the user is on the `log` view with zero logged vibes; dismissing it ("got it" or clicking the backdrop) hides it for the current visit only — navigating away and back to `log` re-shows it (`useEffect` resets `hintDismissed` on `view === 'log'`), so it keeps nudging brand-new users until they log their first vibe, after which the `vibes.length === 0` guard retires it permanently for that account
- Renders as a true modal (`position: fixed`, `z-index: 100`) rather than an inline overlay — this was a deliberate pivot away from an earlier absolutely-positioned-over-the-header approach, which ran into CSS stacking-context conflicts with the grid's own positioned/z-indexed elements (`.vibe-point`, `.vibe-tip`, etc. at z-index 10–40)

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
- Password sign-up sets `user_metadata.has_password = true`; password sign-in backfills that flag if missing (so pre-existing password accounts get it on next login). This drives whether the header shows "set password" (see below).

### Set Password Modal (`src/components/SetPasswordModal.tsx`)
- Accessible from the header; allows users who signed in via magic link to set a password. The header button is hidden once `user_metadata.has_password` is set (so it disappears after the initial password is set, and never shows for password-signup users).
- Uses `supabase.auth.updateUser({ password, data: { has_password: true } })`

### Shareable Vibe Card (`src/components/ShareModal.tsx` + `src/components/PublicShareView.tsx`)
- `ShareModal`: opened from the `↗` button in MoodTable. Previews the vibe as a styled card. "Copy link" encodes vibe data (zone, valence, arousal, timestamp, note if `note_public`) as base64 JSON in `?share=<token>` — no server required, no auth required to view.
- `PublicShareView`: rendered by `App.tsx` when `?share=` is detected in the URL (checked before auth). Decodes the token; if the payload includes a vibe `id` (present on all links generated after 2026-06-07), re-fetches the live vibe from Supabase (anon-readable under the existing `public = true` RLS policy) to confirm it still exists and is still public — shows "this vibe is no longer shared" if not. Falls back to rendering from the encoded snapshot for older links without an `id`. Includes a CTA link back to the app.

### Username Editing (`src/components/EditUsernameModal.tsx` + `src/hooks/useProfile.ts`)
- Header shows `@username` as a clickable button (only when username is loaded); clicking it now opens **`AccountSettingsModal`** (see above) rather than `EditUsernameModal` directly — the settings modal's account tab triggers `EditUsernameModal` from there
- `EditUsernameModal` itself is unchanged: text input pre-filled with current username, validates non-empty / max 30 chars / alphanumeric+underscore only
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
`useVibes` is *not* actually optimistic — `addVibe`/`updateVibe`/`deleteVibe` only call `setVibes` inside the `if (!error && data)` branch, after the Supabase round-trip resolves, so local state always reflects server truth and there's nothing to roll back. The previously-documented "doesn't roll back" gap was really that *failures were silent* — `MoodModal`/`MoodTable` ignored the returned `{ error }` and gave no feedback, so a failed mutation just looked like nothing happened. Fixed (2026-06-07): both now surface failures to the user (inline error in the modal, dismissing toast in the table) — see §9. `useFollows` and `useBlocks`, by contrast, genuinely are optimistic (`Set<string>` updated immediately, rolled back on error) — `useBlocks` was written as a near-exact mirror of `useFollows`, so when one needs a fix, check whether the other does too.

### Additive RLS policies for incremental visibility
Postgres RLS OR's permissive policies of the same type together. `supabase_social_setup.sql` exploits this to widen `follows` SELECT visibility (originally "own rows only") to "any authenticated user" via a *second*, separately-named policy — without needing to know or drop the original policy's name. This is the preferred pattern whenever a new feature needs broader read access to an existing RLS-protected table: add a policy, don't risk replacing one.

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
    AccountSettingsModal.tsx tabbed account/following/followers/blocked modal (replaces header buttons)
    Auth.tsx              magic link + password auth UI
    Analysis.tsx          full analysis panel (filter, export, trend, tod, heatmap, etc.)
    EditUsernameModal.tsx username edit modal (validation + Supabase write)
    ErrorBoundary.tsx     app-level crash screen ("something broke / reload"); wraps <App /> in main.tsx
    MoodGrid.tsx          the clickable 2D grid with zones/dots/overlays
    MoodModal.tsx         post-click entry modal (note + privacy toggles)
    MoodTable.tsx         entries list with inline edit, undo delete, share, 3hr lock, empty state
    PublicShareView.tsx   auth-free card view for ?share= URLs; re-validates vibe against DB
    SetPasswordModal.tsx  upgrade magic-link account to password auth
    ShareModal.tsx        share modal — card preview + copy-link button; embeds vibe id in payload
    Timeline.tsx          global feed, search, date/zone filters, similar vibers, profile links
    UserProfileModal.tsx  per-user profile view: stats, follow/block, public vibes feed
  hooks/
    useVibes.ts           CRUD for current user's entries (optimistic)
    useTimeline.ts        fetches public entries + profiles; cursor-based pagination
    useFollows.ts         follow/unfollow state with optimistic updates + error revert
    useBlocks.ts          block/unblock state, mirrors useFollows (optimistic + revert)
    useProfile.ts         fetch + update username from profiles table
    useStreaks.ts         current + longest streak via get_streak_stats RPC; refreshes on add/delete
    useUserSearch.ts      debounced username search (ilike on profiles)
    useUserProfile.ts     per-user profile data: vibes, follower/following counts, mutual badge
    useSocialLists.ts     current user's followers + following as Profile[] lists
    useAccent.ts          dynamic UI accent: cream default → most-recent-vibe zone color
  lib/
    accent.ts             accent palette computation + apply to :root CSS vars
    database.types.ts     Supabase schema types (vibes, profiles, follows, blocks)
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
supabase_social_setup.sql one-time SQL: blocks table/RLS + additive follows SELECT policy (run manually in SQL editor — see §3)
supabase_block_follow_fix.sql one-time SQL: restrictive follows INSERT policy + trigger so blocking severs/prevents reverse-follows (run after social_setup — see §3)
supabase_streak_stats.sql one-time SQL: get_streak_stats(tz text) RPC — island/gap window function returning current_streak + longest_streak; SECURITY INVOKER so RLS filters to the calling user's rows automatically
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
- ✓ **Streak tracking** — current streak and all-time best shown in the header badge (always visible) and the analysis stats strip; computed via `get_streak_stats` Supabase RPC (island/gap window function, all-time, timezone-aware)
- ✓ **Time-of-day analysis** — analysis section bucketing entries by morning/afternoon/evening/night with count and avg v/a per slot
- ✓ **JSON export** — `↓ json` button alongside CSV; exports filtered slice with all fields including zone
- ✓ **Shareable vibe card** — `↗` on public entries opens share modal; "copy link" produces a `?share=<token>` URL with base64-encoded vibe data. `PublicShareView` renders the card without auth for any share URL.
- ✓ **Dynamic vibe accent** — UI accent defaults to cream/charcoal and recolors to the most recently logged vibe's zone color; session-scoped (resets to cream on sign-out). See `src/lib/accent.ts`.
- ✓ **PWA service worker** — `public/sw.js`: cache-first for `/assets/` (Vite content-hashed bundles), network-first for navigation, pass-through for Supabase. Registered in `main.tsx`.
- ✓ **User search** — debounced username search (`useUserSearch`) surfaced in the timeline; explicit empty-state for zero results
- ✓ **Profile views** — `UserProfileModal` + `useUserProfile`: stats, public vibe feed, follow/block actions; opened from any clickable `@username` across the app
- ✓ **Account settings modal** — `AccountSettingsModal` consolidates username/password/sign-out/following/followers/blocked into one tabbed modal, replacing scattered header buttons
- ✓ **Timeline filters by date and mood** — `from`/`to` date-range inputs + toggleable zone/mood chips, combinable with the everyone/following feed filter
- ✓ **Mutual follows / follow-back indicator** — "follows you" badge shown on `UserProfileModal` when the relationship is mutual (requires the additive `follows` SELECT policy in `supabase_social_setup.sql`)
- ✓ **Block / mute** — `blocks` table + `useBlocks` (mirrors `useFollows`); hides a blocked user's entries from the timeline and their profile's vibe feed. Also enforced at the DB level: blocking severs and prevents reverse-follows (`supabase_block_follow_fix.sql`, see §3)
- ✓ **New-user onboarding hint** — modal explaining how to use the grid (axes + click-to-log), shown each visit to the `log` view until the user logs their first vibe
- ✓ **Improved empty states** — large, centered "no logs yet" messaging in `MoodTable` for zero-entry accounts

### Longer-term / speculative

**Weekly digest email**  
Supabase Edge Function + email provider (Resend or Postmark). Sends a weekly summary: avg mood, top zone, top words. Significant scope expansion toward a service.

**Anonymous aggregate heatmap (opt-in)**  
An opt-in toggle that shows a blurred heatmap of all users' activity for today. "Are other people also having a bad week?" Significant privacy surface area — opt-in is essential.

**Custom zone labels**  
Per-user rename of the seven zone labels, stored in a `zone_labels` column on `profiles`. The existing names are central to the app's personality, so this would probably be a power-user feature.

---

## 9. Known Gaps & Gotchas

### Resolved this session (2026-06-08)

- ✓ **Streak badge in header.** Current streak (and best-ever when longer) now shown as a persistent pill in the header, not only buried in the analysis panel. Both values fetched via `get_streak_stats` Supabase RPC (`useStreaks.ts`); refreshes after add and delete.
- ✓ **Streak logic moved to Supabase.** Previously computed client-side from the `vibes` array (no longest streak, no timezone awareness). Replaced with a `get_streak_stats(tz text)` Postgres function using the island/gap window trick (`d - ROW_NUMBER()` groups consecutive dates). SECURITY INVOKER — RLS automatically scopes to the calling user's rows; no uid parameter needed.

### Resolved this session (2026-06-07)

- ✓ **Mutation failures were silent.** `useVibes` was never actually optimistic (state only updates `if (!error && data)`), but failures were swallowed with no user feedback — a failed log/edit/delete just looked like nothing happened. Fixed: `MoodModal` now shows an inline error and stays open on failure (`handleModalSubmit` returns success/failure instead of unconditionally closing); `MoodTable` shows a dismissing error toast (reusing the undo-toast visual pattern) when an edit or delete fails, so the user knows a row reverted/restored rather than wondering why it looks stale.
- ✓ **No error boundary.** Added `src/components/ErrorBoundary.tsx`, wrapping `<App />` in `main.tsx`. An uncaught render error now shows a "something broke / your data is safe / reload" screen instead of a blank crash.
- ✓ **Share links weren't validated against the DB.** `encodeShare` now embeds the vibe `id` in the payload; `PublicShareView` looks the vibe up live via Supabase (anon-readable under the existing `public = true` RLS policy) and renders current data, showing "this vibe is no longer shared" if it was deleted or made private. Older links without an `id` still render from the encoded payload as before — non-breaking.
- ✓ **CI used `npm install` instead of `npm ci`.** The lockfile has been in sync since PR #4; `.github/workflows/ci.yml` now runs `npm ci` for a reproducible, exact-match install.
- ✓ **Blocking didn't prevent the blocked user from following you.** See §3 / `supabase_block_follow_fix.sql` — a restrictive `follows` INSERT policy plus an `AFTER INSERT` trigger on `blocks` now sever and prevent reverse-follows at the DB level.

### Accepted tradeoffs & maintenance notes (not bugs)

- **`labelScale` on mobile** scales all label font sizes by 0.58 (`MoodGrid.tsx`). Not a gap — just remember to re-check mobile widths if label sizing changes.
- **The 3-hour lock constant exists in two places** (`LOCK_AFTER_MS` in `MoodTable.tsx` and the Supabase RLS policy's `interval '3 hours'`) because enforcement is deliberately split across the TS client (UX) and Postgres (security) — see §6. They're cross-referenced here and in §6; there's no single source of truth to extract them to across that boundary.
- **Similar vibers uses all-time data**, not a recent window — a deliberate simplicity choice for the first version. Could get noisy for users whose patterns have shifted; a recency-weighted variant would be a reasonable future enhancement (see §8) but isn't a defect.
- **Timeline pagination is page-local for client-side filters** ("following", date-range, mood/zone — see §5 Timeline). Doing this properly needs server-side filtering (a Postgres RPC/view), which is feature-sized rather than a quick fix; tracked as a roadmap idea in §8 rather than an open gap. The "load more" button is correctly hidden whenever a page-local filter is active, so the limitation is at least not silently misleading.
- **PWA is not offline-capable for data**, by design — a mood logger needs a live, authenticated connection to Supabase to log or read entries; only static assets are cached. This is a documented non-goal, not a defect.

### Historical note

- **`useVibes` previously had a cross-account data leak**: `fetchVibes` queried `vibes` with no `user_id` filter, relying solely on RLS (`auth.uid() = user_id OR public = true`) — this meant the personal grid/table/analysis views showed the current user's own vibes *plus* every other user's public vibes, rendered as if they were the viewer's own. Fixed by adding an explicit `.eq('user_id', session.user.id)`. (Latent since the personal views were introduced; only surfaced once a second account with public entries existed to test against.)

---

## 10. Continuous Integration

`.github/workflows/ci.yml` runs on every pull request and on pushes to `master`:

1. Checkout (`actions/checkout@v4`)
2. Node 22 (`actions/setup-node@v4`)
3. `npm ci` (lockfile kept in sync with `package.json`; reproducible exact-match install)
4. `npm run typecheck` (`tsc --noEmit`)
5. `npm test` (`vitest run` — the full suite)

A failing type check or test blocks the green check on the PR. This is separate from Vercel, which independently builds and deploys a preview on each push (the `Vercel` status check). No env vars are needed in CI: the only test that touches Supabase (`follows.test.ts`) mocks `../lib/supabase`, and the rest are pure logic or props-driven.

---

## 11. Android App Wrapper

The app has been adapted to a native Android application using [Capacitor](https://capacitorjs.com/) and lives in a parallel project directory (`vibeslogger_android_app/vibeslogger_init`). 

**Major Differences from the Web App:**
- **Push Notifications:** The Android app leverages `@capacitor/local-notifications` to schedule daily randomized background push notifications (two a day: one between 11:00 AM - 2:30 PM, and one between 8:00 PM - 11:30 PM) reminding the user to log their vibe.
- **Offline Caching:** If the device is offline, pending vibes are stored locally in the `vibelogger_offline_queue` via `@capacitor/preferences`. These cached entries are flushed and synced to Supabase when the app detects a connection again.
- **Haptic Feedback:** The Android version utilizes `@capacitor/haptics` to trigger tactile vibration feedback during grid interactions.
- **Grid / Record toggle:** The `log` view has a segmented pill (`grid` | `record`) in the header that switches between the mood grid and the entries list — replacing the side-by-side layout used on desktop, which doesn't work well on a phone's narrow screen.
- **`VibeActionModal`** (`src/components/VibeActionModal.tsx`): On mobile, tapping a row in the record view opens a full-screen modal (zone label, dot color, note, timestamp) with share, edit-note, and delete actions. This modal is now shared with the web app, where it is triggered by an ellipsis (`•••`) button on the row.
- **Streak badge:** Shared with the web app — see §5. Both codebases use the same `useStreaks` hook and `.user-block` stacked layout.
- **Project Structure:** Code changes for React components must be synced into the Android project explicitly, and live-updates are not supported in the built APK; manual re-compilation and installation is necessary.

**Key Configuration:**
- **App ID:** `com.kaiserfactorial.vibelogger`
- **App Name:** `vibelogger`
- **Platform Wrapper:** `@capacitor/android` + `@capacitor/cli`

**Build Process:**
1. Build the web app: `npm run build`
2. Sync Capacitor: `npx cap sync android`
3. Compile the APK: `cd android && ./gradlew assembleDebug`

The resulting APK is generated in `android/app/build/outputs/apk/debug/app-debug.apk`. 
See `BUILD.md` in the root app directory for instructions on how to install it via USB or Wi-Fi using `adb` or standard file transfer.
