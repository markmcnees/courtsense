# CourtSense Pickup Email Templates

Templates for N.4: invite, 24-hour reminder, waitlist promotion.

Owned by the Cloudflare Worker that drains `tally_kotb_pickup/email_queue/` and dispatches via Resend.

---

## Shared spec

- **From:** `CourtSense <noreply@courtsense.app>` (adjust to whatever sending domain Resend is verified for)
- **Layout:** text-only body with a navy accent bar at top, no logo image
- **Navy:** `#1a3a6b` (matches Kings primary and root landing page)
- **Action buttons:** single primary action per email, navy fill, white text, rounded corners
- **Plain-text fallback:** included for every HTML email so clients without HTML rendering still work
- **Merge tokens:** anything in `{curly_braces}` is a field the Worker fills before send
- **Footer line:** `Built in Tallahassee · courtsense.app`

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

## Merge field reference

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
| `{opt_in_link}` | URL, single-use magic link | `https://courtsense.app/rsvp?t=...` |
| `{decline_link}` | URL, single-use magic link | `https://courtsense.app/decline?t=...` |
| `{drop_out_link}` | URL, valid until event start | `https://courtsense.app/drop?t=...` |

---

## Implementation notes

- All magic links are single-use except `{drop_out_link}`, which stays valid until event start so a confirmed player can pull out at any time.
- The reminder Worker should set `reminderSent: true` on the event-attendee record after queuing, to prevent double-sends if cron lags.
- The waitlist promo writes synchronously inside the same transaction that promotes the player, so the email queue entry and the status flip can't get out of sync.
- Per D.20, no SMS, no web push. In-app banner plus email is the full notification surface.
- Rate limit per N.5: 5 invite-creates per host per minute. Reminder cron and waitlist promos are system-triggered and not rate-limited.

---

## Testing checklist

Before flipping the Worker live:

- [ ] Send each template to a Gmail account, an Apple Mail account, and an Outlook account. Verify navy bar renders, button works, dark mode doesn't break the layout.
- [ ] Verify magic links resolve correctly when tapped from each client.
- [ ] Verify plain-text fallback fires when HTML is disabled.
- [ ] Verify `{deadline_relative}` renders accurately for 1 hour, 12 hours, 2 days out.
- [ ] Verify reminder does NOT send to confirmed RSVPs or waitlisters.
- [ ] Verify waitlist promo fires within 1 minute of an auto-promotion event.
- [ ] Verify drop-out link from waitlist promo email correctly drops the player and promotes the next person.
