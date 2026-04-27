# CC Brief: /community Subhub + Auth Module

## Context

Build the `/community` subhub for CourtSense. This is the recreational/competitive player entry point, third pillar of the landing page (after Teams and Leagues). All copy decisions are locked; this brief is implementation-only.

Concurrent with the subhub: build a **reusable auth module** (`auth.js`) that ports the Leon school login pattern. /community is the first consumer; /leagues will adopt it later when that subhub ships. /teams stays on its existing per-school auth (do NOT touch /leon/).

Estimated scope: 2-3 days of focused work.

---

## Repo + paths

- Repo: `markmcnees/courtsense` (the main repo, NOT a new one)
- New page: `community/index.html` (single-file HTML app, vanilla JS + Firebase SDK from CDN, same pattern as kotb-pickup)
- New shared module: `auth.js` at the repo root (next to `app.js`)
- Updates needed:
  - `admin-players.html`: add password generation on approve, add password reset button per player
  - `kotb-pickup/index.html`: integrate auth gate (see Auth Integration section below)
  - Root `index.html`: update OG meta tags (see OG Meta Tags section)
  - All HTML files: link the new `og-image.png` (already committed at repo root)

---

## Part 1: Auth Module (`auth.js`)

### Pattern source

Port from `/leon/app.js` (reference is in the chat history; key functions are `pinPress`, `playerLogin`, `loginAsCoach`, `logout`, `autoLogin` around lines 2623-2730 of that file).

### Adaptations for CourtSense

The Leon flow has a coach/player toggle. /community is **player-only**. Skip the coach side entirely. Coach actions on CourtSense happen via `admin-players.html` (already PIN-gated separately).

### Module shape

`auth.js` exposes a `CourtSenseAuth` global with:

```js
CourtSenseAuth.init({
  firebaseDb,            // Firebase database reference, passed in by caller
  rosterPath,            // string, e.g. 'tally_kotb_pickup/players'
  onLogin: (player) => {},   // callback after successful login
  onLogout: () => {}         // callback after logout
})

CourtSenseAuth.showLogin()       // shows the login overlay
CourtSenseAuth.hideLogin()       // hides it (call after login)
CourtSenseAuth.currentPlayer()   // returns logged-in player object or null
CourtSenseAuth.logout()          // clears session, shows login again
CourtSenseAuth.changePassword(oldPw, newPw) // returns Promise<bool>
```

### Login overlay UI

Single screen, not the toggle-style two-tab Leon UI:

1. **Header:** CourtSense logo (use the existing `og-image.png` or scale `CourtSense_Horizontal.png`), centered
2. **Subheader:** `2026 Beach Volleyball Season` (matches Leon style)
3. **Player select:** `<select>` populated from the roster path. Shows `firstName + ' ' + lastName`, sorted by lastName. First option: `— Choose Player —` with empty value.
4. **Password input:** `<input type="password" placeholder="Enter Password">`
5. **Error display:** small red text below password input
6. **Login button:** `Log In` (or `View My Stats` style, whatever reads cleanest)
7. **Footer link:** `Forgot password? Contact admin.` with `mailto:mark@markmcnees.com` link (no reset flow in v1)

### Login logic

```js
async function attemptLogin(playerId, password) {
  const playerRef = await db.ref(`${rosterPath}/${playerId}`).once('value');
  const player = playerRef.val();
  if (!player) return { success: false, error: 'Player not found' };
  if (!player.passwordHash) return { success: false, error: 'No password set. Contact admin.' };

  const ok = await verifyPassword(password, player.passwordHash);
  if (!ok) return { success: false, error: 'Incorrect password' };

  sessionStorage.setItem('courtsenseAuth', JSON.stringify({ playerId, ts: Date.now() }));
  return { success: true, player: { id: playerId, ...player } };
}
```

### Password hashing

Use **bcrypt-js** (works in browser, no native deps): `https://cdn.jsdelivr.net/npm/bcryptjs@2.4.3/dist/bcrypt.min.js`. Cost factor 10 is fine.

