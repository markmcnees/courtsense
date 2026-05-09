# CC Brief: Player profile editor + invite flow

## Context

CourtSense currently has a minimal player record. Registration captures Name, Email, Phone, TruVolley name, Referrer, and Notifications. Nothing else. Once a player is registered, there's no way for them to add more details about themselves.

We want two things:

1. **A profile editor** in `/community` where players can fill in optional details about themselves (height, jump touches, beach side preferences, skill level, zip code, cross-system rating IDs, etc.).

2. **A text-invite flow** where Mark can generate a shareable URL from admin-players.html, text it to a player, and the recipient lands on the join form with their name pre-filled.

## Scope of this session

- Database schema changes for the profile fields and the invites collection.
- Profile editor UI in `/community/profile`.
- Post-registration redirect to `/community/profile` (skippable).
- "Send Invite" button in admin-players.html that generates a shareable URL.
- Join form handling of `?invite={code}` query parameter (pre-fills name, marks the invite as used after submission).

## Out of scope

- Changing the existing registration fields. Join form keeps the same Name/Email/Phone/TruVolley/Referrer/Notifications.
- Auto-approval of invited players. Invited players still flow through pending_registrations → admin approval → welcome email.
- Showing profile fields to other players. v1 is private to the player + admin only.
- Pulling rating data from TruVolley or AVP APIs. We just store the IDs as text.

## Profile editor fields

All optional. All editable from `/community/profile`. Stored under each player's record at `tally_kotb_pickup/players/{playerKey}/profile/`.

**Cross-system IDs**
- `truvolleyRankingNumber` (string, optional)
- `avpNumber` (string, optional)

**Skill & location**
- `skillLevel` (enum: 'BB' | 'A' | 'AA' | 'Open' | null)
- `zipCode` (string, optional, validated as 5 digits)

**Physical**
- `height` (string, e.g. "6'2\"")
- `dominantHand` (enum: 'Left' | 'Right' | 'Ambidextrous' | null)
- `reach` (string, e.g. "8'")
- `blockJumpTouch` (string, e.g. "9'3\"")
- `approachJumpTouch` (string, e.g. "9'5\"")

**Beach preferences**
- `usualSide` (enum: 'Left' | 'Right' | null)
- `preferredSide` (enum: 'Left' | 'Right' | null)
- `usualDefense` (enum: 'Block' | 'Defend' | null)
- `preferredDefense` (enum: 'Block' | 'Defend' | null)

**Other surfaces**
- `indoorExperience` (boolean)
- `grassExperience` (boolean)

## Profile editor UI

- Lives at `/community/profile` (or accessible from `/community` via a "Profile" link).
- Single page form. Sections for Cross-system IDs, Skill & location, Physical, Beach preferences, Other surfaces.
- Mobile-friendly. Phone-first layout.
- Save button writes to Firebase via fire-and-forget pattern (`db.ref(...).set(...)`, no await).
- All fields optional. Empty values are stored as null, not empty strings.
- Page also shows the player's existing CourtSense rating (read-only, pulled from `tally_kotb_pickup/ratings/{playerKey}`).
- Top of page: "Skip for now" button (visible only on first visit immediately after registration). On click, sets a `profileSkipped: true` flag in localStorage and redirects to `/community`.

## Post-registration redirect

After a player is approved (either via public join form or invite link), the welcome email's CTA links them to `/community/profile?firstTime=1`.

When `/community/profile` loads with `?firstTime=1`, it shows:
- A welcome banner: "Welcome to CourtSense. Tell us a bit about yourself to get matched into the right games and partners."
- The "Skip for now" button (otherwise hidden on subsequent visits).

## Invite flow

### Schema

```
tally_kotb_pickup/invites/{inviteCode}/
  name: string          (the pre-filled name)
  createdBy: string     (admin user, default 'mark')
  createdAt: number     (timestamp)
  used: boolean         (default false)
  usedAt: number | null
  usedBy: string | null (player record key after submission)
```

`inviteCode` is a 12-character random string (alphanumeric, lowercase). No expiration. Single-use enforced via `used` flag.

### admin-players.html "Send Invite" button

- New button next to existing "Reset Password" / "Approve" buttons.
- Click → modal pops up:
  - Field: "Player name" (required)
  - Submit button: "Generate invite link"
- On submit:
  - Generates a 12-char random code.
  - Writes to `tally_kotb_pickup/invites/{code}` with `name`, `createdBy: 'mark'`, `createdAt: Date.now()`, `used: false`.
  - Closes the modal and shows a result modal with:
    - The full URL (e.g. `https://courtsense.app/kotb-pickup/join?invite=abc123def456`)
    - A "Copy link" button
    - A "Done" button
- Mark copies the link and pastes it into a text to the player.

### Join form `?invite=` handling

- When `/kotb-pickup/join?invite={code}` loads:
  - Look up `tally_kotb_pickup/invites/{code}`.
  - If found AND `used: false`: pre-fill the Name field with `invite.name`. Show a small note: "Invited by Mark." Lock the Name field as read-only.
  - If found AND `used: true`: show an error page: "This invite link has already been used. If you need a new one, reach out to Mark."
  - If not found: ignore the param, show the regular join form.
- On successful submission of an invite-linked join form:
  - Mark the invite as used: `tally_kotb_pickup/invites/{code}/used = true`, `usedAt = Date.now()`, `usedBy = pendingRegistrationKey`.
  - Submit pending_registration as usual.

## Welcome email update

- The welcome email template's CTA URL needs to change from `/community` to `/community/profile?firstTime=1`.
- This is a one-line change in the email worker template.

## Acceptance criteria

After this session ships:
1. A new player can register via the public join form, get approved, receive a welcome email, click the link, land in `/community/profile`, see a welcome banner, and either fill out their profile or skip it.
2. Mark can open admin-players.html, click "Send Invite", enter a name, get a shareable URL, paste it into a text, and the recipient lands on the join form with their name pre-filled.
3. A used invite link, when revisited, shows the "already used" error.
4. An existing player (already registered, no profile data) can navigate to `/community/profile` directly and fill out their profile fields.
5. Saved profile data persists in Firebase under `tally_kotb_pickup/players/{key}/profile/` and round-trips correctly on page refresh.

## Implementation notes

- Use the existing auth pattern (sessionStorage `courtsenseAuth`, bcrypt). Don't reinvent.
- Single HTML file pattern for the new pages. Inline JS, no build tools.
- Fire-and-forget Firebase writes. No awaits.
- No em dashes anywhere in user-facing copy.
- All new files should land in the `courtsense` repo, not beach-app-core.
- Test with at least one real registration end-to-end before declaring done.

## Open questions for Mark to decide before implementation

None. Spec is fully locked.
