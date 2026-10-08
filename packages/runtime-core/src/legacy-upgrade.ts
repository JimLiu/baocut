import fs from 'node:fs/promises';
import { constants as fsConstants, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { TopicLog, type Logger } from '@baocut/harness';
import {
  RpcError,
  type LegacyImportAnswer,
  type LegacyImportEvent,
  type LegacyImportItem,
  type LegacyImportProblem,
  type LegacyImportPrompt,
  type LegacyImportRun,
  type LegacyImportSnapshot,
  type LegacyProjectSummary,
} from '@baocut/protocol';
import { RcRuntime } from '@baocut/protocol/messages/runtime-core';
import type { ModelServiceStore } from '@baocut/models';
import { SettingsStore, readJson, writeJsonAtomic, type RuntimeHome } from '@baocut/runtime-storage';
import { importLegacySettings } from './legacy-upgrade-settings.ts';
import { importLegacyCloud } from './legacy-upgrade-cloud.ts';
import { importLegacyServices, importLegacyNodes } from './legacy-upgrade-services.ts';
import type { NodeStore } from '@baocut/nodes';
import {
  isFile,
  legacyActivityAt,
  legacyRoots,
  legacyProjectVersion,
  discoverLegacyProjects,
  readLegacySource,
  readV1Preferences,
  summarizeLegacyProject,
  type LegacyObject,
  type LegacySource,
} from './legacy-upgrade-sources.ts';

interface SourceState {
  absent?: true;
  settings?: true;
  cloud?: true;
  services?: true;
  nodes?: true;
  nodeIds?: string[];
  credentials: string[];
  projects: Record<string, { target: string; videoDirectory?: true; complete?: true }>;
  /** 用户跳过的旧项目（真实路径；目录已经不在的是发现时的路径）：以后不再自动导入。 */
  skipped?: string[];
  complete?: true;
  pending: string[];
  unsupported: string[];
}
/** 用户对项目导入的回答（§2.7）：`import` 带导入后的项目目录。更早的版本写的标记没有它。 */
type ProjectDecision = { decision: 'import'; directory: string } | { decision: 'never' };
interface UpgradeState {
  schemaVersion: 1;
  complete?: true;
  projectImport?: ProjectDecision;
  sources: Record<string, SourceState>;
}
export interface ImportRequest {
  source: string;
  version: 1 | 2;
  entry: LegacyObject;
  target: string;
  engine: string;
  /** Target is the video itself, inside the shared Imported project. Omitted for older checkpoints. */
  videoDirectory?: true;
}
export interface LegacyUpgradeOptions {
  home: RuntimeHome;
  log: Logger;
  roots?: string[];
  /** Test host override for platform-specific discovery. */
  platform?: NodeJS.Platform;
  v1Preferences?: string | null;
  allowKeychain?: boolean;
  importProject?: (request: ImportRequest, signal: AbortSignal) => Promise<void>;
}
export interface LegacyUpgradeDeps {
  models: ModelServiceStore;
  nodes?: NodeStore;
  engine: string | null;
  openProject: (dir: string, name?: string) => Promise<unknown>;
  refreshModels?: () => Promise<unknown>;
  /** Do not compete with active user jobs; in-flight imports finish at the project boundary. */
  isBusy?: () => boolean;
  env: () => Promise<NodeJS.ProcessEnv>;
}
/** 旧版的导入报告（`import-report.json`）里这里读的几项。 */
interface ImportReport {
  name?: string;
  assets?: { missing?: string[] };
}
/** 没导入的原因里列出的缺失文件个数（总数另给）。 */
const MISSING_SHOWN = 5;
const key = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16);

/**
 * 导入询问的默认目录：系统「文稿 / 文档」文件夹下的 `BaoCut`。桌面端经 `BAOCUT_DOCUMENTS_DIR` 给出主机的已知文件夹
 * （Windows 可能被 OneDrive 之类重定向，不硬拼 `%USERPROFILE%\Documents`）；没有时是主目录下的 `Documents`。
 */
export function defaultLegacyImportDirectory(env: NodeJS.ProcessEnv = process.env, userHome = os.homedir()): string {
  return path.join(env.BAOCUT_DOCUMENTS_DIR || path.join(userHome, 'Documents'), 'BaoCut');
}

/**
 * 文件所在的可移除卷（外接硬盘、网络卷）的挂载点：macOS 的 `/Volumes/<名字>`，Linux 的 `/media/<用户>/<名字>`、
 * `/run/media/<用户>/<名字>` 与 `/mnt/<名字>`，Windows 的盘符根与 `\\服务器\共享`。挂载点不在，就是这块盘没接上。
 */
