# Git hooks

Hooks live in `.git/hooks/`, which git does not track. A fresh clone gets none of
them. The copies here are the tracked source of truth. Install them by hand once per
clone.

## Install

```bash
cp scripts/hooks/pre-push .git/hooks/pre-push
chmod +x .git/hooks/pre-push
```

Verify:

```bash
ls -l .git/hooks/pre-push        # should exist and be executable
```

To remove it:

```bash
rm .git/hooks/pre-push
```

To push once without it:

```bash
git push --no-verify
```

## pre-push

Keeps the `?v=` cache-buster stamps current on the same-repo script tags.

`auth.js`, `ratings.js`, `identity.js`, `nav.js`, `kotb-app.js`, and
`cs-config-gen.js` ship by a plain push to this repo, not by `deploy.sh`. Without a
stamp that moves when the file moves, a browser keeps serving a stale copy after a
change ships.

The stamp is the first 8 characters of the script's own git blob hash. It is not a
commit SHA: a commit cannot contain its own short SHA, and a commit-based stamp would
loop, since the follow-up stamp commit shifts HEAD and the hook would want to restamp
forever. A content hash is idempotent and changes only when that script's bytes
change, so editing `kotb-app.js` does not needlessly bust the cache on pages that
only load `nav.js`.

### What it does on a push

1. Bails immediately if the working tree or index is dirty. Work in progress is never
   folded into a stamp commit, and the tree is never left dirty afterward, because
   `deploy.sh` runs `git pull --rebase` here and a dirty tracked tree aborts it
   mid-run.
2. Reads the refs being pushed and checks whether any watched script changed in that
   range. If none did, it exits silently and the push proceeds.
3. Rewrites `?v=` on the matching tags in tracked HTML.
4. If nothing actually moved, the stamps were already current, so the push proceeds.
5. Otherwise it stages only the files it rewrote, by explicit path, commits them as
   `Refresh script cache-buster stamps`, and stops the push with a message telling
   you to push again. The second push carries both commits and passes straight
   through, because the stamps now match.

### What it never touches

- `/app.js?v=` references. `deploy.sh` owns those stamps. Two writers fighting over
  one string is worse than no hook.
- `onboard/index.html`. Line 691 is a generator template, not a live tag. Stamping it
  would bake a fixed version into every school shell it writes from then on.
- Anything untracked, including `node_modules/` and `04_Recovery/`. It only ever
  rewrites files returned by `git ls-files`.

### If it cannot do its job

Every failure path exits 0 and lets the push proceed: no repo root, dirty tree,
unreadable ref list, missing script file, failed hash, failed `sed`, nothing staged.
If the commit itself fails it runs `git reset --hard HEAD` first so the push does not
leave a dirty tree behind, then exits 0.

The one non-zero exit is deliberate, not a failure: stamps were refreshed and
committed, so push again.
