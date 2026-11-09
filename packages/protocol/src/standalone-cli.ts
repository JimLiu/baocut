/**
 * 独立 CLI 包（CLI 独立使用与发布 §9）的格式：包内清单、目录布局与更新源里的 `cli` 条目。打包脚本
 * （`apps/desktop/tools/standalone-cli.mjs`）写，CLI（认出自己、`baocut update`）与 Runtime（`cliEntry.*` 认出指向独立包的入口）读。
 *
 * 布局照 App：macOS 是一个 `BaoCut CLI.app` 外壳（`com.baocut.cli`），`Contents/MacOS/` 放 Node（外壳的主程序，完全磁盘访问在系统
 * 设置里以「BaoCut CLI」出现）、命令行入口 `baocut-cli` 与 disclaim 助手，`Contents/Resources/` 放解开的 `app/`（App 里是
 * `app.asar`）与 App 同样的资源目录；Windows 是 `baocut.cmd`、`node.exe` 与 `resources\`（里面同样是 `app\` 与资源目录）。所以
 * 资源与 App 一样按 `packagedResourceEnv(<resources>)` 找，`app/out/main` 到 `web/` 的相对路径也与 `app.asar/out/main` 相同。
 *
 * 纯函数，不读文件：路径以段给出，调用方用自己平台的 `path` 拼。
 */

/** 包内清单的文件名，放在 `app/` 里（`out/main/cli.js` 的上两级）。有它的 `app/` 才是独立包。 */
export const STANDALONE_MANIFEST_FILE = 'baocut-standalone.json';
export const STANDALONE_PRODUCT = 'baocut-cli';
/** macOS 外壳的 bundle 标识；不与 App 的 `com.baocut.app` 共用（公证与 LaunchServices 都按它认）。 */
export const STANDALONE_BUNDLE_ID = 'com.baocut.cli';
export const STANDALONE_APP_NAME = 'BaoCut CLI';
/** 启动器给 Runtime 设的环境变量：值为 `standalone` 时 Runtime 知道自己没有 Electron（代码画面不可用，自检跳过离屏宿主）。 */
export const PACKAGE_KIND_ENV = 'BAOCUT_PACKAGE_KIND';
export const STANDALONE_PACKAGE_KIND = 'standalone';

export type StandaloneTarget = 'aarch64-apple-darwin' | 'x86_64-pc-windows-msvc';

export interface StandaloneManifest {
  schema: 1;
  product: typeof STANDALONE_PRODUCT;
  /** 与同一次构建的 App 相同的版本号与 build 号。 */
  version: string;
  build: number;
  target: StandaloneTarget;
  /** Windows 的 `cpu`、`cuda`、`vulkan`（与 App 的变体相同，决定读哪一份更新源）；macOS 为 `cpu`。 */
  variant: string;
  sourceCommit: string | null;
  /** 随包的 Node 版本（大版本与 App 里 Electron 自带的相同）。 */
  node: string;
}

/** 包内各部分相对包根的位置（路径段）。 */
export interface StandaloneLayout {
  /** 包根下属于包的那几项：装进版本目录时只拷它们（macOS 解开的归档旁边可能还有别的文件）。 */
  top: readonly string[];
  /** 解开的应用目录（`out/`、`node_modules/`、清单）。 */
  app: readonly string[];
  /** 资源目录（`bin/`、`templates/`……），`packagedResourceEnv` 的参数。 */
  resources: readonly string[];
  node: readonly string[];
  /** 命令行入口：`~/.local/bin/baocut` 指向它（Windows 的转发脚本转发到它）。 */
  launcher: readonly string[];
  /** 以 disclaim 拉起 Runtime 的助手（macOS）；Windows 没有。 */
  disclaim: readonly string[] | null;
}