Hashing happens in `admin-players.html` at approval time. Verifying happens in `auth.js` at login time. The password is never stored as plaintext anywhere — Firebase only ever sees the hash.

### Session persistence

`sessionStorage` (NOT `localStorage`). Survives navigation, clears on browser close. Same as Leon. Auto-restore on page load via `autoLogin()` style helper.

### Logout

Clears `sessionStorage`, calls `onLogout` callback, shows login overlay again.

---

## Part 2: Password generation in admin-players.html

When admin clicks **Approve** on a pending registration:

1. Generate a memorable password using a word-style format: `[noun][noun][2-digit-number]`
   - Word list: curate ~50 short, easy nouns (sand, court, ball, beach, palm, sun, wave, shore, tiger, lion, wing, net, set, dig, ace, etc.)
   - Format: `wave + court + 42` → `wavecourt42`
   - Always lowercase, no spaces, ends in 2 digits
2. Hash the password with bcrypt (cost 10)
3. Write hash to `tally_kotb_pickup/players/{playerId}/passwordHash`
4. Queue welcome email at `tally_kotb_pickup/email_queue/{push}` with type `welcome`, including the **plaintext password** in the payload as `generated_password`
5. After the email worker dispatches, the plaintext is gone forever. Only the hash remains.

**Add a Reset Password button per player row** in admin-players.html:
- Generates a new word-style password
- Updates `passwordHash` in Firebase
- Queues a `password_reset` email (NEW email type, to be added later — for now, just regenerate and display the new password to admin in a modal so admin can text it to the player)

---

## Part 3: /community Subhub Build

### File: `community/index.html`

Single-file HTML, same architecture as kotb-pickup. Use the existing kotb-pickup CSS variables and font stack (Bebas Neue + Barlow). Navy primary `#1a3a6b`.

### Page structure (top to bottom)

1. **Header bar** — CourtSense logo + page title (`Community`) + 👤 profile button (visible only when logged in)
2. **Hero section**
   - Headline: `Find your game.`
   - Subheadline: `Pickup games, tournament partners, training, and leagues. All in one place.`
3. **Auth gate banner** (always visible in v1, per D.40)
   - Copy: `Register with CourtSense to access games, partners, and coaches. Free, takes a minute.`
   - CTA button: `Join CourtSense` → links to `/kotb-pickup/join`
   - Background: light gray or sand color
4. **Cards grid** (5 cards, responsive)
5. **Footer** — `Built in Tallahassee · courtsense.app`

### Cards specification

5 cards, in this order. Desktop: 5-across or 3+2 layout. Mobile: stacked single-column.

**Card 1: Find a Game**
- Icon/emoji: 🏐
- Title: `Find a Game`
- Description: `Browse upcoming pickup events and RSVP. First-come-first-served slots; auto-waitlist when full.`
- Action: link to `/kotb-pickup`
- State: live, no badge

**Card 2: Find a Tournament Partner**
- Icon/emoji: 🏆
- Title: `Find a Tournament Partner`
- Description: `Match with players in your skill range looking for a partner for upcoming tournaments.`
- Action: opens Tournament Partner waitlist modal (see Modals section)
- State: Coming Soon — small gold badge in top-right corner of card

**Card 3: Find a Training Partner**
- Icon/emoji: 💪
- Title: `Find a Training Partner`
- Description: `Connect with players in your area who want to drill, practice, and improve together.`
- Action: opens Training Partner waitlist modal
- State: Coming Soon badge

**Card 4: Join CourtSense**
- Icon/emoji: ✋ or ➕
- Title: `Join CourtSense`
- Description: `New to the platform? Register here. Free, takes a minute.`
- Action: link to `/kotb-pickup/join`
- State: live, no badge
- **Visual treatment:** slightly larger or accented since this is the prerequisite gate

