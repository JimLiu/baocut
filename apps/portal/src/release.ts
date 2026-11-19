/**
 * 官网的版本号与下载地址从哪里来：线上读 GitHub Releases（`parseReleases`），构建时用桌面端的更新源
 * （`apps/desktop/releases/appcast-*.json`，`parseFeed`）写一份快照兜底。
 *
 * GitHub 上标成 Latest 的 Release 可能是历史上的 Skill 发布，不能用；这里按 `baocut-v<版本>-build.<构建号>` 的 tag 自己挑。
 * macOS 先发布、Windows 的文件之后才追加进同一个 Release，所以每个平台变体各取「它的文件已经传完」的最新一版。
 * 文件名按发布产物的命名规则：`https://github.com/jimliu/baocut/releases/download/<tag>/BaoCut-<版本>-build.<构建号>-<平台后缀>`。
 * 给访客的下载地址是官网镜像上的同一路径（`https://baocut.com/releases/download/…`，见 mirror.ts），没镜像到时它再跳回 GitHub。
 */

export const REPOSITORY_URL = 'https://github.com/jimliu/baocut';
export const RELEASES_URL = `${REPOSITORY_URL}/releases`;
/** GitHub Releases 上的文件目录。 */
export const GITHUB_DOWNLOAD_PREFIX = `${RELEASES_URL}/download/`;
/** 官网镜像上的同一目录（mirror.ts）：更新源与下载按钮都指向这里。 */
export const MIRROR_DOWNLOAD_PREFIX = 'https://baocut.com/releases/download/';
/**
 * Worker 读的 Release 列表，新的在前。只要最近几次：每次发布都带全部平台，某个平台变体连着几次没发布时由构建快照兜底；
 * 每个 Release 带二十多个文件，响应体随条数涨得很快（一条约 30 KB）。
 */
export const RELEASES_API_URL = 'https://api.github.com/repos/jimliu/baocut/releases?per_page=5';

/** 平台变体（macOS、Windows CPU / CUDA / Vulkan），与桌面端的更新源一一对应；页面上每个下载卡片一个。 */
export const FEED_IDS = ['mac', 'win', 'win-cuda', 'win-vulkan'] as const;
export type FeedId = (typeof FEED_IDS)[number];

/** 每个平台变体对应的更新源文件名，与 `feedFileName` 的规则一致。 */
export const FEED_FILES: Record<FeedId, string> = {
  mac: 'appcast-aarch64-apple-darwin.json',
  win: 'appcast-x86_64-pc-windows-msvc.json',
  'win-cuda': 'appcast-x86_64-pc-windows-msvc-cuda.json',
  'win-vulkan': 'appcast-x86_64-pc-windows-msvc-vulkan.json',
};

export const DOWNLOAD_IDS = [
  'mac-dmg',
  'mac-zip',
  'win-setup',
  'win-zip',
  'win-cuda-setup',
  'win-cuda-zip',
  'win-vulkan-setup',
  'win-vulkan-zip',
] as const;
export type DownloadId = (typeof DOWNLOAD_IDS)[number];

/** 下载项属于哪个平台变体、文件名在 `BaoCut-<版本>-build.<构建号>` 之后接什么。 */
const DOWNLOADS: Record<DownloadId, { feed: FeedId; suffix: string }> = {
  'mac-dmg': { feed: 'mac', suffix: '-aarch64-apple-darwin.dmg' },
  'mac-zip': { feed: 'mac', suffix: '-aarch64-apple-darwin.zip' },
  'win-setup': { feed: 'win', suffix: '-win-x64-setup.exe' },
  'win-zip': { feed: 'win', suffix: '-win-x64.zip' },
  'win-cuda-setup': { feed: 'win-cuda', suffix: '-win-x64-cuda-setup.exe' },
  'win-cuda-zip': { feed: 'win-cuda', suffix: '-win-x64-cuda.zip' },
  'win-vulkan-setup': { feed: 'win-vulkan', suffix: '-win-x64-vulkan-setup.exe' },
  'win-vulkan-zip': { feed: 'win-vulkan', suffix: '-win-x64-vulkan.zip' },
};

/** 一次发布：版本、构建号、日期，以及这次发布的文件所在目录。 */
export interface FeedRelease {
  version: string;
  build: number;
  /** `YYYY-MM-DD`。 */
  date: string;
  /** 发布的 tag，如 `baocut-v3.2.0-build.65`。 */
  tag: string;
}

/** 每个平台变体各自的最新发布；某个变体读不到时缺省。 */
export type ReleaseSet = Partial<Record<FeedId, FeedRelease>>;

const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const TAG = /^baocut-v(\d{1,4}\.\d{1,4}\.\d{1,4})-build\.(\d{1,7})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 读一份 schema 1 的更新源。安装包地址必须在本仓库的发布目录里（GitHub 上的，或官网镜像的同一路径）、文件名带着同一个
 * 版本与构建号，否则当作读不懂：Worker 会照它重定向，不能让更新源把访客带到别处。
 */
export function parseFeed(raw: unknown): FeedRelease | null {
  if (!isRecord(raw) || raw.schema !== 1) return null;
  const { version, build, date, app } = raw;
  if (typeof version !== 'string' || !VERSION.test(version)) return null;
  if (typeof build !== 'number' || !Number.isInteger(build) || build < 1) return null;
  if (typeof date !== 'string' || !DATE.test(date)) return null;
  if (!isRecord(app) || typeof app.url !== 'string') return null;
  // 仓库地址在不同地方大小写不同（`JimLiu/baocut`），只比较小写。
  const url = app.url;
  const prefix = [GITHUB_DOWNLOAD_PREFIX, MIRROR_DOWNLOAD_PREFIX].find((candidate) => url.toLowerCase().startsWith(candidate));
  if (!prefix) return null;
  const [tag, file, ...rest] = url.slice(prefix.length).split('/');
  if (!tag || !file || rest.length > 0 || !TAG.test(tag)) return null;
  if (tag !== `baocut-v${version}-build.${build}`) return null;
  if (!file.startsWith(`${releasePrefix({ version, build })}-`)) return null;
  return { version, build, date, tag };
}

