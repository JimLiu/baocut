# Updates and version consistency

`bin/baocut` below means `"$BAOCUT_SKILL_ROOT/bin/baocut"`. One marketing
version covers the BaoCut App, the CLI, and this skill, so a healthy install
reports the same number everywhere. Run this check once at the start of every
BaoCut task, before capability preflight or reuse of `bcut serve`. An offline
or failed appcast request is reported as skipped, not as an error; a successful
check that finds a newer release must update the CLI before work continues.

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

On Windows PowerShell:

```powershell
$resolver = "$env:BAOCUT_SKILL_ROOT\bin\baocut.ps1"
$skillText = Get-Content -Raw "$env:BAOCUT_SKILL_ROOT\SKILL.md"
$skillVersion = [regex]::Match(
    $skillText, '(?m)^\s+version:\s*["'']?([^"''\r\n]+)'
).Groups[1].Value.Trim()
$minAppVersion = [regex]::Match(
    $skillText, '(?m)^\s+minAppVersion:\s*["'']?([^"''\r\n]+)'
).Groups[1].Value.Trim()
$cli = (& $resolver --json version | ConvertFrom-Json)
$cliAppVersion = $cli.appVersion
```

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

On Windows PowerShell:

```powershell
try {
    $appcast = Invoke-RestMethod -TimeoutSec 10 -Uri `
        "https://github.com/JimLiu/baocut/releases/latest/download/skill-appcast.json"
} catch {
    $appcast = $null
}
if ($null -ne $appcast -and $appcast.schema -ne 1) {
    throw "unsupported appcast schema"
}
```

`$null` means the check was skipped. Otherwise use `$appcast.version`,
`$appcast.url`, `$appcast.sha256`, and `$appcast.cli.version`.

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

On Windows PowerShell:

```powershell
function Test-VersionGreater([string]$A, [string]$B) {
    $left = $A -split '[.-]'
    $right = $B -split '[.-]'
    for ($i = 0; $i -lt 3; $i++) {
        $x = if ($i -lt $left.Count) { [int]$left[$i] } else { 0 }
        $y = if ($i -lt $right.Count) { [int]$right[$i] } else { 0 }
        if ($x -gt $y) { return $true }
        if ($x -lt $y) { return $false }
    }
    return $false
}
```

## 4. Decide

- Appcast `cli.version` newer than the local CLI `appVersion` → a newer CLI is
  published. For a standalone install, update the skill immediately so its
  refreshed resolver downloads that CLI. For an App-bundled install, update
  the App. In a development checkout, report the gap and update/rebuild from
  source; never replace the checkout with the release tarball.
- Appcast `version` newer than `metadata.version` → this skill is outdated.
  For a standalone install, apply the update below immediately; do not merely
  offer it and continue on the old compatible CLI.
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
files under `$BAOCUT_SKILL_ROOT` is part of the mandatory startup gate; do it
without waiting for a second confirmation unless the user explicitly disabled
updates. Preserve the development-checkout and App-bundled exceptions below.

On macOS/Linux:

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

On Windows PowerShell, use the same appcast `url` and `sha256` values. The
native resolver downloads the pinned Windows CLI when the final version check
runs:

```powershell
$ErrorActionPreference = "Stop"
$url = "<appcast url>"
$sha256 = "<appcast sha256>"
$skillRoot = (Resolve-Path $env:BAOCUT_SKILL_ROOT).Path
$parent = Split-Path -Parent $skillRoot
$name = Split-Path -Leaf $skillRoot
$work = Join-Path ([IO.Path]::GetTempPath()) ("baocut-update-" + [guid]::NewGuid())
$archive = Join-Path $work "skill.tgz"
$new = Join-Path $parent ".$name.new"
$old = Join-Path $parent ".$name.old"

New-Item -ItemType Directory -Path $work | Out-Null
try {
    Invoke-WebRequest -Uri $url -OutFile $archive -TimeoutSec 300
    $got = (Get-FileHash -Algorithm SHA256 $archive).Hash.ToLowerInvariant()
    if ($got -ne $sha256.ToLowerInvariant()) { throw "checksum mismatch" }
    tar -xzf $archive -C $work
    $extracted = Join-Path $work "baocut"
    if (-not (Test-Path (Join-Path $extracted "SKILL.md"))) {
        throw "archive is missing baocut/SKILL.md"
    }

    Remove-Item -LiteralPath $new -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $old -Recurse -Force -ErrorAction SilentlyContinue
    Move-Item -LiteralPath $extracted -Destination $new
    Move-Item -LiteralPath $skillRoot -Destination $old
    try {
        Move-Item -LiteralPath $new -Destination $skillRoot
    } catch {
        Move-Item -LiteralPath $old -Destination $skillRoot
        throw
    }
    Remove-Item -LiteralPath $old -Recurse -Force
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

& "$env:BAOCUT_SKILL_ROOT\bin\baocut.ps1" --json version
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

## 7. Restart the preview service after a CLI update

After the refreshed resolver reports the new CLI, always run the shared
service through that resolver. `serve --background` safely takes over an older
same-root process and restores persisted mounts; do not kill a PID or port by
hand.

On macOS/Linux:

```bash
bin/baocut serve --background --json
status=$(bin/baocut serve --status)
cli=$(bin/baocut --json version)
STATUS_JSON="$status" CLI_JSON="$cli" python3 -c '
import json,os
s=json.loads(os.environ["STATUS_JSON"])
v=json.loads(os.environ["CLI_JSON"])
assert s.get("running") is True
assert (s.get("appVersion"), s.get("commit")) == (v["appVersion"], v["commit"])
print(s["url"])'
url=$(printf '%s' "$status" | python3 -c 'import json,sys; print(json.load(sys.stdin)["url"])')
curl -fsS "${url}__bcut/healthz" >/dev/null
```

On Windows PowerShell:

```powershell
$resolver = "$env:BAOCUT_SKILL_ROOT\bin\baocut.ps1"
& $resolver serve --background --json
$status = (& $resolver serve --status | ConvertFrom-Json)
$cli = (& $resolver --json version | ConvertFrom-Json)
if (-not $status.running -or
    $status.appVersion -ne $cli.appVersion -or
    $status.commit -ne $cli.commit) {
    throw "bcut serve did not restart on the refreshed CLI"
}
Invoke-WebRequest -UseBasicParsing "$($status.url)__bcut/healthz" | Out-Null
```

Discard any preview URL captured before the restart and use the URL from the
new status. If the service reports `serverNewer`, keep the newer service and
update the local App/CLI instead of downgrading it.

## When to run the check

Run it once at the start of every BaoCut task, before capability preflight.
Repeat it when the user asks about versions or updates or when the resolver
handshake fails. Compatibility alone never proves that no newer CLI exists;
only an unavailable appcast permits a skipped check.
