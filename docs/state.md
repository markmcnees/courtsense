# CourtSense: Where We Are

**Last updated:** April 27, 2026 (afternoon session)

This doc is a fast-orient snapshot for fresh Claude Code sessions or anyone new picking up the project. For task-level detail, see `courtsense_project_plan.xlsx` in this folder. For architectural decisions and rationale, see the Decisions Log tab in that same xlsx.

---

## What CourtSense is

CourtSense.app is a beach volleyball platform serving three audiences: **Teams** (HS/college coaches), **Leagues** (city/club KOTB-QOTB directors), **Community** (recreational and competitive players). Currently in Beta MVP, all production traffic is the Tallahassee, FL community.

Built and maintained by Mark McNees. Single-developer project with Claude Code as primary build partner.

---

## Repos

| Repo | Purpose | Notes |
|------|---------|-------|
| `markmcnees/courtsense` | Main app repo. Landing page + pickup app + admin tools + /leon/ + /community (planned). Deployed via GitHub Pages with CNAME serving courtsense.app. | Primary repo. Contains `docs/`, `kotb-pickup/`, `leon/`, root admin HTML, and (incoming) `community/`. |
| `markmcnees/leon-beach` | Original league app (KotB/QotB) at markmcnees.github.io/leon-beach/kotb.html. | Still serves the league. Will eventually migrate under courtsense.app. |
| `markmcnees/courtsense-email-worker` | Cloudflare Worker for email dispatch (all six template types). | Scaffolded with all six builders, awaiting deploy. See `docs/email-templates.md` for spec. |
| `leon-beach-ai` (Cloudflare Worker) | Anthropic API proxy for league app schedule generation. | Untouched, stays focused on AI calls only. |

---

## What's live in production

- **courtsense.app** root landing page (three-column hub)
- **courtsense.app/kotb-pickup** pickup tournament app with full RSVP flow
- **courtsense.app/kotb-pickup/join** public registration with admin approval
- **courtsense.app/leon/** Leon Queens beach volleyball app (school team app, has its own auth pattern that we're porting)
- **markmcnees.github.io/leon-beach/kotb.html** Kings/Queens league app (Tallahassee KotB/QotB season in flight)
- **Glicko-2 ratings** spanning league + pickup, single shared rating record per player
- **Admin tools** at `/admin-players.html` and `/admin-ratings.html`, both PIN-gated (PIN: 8675)
- **Email queue infrastructure** at `tally_kotb_pickup/email_queue/`. Existing dispatch path (admin_new_registration / welcome / decline) being migrated to the new Worker on first deploy.

---

## Active threads

### courtsense-email-worker (in flight, awaiting deploy)
Repo scaffolded with all SIX template types (invite, reminder, waitlist, admin, welcome, decline). `tsc --noEmit` clean. Three things gate first deploy:
1. `wrangler kv:namespace create RATE_LIMIT` (and `--preview`), paste IDs into `wrangler.toml`
2. `wrangler secret put RESEND_API_KEY`
3. `wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON`

**One-time on first deploy:** existing `admin_new_registration` items are queued in Firebase from past join-form submissions. They will all dispatch to Mark's inbox on first `POST /run`. Either drain the queue manually first via Firebase console (recommended; those applicants already actioned) or accept the inbox burst.

Magic-link tokens deferred for v1 per D.36. Currently uses plain deep links. N.8 in plan tracks the hardening work.

### /community subhub (in flight)
Full spec locked in afternoon session 4/27. CC brief at `docs/cc-brief-community-subhub.md` covers:
- Five cards (Find a Game / Find a Tournament Partner / Find a Training Partner / Join CourtSense / Find a Coach)
- Three modals (two waitlist + one two-sided coach lead capture)
- Auth gate banner (always-visible in v1, detection deferred)
- Reusable `auth.js` module ported from Leon school flow
- OG meta tags on root + /community
- Eligibility text update on kotb-pickup
- Auth integration in kotb-pickup

Estimated 2-3 days CC work, splitting into two PRs (auth module + admin-players password gen, then /community + kotb-pickup integration).

### Subhubs queued (build order: Community → Leagues → Teams)
/community is in flight per above. /leagues and /teams come after. /leagues will be the second consumer of `auth.js`. /teams stays on per-school auth (existing /leon/ pattern) until a future unification project.

---

## Architectural decisions made this session (Apr 27 afternoon)

- **D.37:** Coach reviews and ratings deferred to live directory phase
- **D.38:** Founding coach pricing model ($50 one-time, six months, soft expire with 30-day grace)
- **D.39:** Booking infrastructure deferred until validated coach demand
- **D.40:** Auth as reusable module, ported from Leon school flow
- **D.41:** Eligibility text future-proofed for geo ("in your area")
- **D.42:** /community five cards + always-visible auth gate banner

D.35 and D.36 (email worker repo + magic links deferred) were locked earlier in the day.

---

## Next obvious moves

In rough priority order:

1. Mark deploys courtsense-email-worker (wrangler/secrets/test)
2. CC ships /community subhub + auth module per the brief at `docs/cc-brief-community-subhub.md`
3. Mark dogfoods /community auth flow (approve test user → log in via welcome email password → change password → admin reset password)
4. Build /leagues subhub (next subhub, second consumer of auth.js)
5. Build /teams subhub (largest scope, includes porting Sand Sharks demo)

---

## Source of truth

- **Task tracking:** `docs/courtsense_project_plan.xlsx` (8 tabs: Overview, Landing Page, Pickup App, Ratings, Invites & RSVP, Registration, Bugs & Issues, Decisions Log)
- **Email template spec:** `docs/email-templates.md` (six templates including welcome with generated password per D.40)
- **CC brief for /community + auth:** `docs/cc-brief-community-subhub.md`
- **This doc:** `docs/state.md` (high-altitude snapshot, update alongside the plan)

---

## Conventions

- **No em dashes anywhere.** Use periods, semicolons, commas, or parentheses instead.
- **Tone in user-facing copy:** warm and direct.
- **HTML apps:** single-file pattern (vanilla JS + Firebase SDK from CDN, no build tools, no frameworks). Pickup app, league app, /leon/ all follow this. /community will too.
- **Firebase pattern:** fire-and-forget `fbSet` writes (Firebase promises don't reliably resolve in this deployment context).
- **Patches:** always work from the currently uploaded file as ground truth, never from a cached prior version. Version drift is a real risk.
- **Admin PIN:** 8675, used across league app and admin tools.
- **Auth (incoming):** per-player password generated at admin approval, hashed with bcrypt, plaintext only in welcome email. sessionStorage for session persistence. No password reset email flow in v1; admin resets and texts new password to player.

---

## Two Firebase root namespaces, kept isolated

- `tally_kotb` — league app data (kings, queens, archive)
- `tally_kotb_pickup` — pickup app, ratings, email queue, registration, groups, leads, waitlist, **and (incoming) passwordHash per player**

The league app writes to `tally_kotb_pickup/ratings/` for cross-app rating sync. Otherwise the two namespaces are isolated.

---

## How to update this doc

Update this file alongside the project plan whenever:
- A pillar moves from queued/in-progress to live
- A new repo is created
- A major architectural decision lands (also log it in Decisions Log)
- The "next obvious moves" list shifts meaningfully

Keep it under 200 lines. If a section grows, move detail into the plan and link out from here.