export function standaloneLayout(platform: string): StandaloneLayout | null {
  if (platform === 'darwin') {
    const contents = [`${STANDALONE_APP_NAME}.app`, 'Contents'];
    return {
      top: [`${STANDALONE_APP_NAME}.app`],
      app: [...contents, 'Resources', 'app'],
      resources: [...contents, 'Resources'],
      node: [...contents, 'MacOS', 'node'],
      launcher: [...contents, 'MacOS', 'baocut-cli'],
      disclaim: [...contents, 'MacOS', 'baocut-disclaim'],
    };
  }
  if (platform === 'win32') {
    return {
      top: ['baocut.cmd', 'node.exe', 'resources'],
      app: ['resources', 'app'],
      resources: ['resources'],
      node: ['node.exe'],
      launcher: ['baocut.cmd'],
      disclaim: null,
    };
  }
  return null;
}

/** 版本目录的名字：`<版本>-build.<build>`（同一版本号可能有更高的 build）。 */
export function standaloneVersionDir(manifest: Pick<StandaloneManifest, 'version' | 'build'>): string {
  return `${manifest.version}-build.${manifest.build}`;
}

/** 安装后的版本目录放在哪（相对用户主目录或 `%LOCALAPPDATA%`，CLI 独立使用与发布 §9.3）。 */
export function standaloneVersionsRoot(platform: string): { base: 'home' | 'localAppData'; segments: readonly string[] } {
  return platform === 'win32'
    ? { base: 'localAppData', segments: ['BaoCut', 'cli', 'versions'] }
    : { base: 'home', segments: ['.local', 'share', 'baocut', 'versions'] };
}

/**
 * Windows 上指向当前版本目录的目录联接（`%LOCALAPPDATA%\BaoCut\cli\current`）：`%LOCALAPPDATA%\BaoCut\bin\baocut.cmd` 转发到
 * `current\baocut.cmd`，更新只换联接、不改转发脚本。cmd 是边执行边读批处理文件的，正在运行的 `baocut update` 自己就在执行转发脚本，
 * 改写它会让 cmd 从旧的偏移处接着读新内容。macOS 的软链接直接指向版本目录里的启动器，换链接是原子的。
 */
export const STANDALONE_WINDOWS_CURRENT: readonly string[] = ['BaoCut', 'cli', 'current'];

/** 更新源的地址：与 App 的相同（`apps/desktop/releases/appcast-<target>[-<变体>].json`），环境变量 `BAOCUT_UPDATE_APPCAST` 可覆盖。 */
export const STANDALONE_FEED_ENV = 'BAOCUT_UPDATE_APPCAST';

