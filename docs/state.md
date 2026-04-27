# CourtSense: Where We Are

**Last updated:** April 27, 2026

This doc is a fast-orient snapshot for fresh Claude Code sessions or anyone new picking up the project. For task-level detail, see `courtsense_project_plan.xlsx` in this folder. For architectural decisions and rationale, see the Decisions Log tab in that same xlsx.

---

## What CourtSense is

CourtSense.app is a beach volleyball platform serving three audiences: **Teams** (HS/college coaches), **Leagues** (city/club KOTB-QOTB directors), **Community** (recreational and competitive players). Currently in Beta MVP, all production traffic is the Tallahassee, FL community.

Built and maintained by Mark McNees. Single-developer project with Claude Code as primary build partner.

---

## Repos

| Repo | Purpose | Notes |
|------|---------|-------|
| `markmcnees/courtsense` | Main app repo. Landing page + pickup app + admin tools. Deployed via GitHub Pages with CNAME serving courtsense.app. | Primary repo. Contains `docs/` (this folder), `kotb-pickup/` (pickup app), root admin HTML files, etc. |
| `markmcnees/leon-beach` | Original league app (KotB/QotB) at markmcnees.github.io/leon-beach/kotb.html. | Still serves the league. Will eventually migrate under courtsense.app. |
| `markmcnees/courtsense-email-worker` | Cloudflare Worker for email dispatch (invite, reminder, waitlist promo). | Scaffolded, awaiting deploy. See `docs/email-templates.md` for spec. |
| `leon-beach-ai` (Cloudflare Worker) | Anthropic API proxy for league app schedule generation. | Untouched, stays focused on AI calls only. |

---

## What's live in production

- **courtsense.app** root landing page (three-column hub)
- **courtsense.app/kotb-pickup** pickup tournament app with full RSVP flow
- **courtsense.app/kotb-pickup/join** public registration with admin approval
- **markmcnees.github.io/leon-beach/kotb.html** Kings/Queens league app (Tallahassee KotB/QotB season in flight)
- **Glicko-2 ratings** spanning league + pickup, single shared rating record per player at `tally_kotb_pickup/ratings/{playerName}/`
- **Admin tools** at `/admin-players.html` (registration approval) and `/admin-ratings.html` (rating management), both PIN-gated (PIN: 8675)
- **Email queue infrastructure** at `tally_kotb_pickup/email_queue/` (welcome, decline, admin notification dispatch already working). The new Worker takes over invite/reminder/waitlist dispatch when it deploys.

---

## Active threads

### courtsense-email-worker (in flight)
Repo scaffolded, `tsc --noEmit` clean. Three things gate first deploy:
1. `wrangler kv:namespace create RATE_LIMIT` (and `--preview`), paste IDs into `wrangler.toml`
2. `wrangler secret put RESEND_API_KEY`
3. `wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON`

Open question: confirm where `admin_new_registration` is currently dispatched from before the new Worker goes live. Worker currently marks that type `skipped_unsupported` to avoid double-send. If it was meant to flow through this queue, Worker needs a handler.

Magic-link tokens deferred for v1 per D.36. Currently uses plain deep links. N.8 in plan tracks the hardening work.

### Subhubs (queued, build order: Community → Leagues → Teams)
None started yet. Community is up first because all four destinations (Find a Game, Tournament Partner, Training Partner, Register) point at things that already exist or are tiny waitlist modals. Leagues and Teams are larger scopes.

### Pickup app polish (small queue)
- P.8 Eligibility summary text honesty update (P1)
- I.4 Eligibility summary count + sources accuracy (P1)
- B.6 Identity auto-resolve in incognito (P2, future)

---

## Next obvious moves

In rough priority order:

1. Deploy courtsense-email-worker (Mark does wrangler/secrets, then live test with `POST /run`)
2. Build /community subhub (smallest scope, all destinations exist)
3. RG.8 fresh end-to-end registration test (Mark, blocked on nothing)
4. Build /leagues subhub
5. Build /teams subhub (largest scope, includes porting the Sand Sharks demo)

---

## Source of truth

- **Task tracking:** `docs/courtsense_project_plan.xlsx` (8 tabs: Overview, Landing Page, Pickup App, Ratings, Invites & RSVP, Registration, Bugs & Issues, Decisions Log)
- **Email template spec:** `docs/email-templates.md`
- **This doc:** `docs/state.md` (high-altitude snapshot, update alongside the plan)

---

## Conventions

- **No em dashes anywhere.** Use periods, semicolons, commas, or parentheses instead.
- **Tone in user-facing copy:** warm and direct.
- **HTML apps:** single-file pattern (vanilla JS + Firebase SDK from CDN, no build tools, no frameworks). Pickup app and league app both follow this. Subhubs may break this convention if needed.
- **Firebase pattern:** fire-and-forget `fbSet` writes (Firebase promises don't reliably resolve in this deployment context).
- **Patches:** always work from the currently uploaded file as ground truth, never from a cached prior version. Version drift is a real risk.
- **Admin PIN:** 8675, used across league app and admin tools.

---

## Two Firebase root namespaces, kept isolated

- `tally_kotb` — league app data (kings, queens, archive)
- `tally_kotb_pickup` — pickup app, ratings, email queue, registration, groups, leads, waitlist

The league app writes to `tally_kotb_pickup/ratings/` for cross-app rating sync. Otherwise the two namespaces are isolated.

---

## How to update this doc

Update this file alongside the project plan whenever:
- A pillar moves from queued/in-progress to live
- A new repo is created
- A major architectural decision lands (also log it in Decisions Log)
- The "next obvious moves" list shifts meaningfully

Keep it under 200 lines. If a section grows, move detail into the plan and link out from here.
