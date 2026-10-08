import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ensure = (ok, message) => { if (!ok) throw new Error(message); };
export function parseReleaseTag(tag) {
  const match = /^baocut-v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))-build\.([1-9]\d*)$/.exec(tag || '');
  ensure(match, 'Release tag must be baocut-v<MAJOR>.<MINOR>.<PATCH>-build.<BUILD>, without leading zeros');
  const build = Number(match[2]);
  ensure(Number.isSafeInteger(build) && match[1].split('.').every((n) => Number.isSafeInteger(Number(n))), 'Version or build is out of range');
  return { tag, version: match[1], build };
}

export function validateTagVersion(tag, versions, feeds) {
  const identity = parseReleaseTag(tag);
  ensure(versions.length > 0 && versions.every((version) => version === identity.version), 'Tag version differs from package.json or lockfile');
  for (const feed of feeds) {
    ensure(identity.build > feed.build, 'Release build must increase across all platform update feeds');
    const current = feed.version.split('.').map(Number);
    const next = identity.version.split('.').map(Number);
    const first = next.findIndex((value, i) => value !== current[i]);
    ensure(first === -1 || next[first] > current[first], 'Release version must not go backwards');
  }
  return identity;
}

export function validateReleaseRef(ref, tag) {
  parseReleaseTag(tag);
  ensure(ref === 'refs/heads/main' || ref === `refs/tags/${tag}`, 'Release ref differs from the candidate tag');
}

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  ensure(result.status === 0, `git failed: ${result.stderr}`);
  return result.stdout.trim();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    ensure(process.env.GITHUB_REPOSITORY === 'JimLiu/baocut' && process.env.GITHUB_EVENT_NAME === 'push', 'Automatic releases require a tag push in the owning repository');
    const ref = process.env.GITHUB_REF;
    ensure(ref?.startsWith('refs/tags/'), 'A release tag is required');
    const tag = ref.slice('refs/tags/'.length);
    const root = JSON.parse(readFileSync('package.json', 'utf8'));
    const desktop = JSON.parse(readFileSync('apps/desktop/package.json', 'utf8'));
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
    git(['fetch', 'origin', 'main']);
    const source = git(['rev-parse', 'HEAD']);
    ensure(source === git(['rev-parse', `${tag}^{commit}`]), 'Tag and checked-out source differ');
    git(['merge-base', '--is-ancestor', source, 'origin/main']);
    const feeds = ['appcast-aarch64-apple-darwin.json', 'appcast-x86_64-pc-windows-msvc.json',
      'appcast-x86_64-pc-windows-msvc-cuda.json', 'appcast-x86_64-pc-windows-msvc-vulkan.json']
      .map((name) => JSON.parse(git(['show', `origin/main:apps/desktop/releases/${name}`])));
    const identity = validateTagVersion(tag, [root.version, desktop.version, lock.version, lock.packages[''].version, lock.packages['apps/desktop'].version], feeds);
    ensure(source === process.env.GITHUB_SHA, 'Workflow and product source differ');
    const download = `https://github.com/jimliu/baocut/releases/download/${tag}`;
    appendFileSync(process.env.GITHUB_OUTPUT, `tag=${tag}\nversion=${identity.version}\nbuild=${identity.build}\nsource_commit=${source}\ndownload_base_url=${download}\n`);
    console.log(`Validated ${tag} at ${source}; all platform builds must pass before publication.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