export function legacyVolumeOf(file: string, platform: NodeJS.Platform): { root: string; name: string } | null {
  if (platform === 'win32') {
    const unc = /^\\\\([^\\/]+)[\\/]([^\\/]+)/.exec(file);
    if (unc) return { root: `\\\\${unc[1]}\\${unc[2]}`, name: unc[2]! };
    const drive = /^([A-Za-z]):[\\/]/.exec(file);
    return drive ? { root: `${drive[1]!.toUpperCase()}:\\`, name: `${drive[1]!.toUpperCase()}:` } : null;
  }
  const mount =
    platform === 'darwin'
      ? /^\/Volumes\/([^/]+)/.exec(file)
      : (/^\/(?:run\/)?media\/[^/]+\/([^/]+)/.exec(file) ?? /^\/mnt\/([^/]+)/.exec(file));
  return mount ? { root: mount[0], name: mount[1]! } : null;
}

/**
 * 导入的视频沿用旧项目的最近活动（§2.7）：Space 的最近活动取 `video.db` 与它 WAL 的修改时间，不改的话导入那一刻就成了每个视频的最近活动。
 * 导入进程退出时引擎已关库，之后才改；改不了不影响导入。
 */
async function keepLegacyActivity(videoDir: string, at: Date | null): Promise<void> {
  if (!at) return;
  for (const name of ['video.db', 'video.db-wal']) await fs.utimes(path.join(videoDir, name), at, at).catch(() => {});
}

