# CC Brief: "Split" defense option + Change Password feature

## Context

The /community/profile page is now live in production after PR #6. Two follow-up improvements:

1. The "Usual Defense" and "Preferred Defense" dropdowns currently offer Block / Defend. Real beach volleyball players sometimes split (do both depending on the partner / situation). Players need a third option.

2. Currently the only way for a player to get a new password is for an admin (Mark) to click "Reset Password" in admin-players.html. Players can't change their own password. /community/index.html already has a "Change Password" header in the profile modal, but it may not be wired up. This brief addresses both: verifying/wiring the existing modal AND adding a redundant Change Password section in /community/profile/index.html.

## Scope of this session

Two distinct tasks, both in the courtsense repo (no email-worker repo work yet — see Task 2 below).

### Task 1: Add "Split" to Usual/Preferred Defense

In `community/profile/index.html`:
- Find the `<select>` for `usualDefense`. It currently has options: empty placeholder + Block + Defend.
- Add a third option: `<option value="Split">Split</option>`
- Same change for `preferredDefense`.
- Save value 'Split' is stored as the string "Split" in `tally_kotb_pickup/players/{key}/profile/usualDefense` (and preferredDefense).

That's it. Two lines added. No backend changes.

### Task 2: Change Password feature

#### Where it lives

Two locations, both functional:

**Location A: Existing modal in `community/index.html`.**

The /community subhub already has a profile modal with a "Change Password" header (introduced in PR #2 / community subhub merge). Inspect the modal's current state:
- If the Change Password form is present and wired up: confirm it works end-to-end and document any issues.
- If the form is partially built (header but no form fields, or fields but no submit handler): finish wiring it up so it works.
- If no infrastructure exists beyond the header: add full form fields and submit handler.

Either way, the result should be: from /community, a logged-in user clicks "My Profile" → modal opens → sees a "Change Password" section → enters current password + new password (twice) → submits → password updates with toast.

**Location B: New section in `community/profile/index.html`.**

Add a new section card at the bottom of the profile editor page, below "Other Surfaces":
- Section header: "Change Password"
- Three fields: Current password, New password, Confirm new password
- Submit button: "Change Password"
- After successful submit: toast "Password updated"

This is a redundant path. Either /community modal OR /community/profile section works. Player can use whichever they're more comfortable with.

#### Logic (same for both locations)

Validation (client-side):
- All three fields required
- New password must be at least 6 characters
- New password must match Confirm new password
- New password must NOT equal Current password (catches no-op submissions)
- If validation fails: show inline error message under the form, do not submit

Submit flow:
1. Read current password from form
2. Verify against the player's existing `passwordHash` using bcrypt.compareSync
3. If mismatch: show error "Current password is incorrect", do not submit
4. If match: hash the new password using bcrypt.hashSync (cost 10, same as elsewhere)
5. Write new hash to `tally_kotb_pickup/players/{playerKey}/passwordHash`
6. Update `tally_kotb_pickup/players/{playerKey}/updatedAt` to Date.now()
7. Show toast: "Password updated"
8. Queue a confirmation email in `tally_kotb_pickup/email_queue/{generatedKey}` (see schema below)
9. Clear the form fields

Use the same bcryptjs library and pattern that auth.js + admin-players.html use (cost 10).

#### Confirmation email schema

Queue an email with:

```
type: 'password_changed'
to: <player email from player record>
data: {
  player_name: <player name from player record>
  player_email: <player email from player record>
  changed_at_iso: <new Date(Date.now()).toISOString()>
}
relatedRegistration: null
status: 'queued'
createdAt: Date.now()
```

Generated key uses the same pattern as other producers:
'em' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)

Important: this brief does NOT modify the email worker. The new `type: 'password_changed'` is queued but the worker will treat it as `skipped_unsupported` until the worker template is added in a follow-up session.

This is intentional. Reasons:
- Keep the courtsense repo PR isolated from email-worker repo changes
- The audit-trail value of "password was changed at X time" exists in Firebase regardless of email delivery (admin can review email_queue if needed)
- If we later want to actually deliver the email, that's one welcome-email-style addition to the worker template + deploy

Treat this as: the data is captured now, the email itself ships in a separate follow-up. Confirm in the PR description that the worker will skip these emails until updated.

Edge cases to handle:

- Bcrypt compareSync of empty string vs hash: should fail validation, show "Current password is incorrect" cleanly. Don't crash.
- Race condition where the player record gets updated mid-submission: not worth handling. Last-write-wins is fine.
- Player record missing email field: queue the email anyway. The worker drain will handle bad payloads (likely skipping it as malformed). Don't block password change just because email is missing.
- Player record missing passwordHash: should be impossible given they're logged in. If somehow this happens, show error "Account state issue, contact admin" and don't proceed.

## Acceptance criteria

After this session ships:

1. `/community/profile` defense dropdowns show three options: Block, Defend, Split.
2. Selecting Split saves correctly to Firebase. Refreshing the page shows Split persisted.
3. From `/community`, logged-in user can open profile modal, see Change Password section, enter current + new passwords, submit, see toast, and the new password works for next login.
4. From `/community/profile`, logged-in user can scroll to Change Password section, enter current + new passwords, submit, see toast, and the new password works for next login.
5. Both paths reject invalid inputs with clear inline errors (wrong current password, mismatched new passwords, length under 6, new password equals current).
6. Each successful password change creates a `tally_kotb_pickup/email_queue/{key}` item with `type: 'password_changed'` (worker will skip these until template is added — that's expected for now).

## Implementation notes

- Single HTML file pattern, vanilla JS, no build tools
- Fire-and-forget Firebase writes
- bcryptjs from CDN (cost 10), same as auth.js
- No em dashes anywhere in user-facing copy
- Test by:
  - Changing your own password (mark_mcnees) on /community/profile
  - Logging out
  - Logging back in with the new password
  - Verify email_queue has a `type: 'password_changed'` item with correct schema
  - Verify the Split option saves and persists

## Open questions for Mark to decide before implementation

None. Spec is fully locked. Hold for code review on the diff per task before applying.
