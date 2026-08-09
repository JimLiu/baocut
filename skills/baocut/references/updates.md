# Updates and version consistency

`bin/baocut` below means `"$BAOCUT_SKILL_ROOT/bin/baocut"`. One marketing
version covers the BaoCut App, the CLI, and this skill, so a healthy install
reports the same number everywhere. Never block editing work on an update
check: an offline or failed check is reported as skipped, not as an error.

## 1. Read the local identity

```bash
skill_md="$BAOCUT_SKILL_ROOT/SKILL.md"
meta() {
    sed -n "s/^[[:space:]]*$1:[[:space:]]*[\"']*\\([^\"']*\\)[\"']*[[:space:]]*$/\\1/p" \
        "$skill_md" | head -n 1
}
skill_version=$(meta version)          # metadata.version
min_app_version=$(meta minAppVersion)  # metadata.minAppVersion

cli_json=$(bin/baocut --json version 2>/tmp/baocut-resolver.log)
cli_app_version=$(printf '%s' "$cli_json" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["appVersion"])')
```

Both frontmatter values are indented and quoted, so a plain `grep '^version:'`
finds nothing — use the parse above, which mirrors the resolver's own.

`--json version` prints a flat object with no `data` envelope. Read
`appVersion`; it is the App/CLI marketing version. Ignore `version` — that
field is the Cargo placeholder and reads `0.1.0` on every build. `commit`
identifies the build.

The resolver announces its source on stderr. `development checkout detected
at <path>` means the workspace build was selected; a download note means the
pinned CLI was fetched. Classify the install in this order, because only the
last kind is updatable from a tarball:

1. Development checkout — the stderr note above, or this skill directory
   inside a BaoCut source tree.
2. Bundled in the App — `$BAOCUT_SKILL_ROOT` contains `BaoCut.app/Contents/`.
3. Standalone install — anything else, e.g. a plain skills directory.

Absence of `cli-release.json` does **not** identify a bundled copy; a
development checkout has none either.

## 2. Check the published appcast

```bash
appcast=$(curl -fsSL --max-time 10 \
    https://github.com/JimLiu/baocut/releases/latest/download/skill-appcast.json) \
    || appcast=
```

Empty output means the check was skipped — say so and continue. Otherwise
require `schema: 1` before trusting any field:

```bash
printf '%s' "$appcast" | python3 -c '
import json,sys
a = json.load(sys.stdin)
assert a.get("schema") == 1, "unsupported appcast schema"
print(a["version"], a["url"], a["sha256"], a["cli"]["version"])'
```

Top-level `version` / `url` / `sha256` describe the skill tarball
`baocut-skill-<version>.tgz`. The `cli` object is byte-identical to the
`cli-release.json` that tarball ships, so it is not a separate decision.

## 3. Compare numerically

Never string-compare: `1.0.10` sorts below `1.0.9` lexically, and macOS
`sort -V` is not dependable. This mirrors the resolver's comparison and exits
0 only when `$1` is strictly newer than `$2`:

```bash
version_gt() {
    awk -v a="$1" -v b="$2" 'BEGIN {
        split(a, x, /[.-]/); split(b, y, /[.-]/)
        for (i = 1; i <= 3; i++) {
            if (x[i] + 0 > y[i] + 0) exit 0
            if (x[i] + 0 < y[i] + 0) exit 1
        }
        exit 1
    }'
}
```

## 4. Decide

- Appcast `version` newer than `metadata.version` → this skill is outdated.
  Offer the update below.
- CLI `appVersion` older than `metadata.minAppVersion` → the resolver already
  handles this: it downloads the pinned CLI, or exits 3 with the manual URL.
  Follow its guidance; do not bypass the handshake.
- CLI `appVersion` newer than `metadata.version`, **standalone install only**
  → the skill is stale relative to the installed App. Refresh the skill; App
  installs already carry a matching copy inside BaoCut.app. In a development
  checkout this gap is normal mid-development — report it, do not act.
- Everything equal → versions are consistent; nothing to do.

## 5. Update a standalone skill install

Fetching the appcast and verifying a checksum need no permission. Replacing
files under `$BAOCUT_SKILL_ROOT` does — propose it and wait for a clear yes,
unless the user already asked for the update.

```bash
set -eu                 # required: every check below is a guard, not a hint
url=…; sha=…            # from the appcast
work=$(mktemp -d)
curl -fsSL --max-time 300 -o "$work/skill.tgz" "$url"
got=$(shasum -a 256 "$work/skill.tgz" | cut -d' ' -f1)
test "$got" = "$sha" || { rm -rf "$work"; echo "checksum mismatch" >&2; exit 1; }
tar -xzf "$work/skill.tgz" -C "$work"       # tar root is baocut/
test -f "$work/baocut/SKILL.md"

parent=$(dirname "$BAOCUT_SKILL_ROOT"); name=$(basename "$BAOCUT_SKILL_ROOT")
rm -rf "$parent/.$name.new" "$parent/.$name.old"   # stale staging would nest
mv "$work/baocut" "$parent/.$name.new"
mv "$BAOCUT_SKILL_ROOT" "$parent/.$name.old"
mv "$parent/.$name.new" "$BAOCUT_SKILL_ROOT"
rm -rf "$parent/.$name.old" "$work"

bin/baocut --json version
```

Keep `set -eu`: without it a failed extract still runs the swap, which moves
the old skill aside and then deletes it, leaving nothing installed. Delete the
archive on any checksum mismatch and stop. Extracting beside the target and
swapping means a failed download never leaves a half-replaced skill. Never
overwrite a development checkout — update it with git — or the copy bundled
inside BaoCut.app, which only App updates replace.

The final `--json version` confirms the CLI handshake against the new
`minAppVersion`. If the new skill requires a newer App, that command fetches
the pinned CLI or exits 3 — the update succeeded and the App needs updating
(section 6), so do not revert the swap. It also does not reload this session:
the SKILL.md in context is the old one; new instructions apply to later
invocations.

## 6. App and CLI updates

The CLI always moves with the App, so point the user at the BaoCut App
updater, or at the App appcast:

```
https://github.com/JimLiu/baocut/releases/latest/download/appcast.json
```

For a standalone install there is nothing separate to do: once the skill is
updated its new `cli-release.json` pins the matching CLI, and the resolver
fetches and caches it on the next command.

## When to run the check

Run it when the user asks about versions or updates, when the resolver
handshake fails, or opportunistically once per session during capability
preflight while the network is available. In every case it is advisory —
report the result and get on with the requested work.