**Card 5: Find a Coach**
- Icon/emoji: 🎯
- Title: `Find a Coach`
- Description: `Connect with certified beach volleyball coaches in your area for lessons and skill development.`
- Action: opens Find a Coach two-sided modal (see Modals section)
- State: Coming Soon badge

### Auth integration

In v1, the auth gate is **visual only** — the banner is always shown, cards are clickable for everyone. Per D.40, no detection logic in v1.

**v2 (future):** when `CourtSenseAuth.currentPlayer()` returns a player, hide the banner. When null, show banner and (optionally) dim the cards. This is queued, not built tonight.

For v1: just render the banner unconditionally. Cards work for everyone. Tapping a Coming Soon card opens the modal (which captures email even from non-registered users — that's fine, it's a waitlist).

---

## Part 4: Modals

Three modals on /community, all sharing a common modal shell (overlay + close button + form pattern).

### Modal 1: Tournament Partner Waitlist

**Header:** `We are currently building this feature.`

**Body:**
> The Tournament Partner Finder will help you connect with players in your skill range looking for a partner for upcoming tournaments. Drop your email and we'll let you know when it's live.

**Form fields:**
- Email (required, email validation)
- Skill range (required, dropdown):
  - `Beginner (BB)`
  - `Intermediate (A)`
  - `Advanced (AA)`
  - `Expert (Open)`
- City (required, text input, placeholder `Tallahassee`)

**Submit:** writes to `tally_kotb_pickup/waitlist/tournament_partner/{push}` with payload `{email, skill, city, submittedAt}`. Show success state: `You're on the list. We'll be in touch.` + auto-close after 3 seconds.

### Modal 2: Training Partner Waitlist

Same shell as Modal 1.

**Header:** `We are currently building this feature.`

**Body:**
> The Training Partner Finder will help you connect with players in your area who want to drill, practice, and improve together. Drop your email and we'll let you know when it's live.

**Form fields:** same as Modal 1.

**Submit:** writes to `tally_kotb_pickup/waitlist/training_partner/{push}`.

### Modal 3: Find a Coach (two-sided)

This modal has a fork at the top. Different layout than Modals 1 and 2.

**Step 1 — fork:**

Header: `Find a Coach`

Two large buttons:
- `I'm looking for a coach` → goes to player-side form
- `I'm a coach` → goes to coach-side form

**Step 2a — player-side:**

Header: `We are currently building this feature.`

Body:
> Find a Coach will help you connect with certified beach volleyball coaches in your area for lessons, drills, and skill development. Drop your email and we'll let you know when it's live.

Form: just email (required).

Submit: writes to `tally_kotb_pickup/waitlist/find_coach_player/{push}`.

**Step 2b — coach-side:**

Header: `Get listed as a CourtSense coach.`

Body:
> We're building a directory to connect certified coaches with players looking for lessons. As part of our launch, founding coaches pay a one-time $50 listing fee for six months of access. Pricing will adjust as the platform grows; founding coaches get the first heads-up. Tell us about yourself and we'll reach out as we onboard our first cohort.

Form fields:
- Coach name (required)
- Email (required, email validation)
- Phone (required)
- Certifications / credentials (required, textarea, placeholder `e.g. USAV CAP Level II, former NCAA D1 player`)
- City (required, text, placeholder `Tallahassee`)
- Anything else you'd like us to know? (optional, textarea)

Submit: writes to `tally_kotb_pickup/waitlist/find_coach_provider/{push}` with all fields + `submittedAt`. Success state: `Thanks. We'll reach out as we onboard our first cohort.`

---

## Part 5: OG Meta Tags

Add to root `index.html`, /community/index.html, and any other top-level pages. The `og-image.png` is already committed at the repo root.

```html
<!-- Open Graph -->
<meta property="og:type" content="website">
<meta property="og:title" content="CourtSense">
<meta property="og:description" content="Beach volleyball, organized. Run a league, manage a team, find a pickup game.">
<meta property="og:image" content="https://courtsense.app/og-image.png">
<meta property="og:url" content="https://courtsense.app">
<meta property="og:site_name" content="CourtSense">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="CourtSense">
<meta name="twitter:description" content="Beach volleyball, organized. Run a league, manage a team, find a pickup game.">
<meta name="twitter:image" content="https://courtsense.app/og-image.png">
```

