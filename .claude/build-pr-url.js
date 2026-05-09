const title = 'Player profile editor + invite flow + welcome email URL update';
const body = `## Summary

Implements the player profile editor and invite flow per the brief (cc-brief-profile-and-invite.md). Five files change in this repo:

- \`community/profile/index.html\` (new) — auth-gated editor with 15 fields across 5 sections; reads/writes \`tally_kotb_pickup/players/{key}/profile/\`; fire-and-forget save; firstTime welcome banner backed by localStorage \`courtsenseProfileWelcomed\` flag (set on Skip OR on first meaningful Save); \`history.replaceState\` strips \`?firstTime=1\` after display so refresh doesn't re-show; read-only rating display from \`tally_kotb_pickup/ratings/{key}\`.
- \`community/index.html\` — adds an "Edit My Profile" link inside the existing profile modal (logged-in only).
- \`admin-players.html\` — page-level "Send Invite" button + input/result modals; 12-char alphanumeric code generator using crypto.getRandomValues; writes to \`tally_kotb_pickup/invites/{code}\`; Copy-link via navigator.clipboard with execCommand fallback; Escape and click-outside close the new modals.
- \`kotb-pickup/join/index.html\` — \`?invite={code}\` lookup on load: prefill+lock name with "Invited by Mark" note when valid and unused, or replace the form with "Invite Already Used" when used; the mark-used update rides in the same atomic batch as the pending_registrations + email_queue write.
- \`docs/email-templates.md\` — updates the welcome template URL spec and acceptance checklist to the new \`/community/profile?firstTime=1\` destination.

## Related deploy (separate repo, already live)

The \`courtsense-email-worker\` change that flips the welcome-email CTA URL has already been deployed to Cloudflare. Worker version: \`754716d6-e20a-49fb-9c58-15a90b87c43f\`. The worker's git changes (welcome.ts + wrangler.toml KV IDs) are NOT yet committed/pushed; they're being held until this PR merges and the production page is verified.

## Merge timing

This PR must merge BEFORE the next welcome email is sent. The deployed worker now points to \`/community/profile?firstTime=1\`, which 404s on production until this PR lands. Hold pending_registration approvals until merged.

## Acceptance criteria (from the brief)

- [ ] A new player can register via the public join form, get approved, receive a welcome email, click the link, land in /community/profile, see a welcome banner, and either fill out their profile or skip it.
- [ ] Mark can open admin-players.html, click "Send Invite", enter a name, get a shareable URL, paste it into a text, and the recipient lands on the join form with their name pre-filled.
- [ ] A used invite link, when revisited, shows the "already used" error.
- [ ] An existing player (already registered, no profile data) can navigate to /community/profile directly and fill out their profile fields.
- [ ] Saved profile data persists in Firebase under \`tally_kotb_pickup/players/{key}/profile/\` and round-trips correctly on page refresh.
`;
const url = 'https://github.com/markmcnees/courtsense/compare/main...feat/profile-and-invite-flow?quick_pull=1&title=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(body);
console.log(url);
