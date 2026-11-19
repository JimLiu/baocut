import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DOWNLOAD_IDS,
  FEED_FILES,
  FEED_IDS,
  downloadUrl,
  headlineRelease,
  newerReleases,
  parseFeed,
  parseReleases,
  preferredDownload,
  releaseSummary,
  type ReleaseSet,
} from './release.ts';

function feed(overrides: Record<string, unknown> = {}, url?: string) {
  return {
    schema: 1,
    target: 'aarch64-apple-darwin',
    variant: 'cpu',
    version: '3.2.0',
    build: 65,
    date: '2026-10-10',
    notes: '',
    notesLocalized: {},
    app: {
      format: 'zip',
      url:
        url ??
        'https://github.com/jimliu/baocut/releases/download/baocut-v3.2.0-build.65/BaoCut-3.2.0-build.65-aarch64-apple-darwin.zip',
      size: 1,
      sha256: 'a'.repeat(64),
    },
    ...overrides,
  };
}

describe('parseFeed', () => {
  it('reads version, build, date and tag', () => {
    expect(parseFeed(feed())).toEqual({ version: '3.2.0', build: 65, date: '2026-10-10', tag: 'baocut-v3.2.0-build.65' });
  });

  it('accepts the repository URL in any case', () => {
    const url =
      'https://github.com/JimLiu/baocut/releases/download/baocut-v3.2.0-build.65/BaoCut-3.2.0-build.65-win-x64-setup.exe';
    expect(parseFeed(feed({}, url))?.tag).toBe('baocut-v3.2.0-build.65');
  });

  it('accepts the same file on the baocut.com mirror', () => {
    const url = 'https://baocut.com/releases/download/baocut-v3.2.0-build.65/BaoCut-3.2.0-build.65-aarch64-apple-darwin.zip';
    expect(parseFeed(feed({}, url))?.tag).toBe('baocut-v3.2.0-build.65');
    expect(parseFeed(feed({}, 'https://baocut.com/download/baocut-v3.2.0-build.65/BaoCut-3.2.0-build.65-x.zip'))).toBeNull();
  });

  it('rejects URLs outside this repository or for another release', () => {
    expect(parseFeed(feed({}, 'https://example.com/releases/download/baocut-v3.2.0-build.65/BaoCut-3.2.0-build.65-x.zip'))).toBeNull();
    expect(
      parseFeed(
        feed({}, 'https://github.com/jimliu/baocut/releases/download/baocut-v3.1.0-build.62/BaoCut-3.2.0-build.65-x.zip'),
      ),
    ).toBeNull();
    expect(
      parseFeed(
        feed({}, 'https://github.com/jimliu/baocut/releases/download/baocut-v3.2.0-build.65/BaoCut-3.1.0-build.62-x.zip'),
      ),
    ).toBeNull();
    expect(
      parseFeed(
        feed({}, 'https://github.com/jimliu/baocut/releases/download/baocut-v3.2.0-build.65/nested/BaoCut-3.2.0-build.65-x.zip'),
      ),
    ).toBeNull();
  });

  it('rejects malformed manifests', () => {
    expect(parseFeed(null)).toBeNull();
    expect(parseFeed(feed({ schema: 2 }))).toBeNull();
    expect(parseFeed(feed({ version: '3.2' }))).toBeNull();
    expect(parseFeed(feed({ build: 0 }))).toBeNull();
    expect(parseFeed(feed({ date: 'yesterday' }))).toBeNull();
    expect(parseFeed(feed({ app: null }))).toBeNull();
  });

  it('reads every pinned feed in apps/desktop/releases', () => {
    for (const id of FEED_IDS) {
      const raw = JSON.parse(readFileSync(new URL(`../../desktop/releases/${FEED_FILES[id]}`, import.meta.url), 'utf8'));
      expect(parseFeed(raw), FEED_FILES[id]).not.toBeNull();
    }
  });
});

const SUFFIXES = {
  mac: ['-aarch64-apple-darwin.dmg', '-aarch64-apple-darwin.zip'],
  win: ['-win-x64-setup.exe', '-win-x64.zip'],
  'win-cuda': ['-win-x64-cuda-setup.exe', '-win-x64-cuda.zip'],
  'win-vulkan': ['-win-x64-vulkan-setup.exe', '-win-x64-vulkan.zip'],
};
const ALL_SUFFIXES = Object.values(SUFFIXES).flat();

/** GitHub「列出 Release」接口里的一项，只带用得到的字段。 */
function githubRelease(version: string, build: number, suffixes: string[], overrides: Record<string, unknown> = {}) {
  const tag = `baocut-v${version}-build.${build}`;
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    published_at: '2026-10-11T05:43:46Z',
    assets: [...suffixes, '-win-x64-setup.exe.sha256'].map((suffix) => {
      const name = `BaoCut-${version}-build.${build}${suffix}`;
      return { name, state: 'uploaded', browser_download_url: `https://github.com/JimLiu/baocut/releases/download/${tag}/${name}` };
    }),
    ...overrides,
  };
}