No Twitter handle (skipped per spec).

---

## Part 6: Eligibility text update (P.8 / I.4)

In `kotb-pickup/index.html`, find the eligibility summary text (likely renders something like `X players currently eligible`) and update to:

`{count} players currently eligible in your area`

Per D.41 (to be added), this is forward-compatible language for when geo filtering ships. Today everyone is local; tomorrow the resolver gains a haversine filter and the copy stays accurate.

---

## Part 7: Auth integration in kotb-pickup

In `kotb-pickup/index.html`, integrate the new `CourtSenseAuth` module:

1. Load `auth.js` from the repo root
2. On page load, call `CourtSenseAuth.init({...})` with kotb-pickup's Firebase DB and `tally_kotb_pickup/players` as the roster path
3. If `CourtSenseAuth.currentPlayer()` is null, show login overlay before allowing access to RSVP / event creation
4. Add a logout button to the header
5. The existing `identity.js` continues to handle in-app identity selection for things like RSVPing on behalf of a logged-in player. Auth determines who CAN access; identity determines who they ARE acting as (usually the same in /community context).

This is a delicate change. **Test thoroughly** before merging — the pickup app is in active production use.

---

## Out of scope for this PR

- Magic-link tokens for email RSVPs (N.8, deferred)
- Booking infrastructure / Stripe Connect for coach payments (D.39, deferred)
- Coach reviews and ratings (D.37, deferred to live directory phase)
- Auth detection on /community to hide banner for logged-in users (queued for v2)
- /leagues subhub auth integration (will happen when /leagues ships)
- /leon/ migration to shared auth (intentionally not touched)
- Password reset email template (placeholder admin-displays-new-password flow for now)
- Geo-based eligibility filtering (forward-compatible copy only)

---

## Acceptance criteria

- `auth.js` loads on /community and /kotb-pickup; both pages gate access correctly
- Admin approval in admin-players.html generates and stores a hashed password, queues welcome email with plaintext password
- New player can log in on /community using credentials from welcome email
- Player can change password from a profile area (location TBD; can be a modal off the 👤 button)
- Admin can reset any player's password from admin-players.html; new password displayed to admin in a modal
- /community renders all 5 cards correctly on desktop and mobile
- All three modals (Tournament Partner, Training Partner, Find a Coach two-sided) submit to correct Firebase paths
- OG meta tags render correctly when courtsense.app is shared on iMessage, Twitter/X, LinkedIn, Slack
- Eligibility text on kotb-pickup reads `X players currently eligible in your area`
- Logout button works; sessionStorage cleared; login overlay shown again
- No regressions in kotb-pickup RSVP flow, event creation, or scoring

---

## Branch and PR strategy

Given the scope, two PRs is cleaner than one:

**PR 1: Auth module + admin-players password generation**
- Branch: `feat/auth-module-and-password-gen`
- Files: `auth.js`, `admin-players.html`
- Self-contained, can ship before /community is built
- Acceptance: admin can approve a registration, password is generated, welcome email queues with password, player can log in via auth module on a test page

**PR 2: /community subhub + kotb-pickup auth integration + OG tags + eligibility text**
- Branch: `feat/community-subhub`
- Depends on PR 1 being merged
- Files: `community/index.html`, `kotb-pickup/index.html`, `index.html`, all OG-tagged HTML
- Acceptance: full /community page works end-to-end with auth gate

Hold both PRs for Mark to review. Don't auto-merge.

---

## Reference

- Locked decisions and tonight's brief context: `docs/state.md`, `docs/courtsense_project_plan.xlsx`
- Email templates (with welcome password addition): `docs/email-templates.md`
- Leon auth pattern source: `/leon/app.js` lines 2623-2730 (login overlay HTML around lines 390-432)
