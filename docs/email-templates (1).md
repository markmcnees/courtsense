# CourtSense Pickup Email Templates

Templates for the courtsense-email-worker dispatch queue. Six total: invite, 24-hour reminder, waitlist promotion, admin new-registration notification, welcome, decline.

Owned by the Cloudflare Worker that drains `tally_kotb_pickup/email_queue/` and dispatches via Resend.

---

## Shared spec (player-facing emails: invite, reminder, waitlist, welcome, decline)

- **From:** `CourtSense <noreply@courtsense.app>` (adjust to whatever sending domain Resend is verified for)
- **Layout:** text-only body with a navy accent bar at top, no logo image
- **Navy:** `#1a3a6b` (matches Kings primary and root landing page)
- **Action buttons:** single primary action per email, navy fill, white text, rounded corners
- **Plain-text fallback:** included for every HTML email so clients without HTML rendering still work
- **Merge tokens:** anything in `{curly_braces}` is a field the Worker fills before send
- **Footer line:** `Built in Tallahassee · courtsense.app`

## Admin notification spec (different)

The admin notification (Template 4) goes only to Mark and is utilitarian. No navy bar, no button, no footer. Subject line + facts + admin review link. Optimized for fast mobile triage, not brand presentation.

---

## Template 1: Invite

Fires when a host creates an event and the invite list resolves. One email per eligible recipient with email-on-file and notifications opted in.

**Subject:** `You're invited: {event_name}, {date_short}`

**Preheader (hidden preview text):** `{host_name} added you to {event_name} on {date_short} at {time}. Tap to RSVP.`

### HTML body

```
[navy accent bar, full width, 6px tall]

You're invited to a pickup game.

{host_name} added you to {event_name}.

When: {day_of_week}, {date_long} at {time}
Where: {location}
Slots: {slot_count} players
RSVP closes: {deadline_relative} ({deadline_absolute})

[BUTTON: Count me in] → {opt_in_link}

Can't make it? [Decline] → {decline_link}

You're getting this because you're on the CourtSense pickup roster.
Manage notifications in your profile at courtsense.app/kotb-pickup.

Built in Tallahassee · courtsense.app
```

### Plain-text fallback

```
You're invited to a pickup game.

{host_name} added you to {event_name}.

When: {day_of_week}, {date_long} at {time}
Where: {location}
Slots: {slot_count} players
RSVP closes: {deadline_relative} ({deadline_absolute})

Count me in: {opt_in_link}
Can't make it: {decline_link}

You're getting this because you're on the CourtSense pickup roster.
Manage notifications: courtsense.app/kotb-pickup

Built in Tallahassee · courtsense.app
```

---

## Template 2: 24-Hour Reminder

Fires hourly via Worker cron. Targets invitees with status `pending` (no opt-in, no decline) where the event start is 23 to 25 hours out and `reminderSent` is false. Confirmed RSVPs and waitlisters do NOT receive this email.

**Subject:** `Tomorrow at {time}: {event_name}`

**Preheader:** `Haven't RSVP'd yet. {deadline_relative} to decide.`

### HTML body

```
[navy accent bar]

Reminder: {event_name} is tomorrow.

You haven't RSVP'd yet, and the deadline is coming up.

When: {day_of_week}, {date_long} at {time}
Where: {location}
RSVP closes: {deadline_relative} ({deadline_absolute})

[BUTTON: Count me in] → {opt_in_link}

Can't make it? [Decline] → {decline_link}

If you don't respond before the deadline, your slot opens up for someone else.

Built in Tallahassee · courtsense.app
```

### Plain-text fallback

```
Reminder: {event_name} is tomorrow.

You haven't RSVP'd yet, and the deadline is coming up.

When: {day_of_week}, {date_long} at {time}
Where: {location}
RSVP closes: {deadline_relative} ({deadline_absolute})

Count me in: {opt_in_link}
Can't make it: {decline_link}

If you don't respond before the deadline, your slot opens up for someone else.

Built in Tallahassee · courtsense.app
```

---

## Template 3: Waitlist Promotion

Fires the moment a confirmed player drops out (`dropOut()`) or is marked no-show (`markNoShow()`) and the next waitlister auto-promotes. Per D.23, promotion is automatic; the recipient is already confirmed when this email lands.

**Subject:** `You're in: {event_name}`

**Preheader:** `A spot opened up. You're confirmed for {date_short}.`

### HTML body

```
[navy accent bar]

You're in.

A spot opened up on {event_name} and you're next on the waitlist, so you're confirmed.

When: {day_of_week}, {date_long} at {time}
Where: {location}

No action needed. Just show up and play.

Can't make it after all? [Drop out] → {drop_out_link}
(Dropping out promotes the next person, so do it as soon as you know.)

Built in Tallahassee · courtsense.app
```