/** `dir` 是 `root` 本身或在它里面。 */
function within(root: string, dir: string): boolean {
  const rel = path.relative(root, dir);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** Runs under the Runtime's instance lock. No old file is ever modified. */
export class LegacyUpgrade {
  readonly #options: LegacyUpgradeOptions;
  readonly #file: string;
  #state: UpgradeState = { schemaVersion: 1, sources: {} };
  #sources: LegacySource[] = [];
  #v1PreferenceFile: string | null = null;
  #primaryRoot: string | null = null;
  #abort = new AbortController();
  #running: Promise<void> | null = null;
  /** 等用户回答的导入询问（`legacy-import` 主题）与回答之后继续的去处。 */
  #prompt: LegacyImportPrompt | null = null;
  #answered: ((decision: ProjectDecision) => void) | null = null;
  #answering = false;
  /** 启动时的这一轮在迁移（等回答时不算）。 */
  #migrating = false;
  #deps: LegacyUpgradeDeps | null = null;
  /** 这次启动里的项目导入（`legacy-import` 主题的 `run`）。 */
  #importRun: LegacyImportRun | null = null;
  /** 导入里每一项（按 `item.path`）的来历：属于哪个来源、发现时的路径（`project:<路径>` 待办用它）、旧项目条目。 */
  readonly #entries = new Map<string, { root: string; found: string; entry: LegacyObject }>();
  /** 这次导入涉及的来源：跑完时逐个看能不能记完成。 */
  readonly #runRoots = new Set<string>();
  /** 排队等导入的项目（`item.path`）。只有一个循环在取：`#draining` 在循环里同步清掉，重试不会漏掉，也不会多开一个。 */
  readonly #queue: string[] = [];
  #draining = false;
  #drained: Promise<void> = Promise.resolve();
  /** 事件带完整的导入状态，缓冲不用留太多：落后太多的订阅者改收快照。 */
  readonly topic = new TopicLog<LegacyImportSnapshot, LegacyImportEvent>(() => ({ prompt: this.#prompt, run: this.run() }), '0', 64);
  constructor(options: LegacyUpgradeOptions) {
    this.#options = options;
    this.#file = path.join(options.home.root, 'store', 'legacy-upgrade.json');
  }

  /** 在迁移或导入（算作后台任务，CLI 拉起的 Runtime 不空闲退出）；等回答时不算。 */
  get active(): boolean {
    return this.#migrating || this.#draining;
  }

  /** 此刻等回答的导入询问（`legacyImport.get`）。 */
  prompt(): LegacyImportPrompt | null {
    return this.#prompt;
  }

  /** 这次启动里的项目导入（`legacyImport.get`）；没有要导入的时为 null。 */
  run(): LegacyImportRun | null {
    return this.#importRun && structuredClone(this.#importRun);
  }

  /** `legacyImport.answer`：先校验并记下回答，再让等着的这一轮继续。 */
  async answer(answer: LegacyImportAnswer): Promise<void> {
    const resolve = this.#answered;
    if (!this.#prompt || this.#prompt.promptId !== answer.promptId || !resolve || this.#answering) {
      throw new RpcError('not-found', RcRuntime.legacyPromptGone());
    }
    this.#answering = true;
    try {
      const decision: ProjectDecision =
        answer.decision === 'never' ? { decision: 'never' } : { decision: 'import', directory: await this.#importDirectory(answer.directory) };
      this.#state.projectImport = decision;
      try {
        await this.#save();
      } catch (error) {
        delete this.#state.projectImport;
        throw error;
      }
      this.#options.log.info('Legacy project import answered', { decision: decision.decision });
      // 这一轮接着跑完（导入，或者只是记完成）才算结束。
      this.#migrating = true;
      this.#answered = null;
      this.#setPrompt(null);
      resolve(decision);
    } finally {
      this.#answering = false;
    }
  }

  /** 导入目录：绝对路径，不在 Runtime Home 与旧版数据目录里；不存在时建好，并且要能写。 */
  async #importDirectory(directory: string): Promise<string> {
    if (!path.isAbsolute(directory)) throw new RpcError('invalid-request', RcRuntime.folderPathInvalid());
    const dir = path.resolve(directory);
    if ([this.#options.home.root, ...Object.keys(this.#state.sources)].some((root) => within(path.resolve(root), dir))) {
      throw new RpcError('invalid-request', RcRuntime.legacyImportFolderReserved());
    }
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.access(dir, fsConstants.W_OK);
    } catch {
      throw new RpcError('invalid-request', RcRuntime.legacyImportFolderUnwritable());
    }
    return dir;
  }

  #setPrompt(prompt: LegacyImportPrompt | null): void {
    this.#prompt = prompt;
    this.topic.publish({ type: 'prompt.updated', prompt });
  }

  /** 发出询问并等回答；Runtime 停下时不记任何决定（下次启动再问），返回 null。等的时候不算后台任务。 */
  #ask(projects: LegacyProjectSummary[]): Promise<ProjectDecision | null> {
    if (this.#abort.signal.aborted) return Promise.resolve(null);
    this.#migrating = false;
    this.#options.log.info('Legacy project import awaiting an answer', { projects: projects.length });
    return new Promise((resolve) => {
      const stop = () => {
        this.#answered = null;
        this.#setPrompt(null);
        resolve(null);
      };
      this.#abort.signal.addEventListener('abort', stop, { once: true });
      this.#answered = (decision) => {
        this.#abort.signal.removeEventListener('abort', stop);
        resolve(decision);
      };
      this.#setPrompt({ promptId: randomUUID(), projects, defaultDirectory: defaultLegacyImportDirectory() });
    });
  }
  async #save(): Promise<void> {
    for (const state of Object.values(this.#state.sources)) {
      state.unsupported = [...new Set(state.unsupported)];
      state.pending = [...new Set(state.pending)];
    }
    if (Object.values(this.#state.sources).length && Object.values(this.#state.sources).every((s) => s.complete && s.services && s.nodes))
      this.#state.complete = true;
    else delete this.#state.complete;
    await writeJsonAtomic(this.#file, this.#state, { mode: 0o600 });
  }

  /** Settings precede model catalog creation. Projects and keychain access happen after readiness. */
  async prepare(): Promise<void> {
    const platform = this.#options.platform ?? process.platform;
    const roots =
      this.#options.roots ??
      legacyRoots(
        {
          ...process.env,
          ...(path.resolve(this.#options.home.root) !== path.join(os.homedir(), '.baocut') ? { BAOCUT_HOME: this.#options.home.root } : {}),
        },
        platform,
      );
    if (!roots.length) return;
    const loaded = await readJson<UpgradeState>(this.#file);
    if (loaded && (loaded.schemaVersion !== 1 || !loaded.sources)) throw new Error('Unsupported legacy upgrade marker');
    this.#state = loaded ?? this.#state;
    if (this.#state.complete && Object.values(this.#state.sources).every((s) => s.services && s.nodes)) return;
    // Seed all roots before checkpointing so a crash cannot prematurely mark the whole scan complete.
    for (const root of roots) this.#state.sources[path.resolve(root)] ??= { credentials: [], projects: {}, pending: [], unsupported: [] };
    // Completed sources do not open settings, old registries, plists or directories.
    if (
      roots.every((root) => {
        const state = this.#state.sources[path.resolve(root)];
        return state?.complete && state.services && state.nodes;
      })
    ) {
      await this.#save();
      return;
    }
    let settings: SettingsStore | null = null;
    const prefFile =
      this.#options.v1Preferences !== undefined
        ? this.#options.v1Preferences
        : platform === 'darwin' &&
            !process.env.BAOCUT_LEGACY_ROOT &&
            (process.env.BAOCUT_LEGACY_AUTO_DETECT === '1' ||
              !process.env.BAOCUT_HOME ||
              path.resolve(process.env.BAOCUT_HOME) === path.join(os.homedir(), '.baocut'))
          ? path.join(os.homedir(), 'Library', 'Preferences', 'com.jimliu.baocut.plist')
          : null;
    this.#v1PreferenceFile = prefFile;
    this.#primaryRoot = path.resolve(roots[0]!);
    for (const root of roots) {
      const id = path.resolve(root);
      if (this.#state.sources[id]?.complete && this.#state.sources[id]?.services && this.#state.sources[id]?.nodes) continue;
      const state = (this.#state.sources[id] ??= { credentials: [], projects: {}, pending: [], unsupported: [] });
      state.pending = [];
      if (state.settings && state.services) {
        this.#sources.push({ root: id, config: {}, preferences: {}, cloud: {}, projects: [] });
        continue;
      }
      try {
        const v1Files = prefFile ? [path.join(path.dirname(prefFile), 'VoiceInk.plist'), prefFile] : [];
        const existingV1Files: string[] = [];
        for (const file of v1Files) if (await isFile(file)) existingV1Files.push(file);
        const source =
          (await readLegacySource(id, platform, { discoverProjects: false })) ??
          (existingV1Files.length && id === path.resolve(roots[0]!)
            ? { root: id, config: {}, preferences: {}, cloud: {}, projects: [] }
            : null);
        if (!source) {
          state.absent = true;
          state.complete = true;
          state.services = true;
          state.nodes = true;
          await this.#save();
          continue;
        }
        if (id === path.resolve(roots[0]!)) source.v1PreferenceFiles = existingV1Files;
        this.#sources.push(source);
        const v1: LegacyObject = {};
        if (!state.settings || !state.cloud) {
          for (const file of source.v1PreferenceFiles ?? []) Object.assign(v1, await readV1Preferences(file));
          if (!source.config['llm.default'] && v1['vk-ai-last-provider'] && v1['vk-ai-last-model'])
            source.config['llm.default'] = `provider:${v1['vk-ai-last-provider']}/${v1['vk-ai-last-model']}`;
        }
        if (!state.settings) {
          if (!settings) {
            settings = new SettingsStore(this.#options.home.settingsFile);
            await settings.load();
          }
          await importLegacySettings(settings, source, v1, platform);
          const mapped = new Set(['language', 'vk-url-savedir', 'appAutoUpdate', 'agentChatDefaults', 'agentLastMode', 'serveEnabled', 'servePort']);
          state.unsupported.push(
            ...Object.keys(source.preferences)
              .filter((key) => !mapped.has(key))
              .map((key) => `preference:${key}`),
          );
          if (['cdn', 'modelscope'].includes(source.config['models.endpoint'] ?? v1['vk-download-source']))
            state.unsupported.push('setting:models.endpoint');
          state.settings = true;
          await this.#save();
        }
        if (!state.services) {
          try {
            state.unsupported.push(...(await importLegacyServices(this.#options.home, source)));
            state.services = true;
          } catch {
            state.pending.push('service-settings-unavailable');
            this.#options.log.warn('Legacy service settings deferred', { source: id });
          }
          await this.#save();
        }
      } catch {
        state.pending.push('source-or-settings-unavailable');
        this.#options.log.warn('Legacy upgrade source deferred', { source: id });
        await this.#save();
      }
    }
  }

  start(deps: LegacyUpgradeDeps): void {
    this.#deps = deps;
    this.#migrating = this.#sources.length > 0;
    this.#running = this.#run(deps)
      .catch(() => {
        this.#options.log.warn('Legacy upgrade deferred; incomplete entries will retry on the next start');
      })
      .finally(() => {
        this.#migrating = false;
      });
  }
  async stop(): Promise<void> {
    this.#abort.abort();
    await this.#running;
    await this.#drained;
  }

  async #waitForIdle(busy?: () => boolean): Promise<boolean> {
    while (!this.#abort.signal.aborted && busy?.()) {
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          this.#abort.signal.removeEventListener('abort', finish);
          resolve();
        };
        const timer = setTimeout(finish, 500);
        this.#abort.signal.addEventListener('abort', finish, { once: true });
      });
    }
    return !this.#abort.signal.aborted;
  }

  async #run(deps: LegacyUpgradeDeps): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
    const discovered: LegacySource[] = [];
    for (const prepared of this.#sources) {
      let source = prepared;
      const state = this.#state.sources[source.root]!;
      if (this.#abort.signal.aborted) return;
      if (!(await this.#waitForIdle(deps.isBusy))) return;
      try {
        if (!state.nodes) {
          const current = (await readLegacySource(source.root, this.#options.platform, { discoverProjects: false })) ?? source;
          const result = await importLegacyNodes(current, deps.nodes, {
            platform: this.#options.platform,
            allowKeychain: this.#options.allowKeychain ?? !process.env.BAOCUT_LEGACY_ROOT,
            completed: state.nodeIds,
          });
          state.pending.push(...result.pending);
          state.unsupported.push(...result.unsupported);
          state.nodeIds = [...new Set([...(state.nodeIds ?? []), ...result.done])];
          if (!result.pending.length) state.nodes = true;
          await this.#save();
          await deps.refreshModels?.();
        }
        if (!state.cloud) {
          source = (await readLegacySource(prepared.root, this.#options.platform, { discoverProjects: false })) ?? prepared;
          source.config = { ...source.config, ...prepared.config };
          source.v1PreferenceFiles = prepared.v1PreferenceFiles;
          if (!source.v1PreferenceFiles && this.#v1PreferenceFile && source.root === this.#primaryRoot) {
            source.v1PreferenceFiles = [];
            for (const file of [path.join(path.dirname(this.#v1PreferenceFile), 'VoiceInk.plist'), this.#v1PreferenceFile]) {
              if (await isFile(file)) source.v1PreferenceFiles.push(file);
            }
          }
          if (!source.config['llm.default'] && source.v1PreferenceFiles?.length) {
            const v1: LegacyObject = {};
            for (const file of source.v1PreferenceFiles) Object.assign(v1, await readV1Preferences(file));
            if (v1['vk-ai-last-provider'] && v1['vk-ai-last-model']) {
              source.config['llm.default'] = `provider:${v1['vk-ai-last-provider']}/${v1['vk-ai-last-model']}`;
            }
          }
          const cloud = await importLegacyCloud(
            source,
            deps.models,
            state.credentials,
            async (id) => {
              state.credentials.push(id);
              await this.#save();
            },
            {
              allowKeychain: this.#options.allowKeychain ?? !process.env.BAOCUT_LEGACY_ROOT,
              defaultsFile: this.#options.home.modelServicesFile,
              platform: this.#options.platform,
            },
          );
          state.pending.push(...cloud.pending.map((id) => `credential:${id}`));
          state.unsupported = [
            ...state.unsupported.filter((item) => !item.startsWith('provider:')),
            ...cloud.unsupported.map((id) => `provider:${id}`),
          ];
          await deps.refreshModels?.();
          if (!cloud.pending.length) {
            state.cloud = true;
            await this.#save();
          }
        }
      } catch {
        state.pending.push('cloud-settings-unavailable');
      }
      // Older completed imports keep their original locations and must not be scanned again.
      if (state.complete) {
        await this.#save();
        continue;
      }
      // 说过不再提醒：不再发现、不再导入项目，其余迁完就算完成。
      if (this.#state.projectImport?.decision === 'never') {
        await this.#finishPass(source.root, state);
        continue;
      }
      try {
        const inventory = path.join(this.#options.home.root, 'store', 'legacy-upgrade', `${key(source.root)}.json`);
        const cached = await readJson<{ projects: LegacySource['projects'] }>(inventory);
        if (cached) {
          if (!Array.isArray(cached.projects)) throw new Error('Invalid legacy inventory');
          source.projects = cached.projects;
        } else {
          const current = await readLegacySource(source.root, this.#options.platform, { discoverProjects: false });
          if (!current && !source.v1PreferenceFiles?.length) throw new Error('Legacy source unavailable');
          source.projects = current ? await discoverLegacyProjects(current, this.#options.platform) : [];
          await writeJsonAtomic(inventory, { projects: source.projects }, { mode: 0o600 });
        }
      } catch {
        state.pending.push('project-discovery-unavailable');
        await this.#save();
        continue;
      }
      discovered.push(source);
    }
    if (!discovered.length) return;
    // 项目先问再导入（§2.7）：所有来源的发现合成一次询问。更早的版本已经自动导入过（有项目记录）时沿用原来的放置，不再问。
    let decision = this.#state.projectImport ?? null;
    if (!decision && Object.values(this.#state.sources).some((s) => Object.keys(s.projects).length)) {
      decision = this.#state.projectImport = { decision: 'import', directory: path.join(this.#options.home.projectsDir, 'Imported') };
      await this.#save();
    }
    if (!decision) {
      const projects = await this.#pendingProjects(discovered);
      if (projects.length) {
        decision = await this.#ask(projects);
        if (!decision) return;
      }
    }
    if (decision?.decision === 'import' && (await this.#startRun(discovered, decision.directory))) {
      this.#ensureDrain();
      await this.#drained;
      return;
    }
    if (this.#abort.signal.aborted) return;
    for (const source of discovered) {
      const state = this.#state.sources[source.root]!;
      // 还没有回答（询问之后才出现的项目）：不建新记录，留到下次。
      if (!decision) state.pending.push(...(await this.#unsettled([source])).map((p) => `project:${p.found}`));
      await this.#finishPass(source.root, state);
    }
  }

  /** 已经导入完成的旧项目（各来源合在一起，按真实路径）。 */
  #completedProjects(): Set<string> {
    return new Set(
      Object.values(this.#state.sources).flatMap((s) =>
        Object.entries(s.projects)
          .filter(([, p]) => p.complete)
          .map(([p]) => p),
      ),
    );
  }

  /** 用户跳过的旧项目（各来源合在一起）。 */
  #skippedProjects(): Set<string> {
    return new Set(Object.values(this.#state.sources).flatMap((s) => s.skipped ?? []));
  }

  /**
   * 还没导入完成的旧项目：跨来源按真实路径去重。`id` 是真实路径；目录已经不在（`exists: false`）的是发现时的路径。
   */
  async #unsettled(sources: LegacySource[]): Promise<{ root: string; found: string; id: string; exists: boolean; entry: LegacyObject }[]> {
    const completed = this.#completedProjects();
    const seen = new Set<string>();
    const out: { root: string; found: string; id: string; exists: boolean; entry: LegacyObject }[] = [];
    for (const source of sources) {
      for (const project of source.projects) {
        if (this.#abort.signal.aborted) return [];
        if (completed.has(project.path)) continue;
        const canonical = await fs.realpath(project.path).catch(() => null);
        const id = canonical ?? project.path;
        if (completed.has(id) || seen.has(id)) continue;
        seen.add(id);
        out.push({ root: source.root, found: project.path, id, exists: canonical !== null, entry: project.entry });
      }
    }
    return out;
  }

  /** 询问里列出的：还在、还没导入、也没跳过的旧项目，跨来源按真实路径去重，最近编辑的在前。 */
  async #pendingProjects(sources: LegacySource[]): Promise<LegacyProjectSummary[]> {
    const skipped = this.#skippedProjects();
    const projects: LegacyProjectSummary[] = [];
    for (const project of await this.#unsettled(sources)) {
      if (!project.exists || skipped.has(project.id)) continue;
      projects.push(await summarizeLegacyProject(project.id, project.entry, this.#options.platform));
    }
    return projects.sort((a, b) => (b.editedAt ?? '').localeCompare(a.editedAt ?? ''));
  }

  /**
   * 这次启动的导入：列出还没导入完成的项目（跳过的照列，不排队），没跳过的全部排队。没有要导入的返回 false。
   * `directory` 是回答里的导入目录；已有记录的沿用原来的目标。
   */
  async #startRun(sources: LegacySource[], directory: string): Promise<boolean> {
    const skipped = this.#skippedProjects();
    const items: LegacyImportItem[] = [];
    for (const project of await this.#unsettled(sources)) {
      this.#entries.set(project.id, { root: project.root, found: project.found, entry: project.entry });
      const summary = await summarizeLegacyProject(project.id, project.entry, this.#options.platform);
      items.push({ ...summary, state: skipped.has(project.id) ? 'skipped' : 'queued', problem: null });
    }
    for (const source of sources) this.#runRoots.add(source.root);
    if (this.#abort.signal.aborted || !items.some((item) => item.state === 'queued')) {
      this.#entries.clear();
      this.#runRoots.clear();
      return false;
    }
    items.sort((a, b) => (b.editedAt ?? '').localeCompare(a.editedAt ?? ''));
    this.#importRun = { runId: randomUUID(), directory, state: 'importing', startedAt: new Date().toISOString(), finishedAt: null, items };
    this.#queue.push(...items.filter((item) => item.state === 'queued').map((item) => item.path));
    this.#publishRun();
    this.#options.log.info('Legacy project import started', { projects: this.#queue.length, skipped: items.length - this.#queue.length });
    return true;
  }

  #publishRun(): void {
    this.topic.publish({ type: 'run.updated', run: this.run() });
  }

  #item(id: string): LegacyImportItem | undefined {
    return this.#importRun?.items.find((item) => item.path === id);
  }

  /** 有排队的就开始取；已经在取时什么也不做（新排的会被正在跑的循环取到）。 */
  #ensureDrain(): void {
    if (this.#draining || !this.#queue.length || !this.#deps) return;
    this.#draining = true;
    this.#drained = this.#drain(this.#deps).catch(() => {
      this.#options.log.warn('Legacy project import stopped; incomplete projects will retry on the next start');
    });
  }

  async #drain(deps: LegacyUpgradeDeps): Promise<void> {
    try {
      const run = this.#importRun!;
      for (;;) {
        if (this.#abort.signal.aborted) return;
        const next = this.#queue[0];
        if (next === undefined) {
          run.state = 'finished';
          run.finishedAt = new Date().toISOString();
          this.#publishRun();
          this.#options.log.info('Legacy project import finished', {
            imported: run.items.filter((item) => item.state === 'imported').length,
            notImported: run.items.filter((item) => item.state === 'not-imported').length,
            skipped: run.items.filter((item) => item.state === 'skipped').length,
          });
          for (const root of this.#runRoots) await this.#finishPass(root, this.#state.sources[root]!);
          // 收尾时又有重试排进来：接着取。
          if (this.#queue.length) continue;
          return;
        }
        if (deps.isBusy?.()) {
          run.state = 'waiting';
          this.#publishRun();
        }
        if (!(await this.#waitForIdle(deps.isBusy))) return;
        this.#queue.shift();
        const item = this.#item(next);
        if (!item || item.state !== 'queued') continue;
        item.state = 'importing';
        run.state = 'importing';
        this.#publishRun();
        const result = await this.#importOne(item.path, run.directory, deps);
        if (!result) return;
        item.state = result.problem ? 'not-imported' : 'imported';
        item.problem = result.problem;
        this.#publishRun();
      }
    } finally {
      this.#draining = false;
    }
  }

  /** 导入一个项目：导入了 `problem` 为 null，没导入的带原因（并记成待办，下次启动再试）。Runtime 停下时返回 null。 */
  async #importOne(id: string, directory: string, deps: LegacyUpgradeDeps): Promise<{ problem: LegacyImportProblem | null } | null> {
    const { root, found, entry } = this.#entries.get(id)!;
    const state = this.#state.sources[root]!;
    const todo = `project:${found}`;
    const deferred = async (problem: LegacyImportProblem) => {
      state.pending.push(todo);
      this.#options.log.warn('Legacy project import deferred', { source: found, reason: problem.kind });
      await this.#save();
      return { problem };
    };
    try {
      const canonical = await fs.realpath(found).catch(() => null);
      if (!canonical) return await deferred(await this.#missingProblem([found]));
      const record = (state.projects[canonical] ??= { target: path.join(directory, `legacy-${key(canonical)}`), videoDirectory: true });
      if (!record.complete) {
        const reportFile = path.join(record.target, 'import-report.json');
        const report = () => readJson<ImportReport>(reportFile).catch(() => null);
        const before = await this.#stillMissing((await report())?.assets?.missing);
        if (before.length) return await deferred(await this.#missingProblem(before));
        const version = await legacyProjectVersion(canonical, this.#options.platform);
        if (!version) return await deferred({ kind: 'unreadable' });
        if (!deps.engine) return await deferred({ kind: 'failed', report: null });
        await this.#save();
        const request: ImportRequest = {
          source: canonical,
          version,
          entry,
          target: record.target,
          engine: deps.engine,
          ...(record.videoDirectory ? { videoDirectory: true } : {}),
        };
        try {
          if (this.#options.importProject) await this.#options.importProject(request, this.#abort.signal);
          else await runProjectImport(request, await deps.env(), this.#abort.signal);
        } catch {
          if (this.#abort.signal.aborted) return null;
          // 导入进程没写报告：旧项目文件读不出来（或这个平台不支持它的版本）。写了的看缺不缺素材。
          const after = await report();
          const missing = await this.#stillMissing(after?.assets?.missing);
          if (missing.length) return await deferred(await this.#missingProblem(missing));
          return await deferred(after ? { kind: 'failed', report: reportFile } : { kind: 'unreadable' });
        }
        if (this.#abort.signal.aborted) return null;
        await keepLegacyActivity(
          record.videoDirectory ? record.target : path.join(record.target, 'video'),
          await legacyActivityAt(canonical, entry, this.#options.platform),
        );
        const done = await report();
        await deps.openProject(
          record.videoDirectory ? path.dirname(record.target) : record.target,
          record.videoDirectory ? undefined : done?.name ?? entry.title,
        );
        record.complete = true;
      }
      state.pending = state.pending.filter((item) => item !== todo);
      await this.#save();
      return { problem: null };
    } catch {
      return await deferred({ kind: 'failed', report: null });
    }
  }

  /** 这些文件里现在还读不到的。 */
  async #stillMissing(files: string[] | undefined): Promise<string[]> {
    const missing: string[] = [];
    for (const file of files ?? []) {
      if (!(await fs.access(file).then(
        () => true,
        () => false,
      )))
        missing.push(file);
    }
    return missing;
  }

  /** 缺文件的原因：缺的文件所在的外接硬盘或网络卷没接上，还是文件不在原处。 */
  async #missingProblem(missing: string[]): Promise<LegacyImportProblem> {
    const platform = this.#options.platform ?? process.platform;
    const shown = { missing: missing.slice(0, MISSING_SHOWN), missingCount: missing.length };
    const checked = new Set<string>();
    for (const file of missing) {
      const volume = legacyVolumeOf(file, platform);
      if (!volume || checked.has(volume.root)) continue;
      checked.add(volume.root);
      if (!(await fs.access(volume.root).then(
        () => true,
        () => false,
      )))
        return { kind: 'offline', volume, ...shown };
    }
    return { kind: 'missing', ...shown };
  }

  /**
   * `legacyImport.retry`：没导入的（`paths` 缺省 = 全部）重新排队；点名的跳过项也重新导入，清掉跳过的记录。
   * 其他任务在跑时排着等。返回重新排队的个数。
   */
  async retry(paths?: string[]): Promise<number> {
    const run = this.#importRun;
    if (!run || this.#abort.signal.aborted) return 0;
    const named = paths && new Set(paths);
    const picked = run.items.filter((item) =>
      named ? named.has(item.path) && (item.state === 'not-imported' || item.state === 'skipped') : item.state === 'not-imported',
    );
    if (!picked.length) return 0;
    for (const item of picked) {
      if (item.state === 'skipped') this.#forgetSkip(item.path);
      item.state = 'queued';
      item.problem = null;
    }
    this.#requeue(picked.map((item) => item.path));
    await this.#save();
    this.#ensureDrain();
    return picked.length;
  }

  /**
   * `legacyImport.setSkipped`：跳过没导入的（记下，以后不再自动导入），或撤销跳过（放回跳过前的原因；
   * 更早的启动里跳过的没有原因，重新导入）。返回改了的个数。
   */
  async setSkipped(paths: string[], skipped: boolean): Promise<number> {
    const run = this.#importRun;
    if (!run || this.#abort.signal.aborted) return 0;
    const named = new Set(paths);
    const picked = run.items.filter((item) => named.has(item.path) && item.state === (skipped ? 'not-imported' : 'skipped'));
    if (!picked.length) return 0;
    const requeue: string[] = [];
    for (const item of picked) {
      const { root, found } = this.#entries.get(item.path)!;
      const state = this.#state.sources[root]!;
      if (skipped) {
        item.state = 'skipped';
        state.skipped = [...new Set([...(state.skipped ?? []), item.path])];
        state.pending = state.pending.filter((todo) => todo !== `project:${found}`);
        continue;
      }
      this.#forgetSkip(item.path);
      if (item.problem) {
        item.state = 'not-imported';
        state.pending.push(`project:${found}`);
      } else {
        item.state = 'queued';
        requeue.push(item.path);
      }
    }
    if (requeue.length) this.#requeue(requeue);
    else this.#publishRun();
    this.#options.log.info(skipped ? 'Legacy projects skipped' : 'Legacy projects unskipped', { projects: picked.length });
    // 跳过之后这个来源可能没有待办了：没有在导入、排队的项目时算一次完成。
    const touched = new Set(picked.map((item) => this.#entries.get(item.path)!.root));
    for (const root of touched) {
      const live = run.items.some(
        (item) => (item.state === 'queued' || item.state === 'importing') && this.#entries.get(item.path)!.root === root,
      );
      if (live) await this.#save();
      else await this.#finishPass(root, this.#state.sources[root]!);
    }
    this.#ensureDrain();
    return picked.length;
  }

  /** 清掉一个项目的跳过记录；它的来源不再算完成。 */
  #forgetSkip(id: string): void {
    const { root, found } = this.#entries.get(id)!;
    const state = this.#state.sources[root]!;
    state.skipped = (state.skipped ?? []).filter((item) => item !== id && item !== found);
    if (!state.skipped.length) delete state.skipped;
    delete state.complete;
  }

  /** 这几项已经是 `queued`：排进队列，跑完了的导入重新算开始。 */
  #requeue(ids: string[]): void {
    const run = this.#importRun!;
    this.#queue.push(...ids);
    if (run.state === 'finished') {
      run.state = 'importing';
      run.startedAt = new Date().toISOString();
      run.finishedAt = null;
    }
    this.#publishRun();
  }

  async #finishPass(root: string, state: SourceState): Promise<void> {
    if (!state.pending.length && state.settings && state.cloud && state.services && state.nodes) state.complete = true;
    await this.#save();
    this.#options.log.info('Legacy upgrade pass finished', {
      source: root,
      complete: !!state.complete,
      pending: state.pending.length,
      unsupported: state.unsupported,
    });
  }
}

export function resolveLegacyWorker(start = import.meta.dirname): string {
  const bundled = path.join(start, 'legacy-import-worker.js');
  if (existsSync(bundled)) return bundled;
  for (let dir = start; ; dir = path.dirname(dir)) {
    const source = path.join(dir, 'packages', 'legacy-import', 'src', 'worker.ts');
    if (existsSync(source)) return source;
    if (path.dirname(dir) === dir) throw new Error('Legacy import worker unavailable');
  }
}

export async function runProjectImport(request: ImportRequest, env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-upgrade-'));
  const file = path.join(dir, 'request.json');
  try {
    await writeJsonAtomic(file, request, { mode: 0o600 });
    await new Promise<void>((resolve, reject) => {
      const worker = resolveLegacyWorker();
      if (signal.aborted) {
        reject(new Error('Legacy import cancelled'));
        return;
      }
      const child = spawn(process.execPath, [...(worker.endsWith('.ts') ? ['--experimental-strip-types'] : []), worker, file], {
        env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      child.once('spawn', () => {
        try {
          if (child.pid) os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
        } catch {
          /* Optional on restricted hosts. */
        }
      });
      let force: ReturnType<typeof setTimeout> | undefined;
      const cancel = () => {
        if (child.connected) child.send({ type: 'stop' }, () => {});
        force ??= setTimeout(() => child.kill('SIGKILL'), 4000);
        force.unref();
      };
      signal.addEventListener('abort', cancel, { once: true });
      const deadline = setTimeout(cancel, 30 * 60_000);
      deadline.unref();
      const cleanup = () => {
        clearTimeout(deadline);
        clearTimeout(force);
        signal.removeEventListener('abort', cancel);
      };
      child.once('error', () => {
        cleanup();
        reject(new Error('Legacy import process failed'));
      });
      child.once('exit', (code) => {
        cleanup();
        code === 0 && !signal.aborted ? resolve() : reject(new Error('Legacy import process failed'));
      });
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