describe('parseReleases', () => {
  const full = { version: '3.3.0', build: 67, date: '2026-10-11', tag: 'baocut-v3.3.0-build.67' };

  it('takes each platform from the newest release whose files are all uploaded', () => {
    const releases = parseReleases([
      githubRelease('3.4.0', 68, [...SUFFIXES.mac, SUFFIXES.win[0]!]),
      githubRelease('3.3.0', 67, ALL_SUFFIXES),
      githubRelease('3.2.0', 65, ALL_SUFFIXES),
    ]);
    const mac = { version: '3.4.0', build: 68, date: '2026-10-11', tag: 'baocut-v3.4.0-build.68' };
    expect(releases).toEqual({ mac, win: full, 'win-cuda': full, 'win-vulkan': full });
    expect(headlineRelease(releases)).toEqual(mac);
  });

  it('ignores drafts, prereleases and other tags', () => {
    const skill = { ...githubRelease('3.3.0', 67, ALL_SUFFIXES), tag_name: 'skill-v1.1.4' };
    expect(
      parseReleases([
        githubRelease('3.5.0', 70, ALL_SUFFIXES, { draft: true, published_at: null }),
        githubRelease('3.4.0', 69, ALL_SUFFIXES, { prerelease: true }),
        skill,
      ]),
    ).toEqual({});
  });

  it('ignores unfinished uploads and files outside the release', () => {
    const open = githubRelease('3.4.0', 68, SUFFIXES.mac);
    open.assets[0]!.state = 'open';
    const elsewhere = githubRelease('3.4.0', 68, SUFFIXES.win);
    elsewhere.assets[0]!.browser_download_url = 'https://example.com/BaoCut-3.4.0-build.68-win-x64-setup.exe';
    const releases = parseReleases([open, elsewhere, githubRelease('3.3.0', 67, ALL_SUFFIXES)]);
    expect(releases.mac).toEqual(full);
    expect(releases.win).toEqual(full);
  });

  it('reads nothing from a malformed response', () => {
    expect(parseReleases({ message: 'API rate limit exceeded' })).toEqual({});
    expect(parseReleases([null, { tag_name: 'baocut-v3.3.0-build.67' }])).toEqual({});
  });
});

describe('downloads', () => {
  const release = { version: '3.2.0', build: 65, date: '2026-10-10', tag: 'baocut-v3.2.0-build.65' };
  const set: ReleaseSet = { mac: release, win: release, 'win-cuda': release, 'win-vulkan': release };

  it('derives every asset name of a release', () => {
    const base = 'https://baocut.com/releases/download/baocut-v3.2.0-build.65/BaoCut-3.2.0-build.65';
    expect(Object.fromEntries(DOWNLOAD_IDS.map((id) => [id, downloadUrl(set, id)]))).toEqual({
      'mac-dmg': `${base}-aarch64-apple-darwin.dmg`,
      'mac-zip': `${base}-aarch64-apple-darwin.zip`,
      'win-setup': `${base}-win-x64-setup.exe`,
      'win-zip': `${base}-win-x64.zip`,
      'win-cuda-setup': `${base}-win-x64-cuda-setup.exe`,
      'win-cuda-zip': `${base}-win-x64-cuda.zip`,
      'win-vulkan-setup': `${base}-win-x64-vulkan-setup.exe`,
      'win-vulkan-zip': `${base}-win-x64-vulkan.zip`,
    });
  });

  it('returns null when that platform has no release', () => {
    expect(downloadUrl({ mac: release }, 'win-setup')).toBeNull();
  });

  it('keeps the newer build per platform', () => {
    const older = { ...release, version: '3.1.1', build: 64, tag: 'baocut-v3.1.1-build.64' };
    const merged = newerReleases({ mac: release, win: older }, { mac: older, win: release, 'win-cuda': older });
    expect(merged).toEqual({ mac: release, win: release, 'win-cuda': older });
    expect(headlineRelease(merged)).toEqual(release);
  });

  it('summarizes the headline release with its notes page', () => {
    const summary = releaseSummary({ mac: release });
    expect(summary?.notesUrl).toBe('https://github.com/jimliu/baocut/releases/tag/baocut-v3.2.0-build.65');
    expect(Object.keys(summary?.downloads ?? {})).toEqual(['mac-dmg', 'mac-zip']);
    expect(releaseSummary({})).toBeNull();
  });
});

describe('preferredDownload', () => {
  it('picks the installer for desktop platforms only', () => {
    expect(preferredDownload('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15')).toBe('mac-dmg');
    expect(preferredDownload('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')).toBe('win-setup');
    expect(preferredDownload('Mozilla/5.0', '"Windows"')).toBe('win-setup');
    expect(preferredDownload('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148')).toBeNull();
    expect(preferredDownload('Mozilla/5.0 (X11; Linux x86_64)')).toBeNull();
  });
});