### Plain-text fallback

```
You're in.

A spot opened up on {event_name} and you're next on the waitlist, so you're confirmed.

When: {day_of_week}, {date_long} at {time}
Where: {location}

No action needed. Just show up and play.

Can't make it after all? Drop out: {drop_out_link}
(Dropping out promotes the next person, so do it as soon as you know.)

Built in Tallahassee · courtsense.app
```

---

## Template 4: Admin Notification (new registration)

Fires when a public visitor submits the join form at `courtsense.app/kotb-pickup/join`. Goes to Mark only. Utilitarian layout: no navy bar, no button, no footer. Optimized for fast mobile triage.

**Subject:** `New CourtSense applicant: {applicant_name}`

**Preheader:** `{applicant_name} applied. Tap to review.`

### HTML body

```
New applicant on CourtSense Pickup.

Name: {applicant_name}
Email: {applicant_email}
Phone: {applicant_phone}
TruVolley: {truvolley_name}
Referrer: {referrer}
Notifications: {notification_opt_in}
Submitted: {submitted_at}

Review: {admin_review_link}
```

### Plain-text fallback

Same as HTML body (no styling difference). Plain text is the canonical form for this template.

---

## Template 5: Welcome

Fires when admin approves a pending registration. Goes to the new player.

**Subject:** `You're in. Welcome to CourtSense Pickup.`

**Preheader:** `Your account is approved. Browse upcoming pickup events.`

### HTML body

```
[navy accent bar]

Welcome to CourtSense Pickup, {player_name}.

You're approved and active on the roster. From here on, you'll get email invites whenever a host adds you to a pickup event.

[BUTTON: Browse upcoming events] → https://courtsense.app/kotb-pickup

A few things worth knowing:

- Invites arrive by email. Tap "Count me in" to RSVP, or "Decline" if you can't make it.
- Slots fill first-come-first-served. If an event is full, you'll go on the waitlist and get bumped up automatically when someone drops.
- You can drop out of an event any time before it starts. The slot goes to the next person on the waitlist.

See you on the sand.

Built in Tallahassee · courtsense.app
```

### Plain-text fallback

```
Welcome to CourtSense Pickup, {player_name}.

You're approved and active on the roster. From here on, you'll get email invites whenever a host adds you to a pickup event.

Browse upcoming events: https://courtsense.app/kotb-pickup

A few things worth knowing:

- Invites arrive by email. Tap "Count me in" to RSVP, or "Decline" if you can't make it.
- Slots fill first-come-first-served. If an event is full, you'll go on the waitlist and get bumped up automatically when someone drops.
- You can drop out of an event any time before it starts. The slot goes to the next person on the waitlist.

See you on the sand.

Built in Tallahassee · courtsense.app
```

---

## Template 6: Decline

Fires when admin rejects a pending registration AND has the "send decline email" checkbox enabled. Reason field is optional; when blank, the reason line is omitted entirely (no acknowledgment that one is missing).

**Subject:** `Update on your CourtSense Pickup application`

**Preheader:** `Thanks for applying. An update on your application.`

### HTML body (when reason is provided)

```
[navy accent bar]

Hi {applicant_name},

Thanks so much for applying to CourtSense Pickup. Unfortunately we weren't able to approve your application at this time.

{decline_reason}

We appreciate your interest and wish you the best.

Built in Tallahassee · courtsense.app
```

### HTML body (when reason is blank)

```
[navy accent bar]

Hi {applicant_name},

Thanks so much for applying to CourtSense Pickup. Unfortunately we weren't able to approve your application at this time.

We appreciate your interest and wish you the best.

Built in Tallahassee · courtsense.app
```

### Plain-text fallback (when reason is provided)

```
Hi {applicant_name},

Thanks so much for applying to CourtSense Pickup. Unfortunately we weren't able to approve your application at this time.

{decline_reason}

We appreciate your interest and wish you the best.

Built in Tallahassee · courtsense.app
```

### Plain-text fallback (when reason is blank)

```
Hi {applicant_name},

Thanks so much for applying to CourtSense Pickup. Unfortunately we weren't able to approve your application at this time.

We appreciate your interest and wish you the best.

Built in Tallahassee · courtsense.app
```

---

## Merge field reference

### Player-facing event tokens (Templates 1-3)