export function standaloneFeedUrl(target: StandaloneTarget, variant: string): string {
  const suffix = variant !== 'cpu' && /^[a-z0-9]+$/.test(variant) ? `-${variant}` : '';
  return `https://raw.githubusercontent.com/jimliu/baocut/main/apps/desktop/releases/appcast-${target}${suffix}.json`;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const TARGETS: readonly StandaloneTarget[] = ['aarch64-apple-darwin', 'x86_64-pc-windows-msvc'];

/** 读包内清单；不成形时 null。 */
export function parseStandaloneManifest(text: string): StandaloneManifest | null {
  let wire: unknown;
  try {
    wire = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(wire)) return null;
  const { schema, product, version, build, target, variant, sourceCommit, node } = wire;
  if (schema !== 1 || product !== STANDALONE_PRODUCT) return null;
  if (typeof version !== 'string' || !VERSION.test(version)) return null;
  if (typeof build !== 'number' || !Number.isSafeInteger(build) || build < 0) return null;
  if (typeof target !== 'string' || !(TARGETS as readonly string[]).includes(target)) return null;
  if (typeof variant !== 'string' || !/^[a-z0-9]+$/.test(variant)) return null;
  if (sourceCommit !== null && (typeof sourceCommit !== 'string' || !/^[0-9a-f]{40}$/.test(sourceCommit))) return null;
  if (typeof node !== 'string' || !VERSION.test(node)) return null;
  return { schema: 1, product: STANDALONE_PRODUCT, version, build, target: target as StandaloneTarget, variant, sourceCommit, node };
}

/** 更新源（appcast schema 1）里与 `app` 并列的 `cli` 条目：独立包的归档，与 App 同一个版本号与 build。 */
export interface StandaloneFeedEntry {
  format: 'zip';
  url: string;
  size: number;
  sha256: string;
}

export type StandaloneFeedResult =
  | { ok: true; version: string; build: number; minimumSystemVersion: string | null; cli: StandaloneFeedEntry }
  | { ok: false; error: 'decode' | 'schema' | 'target' | 'release' | 'missing' | 'artifact'; detail: string };

/**
 * 从更新源读独立包的条目。`target` 与 `variant` 是本包的；清单写了 `target`、`variant` 时必须一致。归档地址必须是 https
 * （`allowFileUrl` 时也可以是本地文件，演练用），`sha256` 是 64 位十六进制。App 的解析器忽略未知键，所以旧 App 照读带 `cli` 的源。
 */
export function parseStandaloneFeed(text: string, target: StandaloneTarget, variant: string, allowFileUrl = false): StandaloneFeedResult {
  const fail = (error: Extract<StandaloneFeedResult, { ok: false }>['error'], detail: string): StandaloneFeedResult => ({ ok: false, error, detail });
  let wire: unknown;
  try {
    wire = JSON.parse(text);
  } catch (error) {
    return fail('decode', String(error));
  }
  if (!isRecord(wire)) return fail('decode', 'feed is not an object');
  const { schema, target: declaredTarget, variant: declaredVariant, version, build, minimumSystemVersion, cli } = wire;
  if (schema !== 1) return fail('schema', `unsupported feed schema ${String(schema)}`);
  if (declaredTarget != null && declaredTarget !== target) return fail('target', `feed is for ${String(declaredTarget)}`);
  if (declaredVariant != null && declaredVariant !== variant) return fail('target', `feed is for the ${String(declaredVariant)} variant`);
  if (typeof version !== 'string' || !VERSION.test(version) || typeof build !== 'number' || !Number.isSafeInteger(build) || build <= 0) {
    return fail('release', 'feed version or build is invalid');
  }
  if (minimumSystemVersion != null && typeof minimumSystemVersion !== 'string') return fail('decode', 'minimumSystemVersion has the wrong type');
  if (cli == null) return fail('missing', 'feed has no cli entry');
  if (!isRecord(cli)) return fail('artifact', 'cli entry is not an object');
  const { format, url, size, sha256 } = cli;
  if (format !== 'zip' || typeof url !== 'string' || typeof size !== 'number' || typeof sha256 !== 'string') {
    return fail('artifact', 'cli entry fields have the wrong type');
  }
  const local = url.startsWith('file://') || url.startsWith('/') || /^[A-Za-z]:[\\/]/.test(url);
  if (!(url.toLowerCase().startsWith('https://') || (allowFileUrl && local))) return fail('artifact', 'cli archive url must be https');
  if (!Number.isSafeInteger(size) || size <= 0 || !/^[0-9a-fA-F]{64}$/.test(sha256)) return fail('artifact', 'cli archive size or sha256 is invalid');
  return {
    ok: true,
    version,
    build,
    minimumSystemVersion: typeof minimumSystemVersion === 'string' && minimumSystemVersion.trim() ? minimumSystemVersion.trim() : null,
    cli: { format: 'zip', url, size, sha256: sha256.toLowerCase() },
  };
}

/** 独立包归档的文件名：`BaoCut-CLI-<版本>-build.<n>-<target>[-<变体>].zip`（标准版不带变体后缀，同 App 的更新源文件名）。 */
export function standaloneArchiveName(manifest: Pick<StandaloneManifest, 'version' | 'build' | 'target' | 'variant'>): string {
  const suffix = manifest.variant !== 'cpu' ? `-${manifest.variant}` : '';
  return `BaoCut-CLI-${manifest.version}-build.${manifest.build}-${manifest.target}${suffix}.zip`;
}
