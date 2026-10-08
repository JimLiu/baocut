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
  type LegacyImportPrompt,
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
const key = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16);

/**
 * 导入询问的默认目录：系统「文稿 / 文档」文件夹下的 `BaoCut`。桌面端经 `BAOCUT_DOCUMENTS_DIR` 给出主机的已知文件夹
 * （Windows 可能被 OneDrive 之类重定向，不硬拼 `%USERPROFILE%\Documents`）；没有时是主目录下的 `Documents`。
 */
export function defaultLegacyImportDirectory(env: NodeJS.ProcessEnv = process.env, userHome = os.homedir()): string {
  return path.join(env.BAOCUT_DOCUMENTS_DIR || path.join(userHome, 'Documents'), 'BaoCut');
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
  /** 在迁移或导入（算作后台任务，CLI 拉起的 Runtime 不空闲退出）；等回答时不算。 */
  active = false;
  readonly topic = new TopicLog<LegacyImportSnapshot, LegacyImportEvent>(() => ({ prompt: this.#prompt }), '0');
  constructor(options: LegacyUpgradeOptions) {
    this.#options = options;
    this.#file = path.join(options.home.root, 'store', 'legacy-upgrade.json');
  }

  /** 此刻等回答的导入询问（`legacyImport.get`）。 */
  prompt(): LegacyImportPrompt | null {
    return this.#prompt;
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
      this.active = true;
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
    this.active = false;
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

  start(deps: {
    models: ModelServiceStore;
    nodes?: NodeStore;
    engine: string | null;
    openProject: (dir: string, name?: string) => Promise<unknown>;
    refreshModels?: () => Promise<unknown>;
    /** Do not compete with active user jobs; in-flight imports finish at the project boundary. */
    isBusy?: () => boolean;
    env: () => Promise<NodeJS.ProcessEnv>;
  }): void {
    this.active = this.#sources.length > 0;
    this.#running = this.#run(deps)
      .catch(() => {
        this.#options.log.warn('Legacy upgrade deferred; incomplete entries will retry on the next start');
      })
      .finally(() => {
        this.active = false;
      });
  }
  async stop(): Promise<void> {
    this.#abort.abort();
    await this.#running;
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

  async #run(deps: Parameters<LegacyUpgrade['start']>[0]): Promise<void> {
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
    for (const source of discovered) {
      const state = this.#state.sources[source.root]!;
      if (decision?.decision !== 'never' && !(await this.#importProjects(source, decision?.directory ?? null, deps))) return;
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

  /** 询问里列出的：还在、还没导入的旧项目，跨来源按真实路径去重，最近编辑的在前。 */
  async #pendingProjects(sources: LegacySource[]): Promise<LegacyProjectSummary[]> {
    const completed = this.#completedProjects();
    const seen = new Set<string>();
    const projects: LegacyProjectSummary[] = [];
    for (const source of sources) {
      for (const project of source.projects) {
        if (this.#abort.signal.aborted) return [];
        if (completed.has(project.path)) continue;
        const canonical = await fs.realpath(project.path).catch(() => null);
        if (!canonical || completed.has(canonical) || seen.has(canonical)) continue;
        seen.add(canonical);
        projects.push(await summarizeLegacyProject(canonical, project.entry, this.#options.platform));
      }
    }
    return projects.sort((a, b) => (b.editedAt ?? '').localeCompare(a.editedAt ?? ''));
  }

  /**
   * 逐个导入一个来源的项目。`directory` 是回答里的导入目录（导入后的项目）；已有记录的沿用原来的目标。
   * 没有回答（询问之后才出现的项目）时不建新记录，留到下次。Runtime 停下时返回 false。
   */
  async #importProjects(source: LegacySource, directory: string | null, deps: Parameters<LegacyUpgrade['start']>[0]): Promise<boolean> {
    const state = this.#state.sources[source.root]!;
    const completed = this.#completedProjects();
    for (const project of source.projects) {
      if (completed.has(project.path)) continue;
      if (!(await this.#waitForIdle(deps.isBusy))) return false;
      try {
        const canonical = await fs.realpath(project.path);
        if (completed.has(canonical)) continue;
        const record =
          state.projects[canonical] ??
          (directory ? (state.projects[canonical] = { target: path.join(directory, `legacy-${key(canonical)}`), videoDirectory: true }) : null);
        if (!record) {
          state.pending.push(`project:${project.path}`);
          continue;
        }
        if (record.complete) continue;
        const previous = await readJson<{ assets?: { missing?: string[] } }>(path.join(record.target, 'import-report.json'));
        if (previous?.assets?.missing?.length) {
          let unavailable = false;
          for (const file of previous.assets.missing) {
            if (
              !(await fs.access(file).then(
                () => true,
                () => false,
              ))
            ) {
              unavailable = true;
              break;
            }
          }
          if (unavailable) {
            state.pending.push(`project:${project.path}`);
            continue;
          }
        }
        const version = await legacyProjectVersion(canonical, this.#options.platform);
        if (!version || !deps.engine) throw new Error('import-unavailable');
        await this.#save();
        const request: ImportRequest = {
          source: canonical,
          version,
          entry: project.entry,
          target: record.target,
          engine: deps.engine,
          ...(record.videoDirectory ? { videoDirectory: true } : {}),
        };
        if (this.#options.importProject) await this.#options.importProject(request, this.#abort.signal);
        else await runProjectImport(request, await deps.env(), this.#abort.signal);
        if (this.#abort.signal.aborted) return false;
        const report = await readJson<{ name?: string }>(path.join(record.target, 'import-report.json'));
        await deps.openProject(
          record.videoDirectory ? path.dirname(record.target) : record.target,
          record.videoDirectory ? undefined : report?.name ?? project.entry.title,
        );
        record.complete = true;
        completed.add(canonical);
        await this.#save();
      } catch {
        state.pending.push(`project:${project.path}`);
        this.#options.log.warn('Legacy project import deferred', { source: project.path });
        await this.#save();
      }
    }
    return true;
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