| Token | Format | Example |
|-------|--------|---------|
| `{event_name}` | string | `Sunday Pickup at Tom Brown` |
| `{host_name}` | string | `Mark` |
| `{day_of_week}` | string | `Sunday` |
| `{date_long}` | string | `April 27, 2026` |
| `{date_short}` | string | `Apr 27` |
| `{time}` | string | `8:00 PM` |
| `{location}` | string | `Tom Brown Park, Court 3` |
| `{slot_count}` | integer | `12` |
| `{deadline_relative}` | string via `Intl.RelativeTimeFormat` | `in 3 hours`, `in 2 days` |
| `{deadline_absolute}` | string | `Sun 4/27 at 6:00 PM` |
| `{opt_in_link}` | URL, single-use magic link (deferred to N.8, plain deep link for v1) | `https://courtsense.app/rsvp?invite=...&action=opt_in&u=...` |
| `{decline_link}` | URL, single-use magic link (deferred to N.8) | `https://courtsense.app/decline?invite=...&action=decline&u=...` |
| `{drop_out_link}` | URL, valid until event start | `https://courtsense.app/drop?invite=...&action=drop&u=...` |

### Admin notification tokens (Template 4)

| Token | Format | Example |
|-------|--------|---------|
| `{applicant_name}` | string | `Jane Doe` |
| `{applicant_email}` | string | `jane@example.com` |
| `{applicant_phone}` | string | `555-555-5555` |
| `{truvolley_name}` | string, may be empty | `jane.doe` or empty |
| `{referrer}` | string, may be empty | `Mark McNees` or empty |
| `{notification_opt_in}` | string | `Yes` or `No` |
| `{submitted_at}` | string | `Apr 27 at 7:23 PM` |
| `{admin_review_link}` | URL, deep links into admin queue | `https://courtsense.app/admin-players.html?id={registrationId}` |

### Welcome tokens (Template 5)

| Token | Format | Example |
|-------|--------|---------|
| `{player_name}` | string | `Jane` |

### Decline tokens (Template 6)

| Token | Format | Example |
|-------|--------|---------|
| `{applicant_name}` | string | `Jane` |
| `{decline_reason}` | string, optional. Worker selects template variant based on whether this field is populated. | `We're at capacity for the spring season and will reopen applications in fall.` or empty |

---

## Implementation notes

- All event-action magic links are single-use except `{drop_out_link}`, which stays valid until event start so a confirmed player can pull out at any time. Token minting deferred to N.8 per D.36; v1 ships plain deep links.
- The reminder Worker should set `reminderSent: true` on the event-attendee record after queuing, to prevent double-sends if cron lags.
- The waitlist promo writes synchronously inside the same transaction that promotes the player, so the email queue entry and the status flip can't get out of sync.
- The decline template has two variants (with reason / without reason). Worker chooses based on `decline_reason` field presence.
- Admin notification deep-links to `admin-players.html` with the registration ID as a query param so Mark lands on the right applicant without scrolling.
- Per D.20, no SMS, no web push. In-app banner plus email is the full notification surface.
- Rate limit per N.5: 5 invite-creates per host per minute. Reminder cron, waitlist promos, admin notifications, welcomes, and declines are system-triggered and not rate-limited.

---

## Testing checklist

Before flipping the Worker live:

### Player-facing templates (1, 2, 3, 5, 6)
- [ ] Send each to a Gmail account, an Apple Mail account, and an Outlook account. Verify navy bar renders, button works, dark mode doesn't break the layout.
- [ ] Verify magic-link-style URLs resolve correctly when tapped from each client.
- [ ] Verify plain-text fallback fires when HTML is disabled.
- [ ] Verify `{deadline_relative}` renders accurately for 1 hour, 12 hours, 2 days out.

### Reminder logic (Template 2)
- [ ] Verify reminder does NOT send to confirmed RSVPs or waitlisters.
- [ ] Verify `reminderSent` flag prevents double-sends across cron cycles.

### Waitlist logic (Template 3)
- [ ] Verify waitlist promo fires within 1 minute of an auto-promotion event.
- [ ] Verify drop-out link from waitlist promo email correctly drops the player and promotes the next person.

### Admin notification (Template 4)
- [ ] Send to Mark's email. Verify subject is scannable on a phone lock screen.
- [ ] Verify admin review link deep-links to the right applicant.
- [ ] Verify it does NOT include navy bar, button, or footer (utilitarian only).

### Welcome (Template 5)
- [ ] Approve a test registration. Verify welcome email lands in the new player's inbox within 1 minute.
- [ ] Verify "Browse upcoming events" button routes to `/kotb-pickup`.

### Decline (Template 6)
- [ ] Reject a test registration WITH a reason. Verify reason line appears.
- [ ] Reject a test registration WITHOUT a reason. Verify the reason line is fully omitted (not "Reason: " with empty value).
- [ ] Reject a test registration WITHOUT the "send decline email" checkbox enabled. Verify NO email fires.