function releasePrefix(release: Pick<FeedRelease, 'version' | 'build'>): string {
  return `BaoCut-${release.version}-build.${release.build}`;
}

/**
 * 读 GitHub「列出 Release」接口的响应。跳过草稿、预发布和别的 tag（如 `skill-v…`）；每个平台变体取安装包与 ZIP
 * 都已传完的最新一次发布。文件地址必须就是本仓库这次发布目录下的同名文件，否则不算：Worker 会照它重定向。
 */
export function parseReleases(raw: unknown): ReleaseSet {
  const releases: ReleaseSet = {};
  if (!Array.isArray(raw)) return releases;
  for (const entry of raw) {
    if (!isRecord(entry) || entry.draft !== false || entry.prerelease !== false) continue;
    const { tag_name: tag, published_at: publishedAt, assets } = entry;
    if (typeof tag !== 'string' || typeof publishedAt !== 'string' || !Array.isArray(assets)) continue;
    const [, version, build] = TAG.exec(tag) ?? [];
    const date = publishedAt.slice(0, 10);
    if (!version || !build || Number(build) < 1 || !DATE.test(date)) continue;
    const release: FeedRelease = { version, build: Number(build), date, tag };
    const uploaded = new Set<string>();
    for (const asset of assets) {
      if (!isRecord(asset) || asset.state !== 'uploaded') continue;
      const { name, browser_download_url: url } = asset;
      if (typeof name !== 'string' || typeof url !== 'string') continue;
      // 仓库地址在不同地方大小写不同（`JimLiu/baocut`），只比较小写。
      if (url.toLowerCase() === `${GITHUB_DOWNLOAD_PREFIX}${tag}/${name}`.toLowerCase()) uploaded.add(name);
    }
    for (const id of FEED_IDS) {
      const current = releases[id];
      if (current && current.build >= release.build) continue;
      const complete = DOWNLOAD_IDS.every(
        (download) => DOWNLOADS[download].feed !== id || uploaded.has(`${releasePrefix(release)}${DOWNLOADS[download].suffix}`),
      );
      if (complete) releases[id] = release;
    }
  }
  return releases;
}

/** 某个下载项在这组发布里的地址（官网镜像上的）；对应平台变体没有可用的发布时为 null。 */
export function downloadUrl(set: ReleaseSet, id: DownloadId): string | null {
  const { feed, suffix } = DOWNLOADS[id];
  const release = set[feed];
  if (!release) return null;
  return `${MIRROR_DOWNLOAD_PREFIX}${release.tag}/${releasePrefix(release)}${suffix}`;
}

/** 发布说明页。 */
export function releasePageUrl(release: Pick<FeedRelease, 'tag'>): string {
  return `${RELEASES_URL}/tag/${release.tag}`;
}

export function isDownloadId(value: string): value is DownloadId {
  return (DOWNLOAD_IDS as readonly string[]).includes(value);
}

/** 两组发布逐个平台取构建号大的那份：构建时的快照给兜底，GitHub 上有更新的发布时以它为准。 */
export function newerReleases(base: ReleaseSet, next: ReleaseSet): ReleaseSet {
  const merged: ReleaseSet = { ...base };
  for (const id of FEED_IDS) {
    const candidate = next[id];
    const current = merged[id];
    if (candidate && (!current || candidate.build > current.build)) merged[id] = candidate;
  }
  return merged;
}

/** 页面上展示的版本：各平台里构建号最大的一份（同号时取 macOS）。 */
export function headlineRelease(set: ReleaseSet): FeedRelease | null {
  let best: FeedRelease | null = null;
  for (const id of FEED_IDS) {
    const release = set[id];
    if (release && (!best || release.build > best.build)) best = release;
  }
  return best;
}

/** 按 User-Agent 猜访客的平台，给「下载」按钮选默认的包；猜不出（手机、Linux）时为 null。 */
export function preferredDownload(userAgent: string, platformHint = ''): DownloadId | null {
  const text = `${platformHint} ${userAgent}`;
  if (/iPhone|iPad|iPod|Android|Mobile/i.test(userAgent)) return null;
  if (/Windows|Win32|Win64/i.test(text)) return 'win-setup';
  if (/Macintosh|Mac OS X|macOS|MacIntel/i.test(text)) return 'mac-dmg';
  return null;
}

/** `/api/release` 的响应体。 */
export interface ReleaseSummary {
  version: string;
  build: number;
  date: string;
  tag: string;
  notesUrl: string;
  downloads: Partial<Record<DownloadId, string>>;
}

export function releaseSummary(set: ReleaseSet): ReleaseSummary | null {
  const headline = headlineRelease(set);
  if (!headline) return null;
  const downloads: Partial<Record<DownloadId, string>> = {};
  for (const id of DOWNLOAD_IDS) {
    const url = downloadUrl(set, id);
    if (url) downloads[id] = url;
  }
  return { ...headline, notesUrl: releasePageUrl(headline), downloads };
}

/** 发布日期（`YYYY-MM-DD`）按页面语言写成长日期；构建时与 Worker 改写时用同一种写法。 */
export function formatReleaseDate(date: string, locale: string): string {
  const at = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return date;
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(at);
}
