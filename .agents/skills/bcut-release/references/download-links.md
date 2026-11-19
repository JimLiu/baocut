# Download links

A release needs no download-link edits. Both READMEs ("Download and install" and
「下载与安装」) and baocut.com link to `https://baocut.com/download/<id>`. The
`baocut-portal` Worker redirects each id to the newest published release that has
that platform's files, on the site's mirror
(`https://baocut.com/releases/download/<tag>/<file>`, the same path as on GitHub).
The update feeds point at GitHub Releases, not the mirror; the app falls back to
the mirror itself. A cron trigger copies the newest two
releases from GitHub into R2 every 10 minutes; until a file is copied, the mirror
redirects to GitHub, so nothing breaks right after publishing. Do not edit the READMEs, rebuild or redeploy the site for a
release. Only verify that the site picked it up.

## How the site picks a release

The Worker reads the latest five GitHub Releases. It ignores GitHub's Latest flag,
drafts, prereleases and tags other than `baocut-v<VERSION>-build.<BUILD>`.

For each platform it uses the newest release whose installer and ZIP are both
uploaded. So Windows keeps pointing at the previous release until its files are
appended, and a variant that failed or stayed unpublished keeps its older links.
If none of the five releases has a platform, the snapshot from the last deploy
covers it. That snapshot is built from the feeds in `apps/desktop/releases/`.

Requests never wait on GitHub. The Worker answers from memory, the per-colo cache
or the snapshot, and refreshes data older than 5 minutes in the background.
[apps/portal/README.md](../../../../apps/portal/README.md) has the details.

| Download id | Asset suffix after `BaoCut-<VERSION>-build.<BUILD>` |
| --- | --- |
| `mac-dmg` / `mac-zip` | `-aarch64-apple-darwin.dmg` / `-aarch64-apple-darwin.zip` |
| `win-setup` / `win-zip` | `-win-x64-setup.exe` / `-win-x64.zip` |
| `win-cuda-setup` / `win-cuda-zip` | `-win-x64-cuda-setup.exe` / `-win-x64-cuda.zip` |
| `win-vulkan-setup` / `win-vulkan-zip` | `-win-x64-vulkan-setup.exe` / `-win-x64-vulkan.zip` |

## Verify

Run this after every public release or platform continuation, once the selected
publishers succeeded and the public downloads were read back. Skip it for
local-only candidates.

```bash
curl -s https://baocut.com/api/release
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://baocut.com/download/mac-dmg
```

- `/api/release` must report the new version and build.
- Every published download id must redirect to this release's file and return
  200 after redirects.
- About 10 minutes after the assets are public, the mirror serves them itself:
  `curl -sI https://baocut.com/releases/download/<tag>/<file>` returns 200 with
  `Accept-Ranges: bytes`, not 302. If it still redirects, read the Worker's
  `mirror` log entries (`failed`, `deferred`).
- Unpublished variants must still redirect to their previous, working release.

The site normally follows within about 5 minutes. The first request after that
may still get the old answer while the Worker refreshes, so request again.

If the site is still stale after 10 minutes, the Worker cannot use the new
release. Its `github-releases` log entries say why. Each one records `status`,
`limit`, `remaining`, `token` and the build found per platform. Read them in
Workers Logs on the Cloudflare dashboard, or live with
`npx --yes wrangler@4.144.0 tail --config apps/portal/wrangler.jsonc --format pretty`
while requesting the site. Causes:

- The GitHub API is unreachable or rate-limited. With the `GITHUB_TOKEN` secret
  the limit is 5000 requests per hour. Without it the limit is 60 per hour per
  shared egress IP. `limit: 60` with `token: true`, or status 401, means the token
  expired or was revoked. The user must replace it.
- The release fails `apps/portal/src/release.ts` validation. It must be published,
  not a prerelease. The tag and asset names must match the version and build.
- An asset is not in the uploaded state.

Fix the cause. A redeploy does not help, because it only refreshes the fallback
snapshot.

## When the site or READMEs do need a change

- A new platform variant, download id or asset naming rule: update
  `apps/portal/src/release.ts`, the site's download cards and both READMEs'
  tables together.
- Changed platform requirements: update the row descriptions in both READMEs.

Deploying (`npm run deploy -w @baocut/portal`) and setting the Worker's secret
are production changes. Do them only when the current task authorizes it. Never
touch the unrelated `baocut-site` Worker, which serves baocut.app.

## Report

Include:

- The version and build shown by `https://baocut.com/api/release`.
- The download ids checked and their results.
- Any platform that intentionally still points to an older release.
