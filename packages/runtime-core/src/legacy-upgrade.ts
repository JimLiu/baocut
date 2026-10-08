import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { Logger } from '@baocut/harness';
import type { ModelServiceStore } from '@baocut/models';
import { SettingsStore, readJson, writeJsonAtomic, type RuntimeHome } from '@baocut/runtime-storage';
import { importLegacySettings } from './legacy-upgrade-settings.ts';
import { importLegacyCloud } from './legacy-upgrade-cloud.ts';
import {
  isFile,
  legacyRoots,
  legacyProjectVersion,
  discoverLegacyProjects,
  readLegacySource,
  readV1Preferences,
  type LegacyObject,
  type LegacySource,
} from './legacy-upgrade-sources.ts';

interface SourceState {
  absent?: true;
  settings?: true;
  cloud?: true;
  credentials: string[];
  projects: Record<string, { target: string; complete?: true }>;
  complete?: true;
  pending: string[];
  unsupported: string[];
}
interface UpgradeState {
  schemaVersion: 1;
  complete?: true;
  sources: Record<string, SourceState>;
}
export interface ImportRequest {
  source: string;
  version: 1 | 2;
  entry: LegacyObject;
  target: string;
  engine: string;
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
  active = false;
  constructor(options: LegacyUpgradeOptions) {
    this.#options = options;
    this.#file = path.join(options.home.root, 'store', 'legacy-upgrade.json');
  }
  async #save(): Promise<void> {
    if (Object.values(this.#state.sources).length && Object.values(this.#state.sources).every((s) => s.complete))
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
    if (this.#state.complete) return;
    // Seed all roots before checkpointing so a crash cannot prematurely mark the whole scan complete.
    for (const root of roots) this.#state.sources[path.resolve(root)] ??= { credentials: [], projects: {}, pending: [], unsupported: [] };
    // Completed sources do not open settings, old registries, plists or directories.
    if (roots.every((root) => this.#state.sources[path.resolve(root)]?.complete)) {
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
      if (this.#state.sources[id]?.complete) continue;
      const state = (this.#state.sources[id] ??= { credentials: [], projects: {}, pending: [], unsupported: [] });
      state.pending = [];
      if (state.settings) {
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
          const mapped = new Set(['language', 'vk-url-savedir', 'appAutoUpdate', 'agentChatDefaults', 'agentLastMode']);
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
      } catch {
        state.pending.push('source-or-settings-unavailable');
        this.#options.log.warn('Legacy upgrade source deferred', { source: id });
        await this.#save();
      }
    }
  }

  start(deps: {
    models: ModelServiceStore;
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
    for (const prepared of this.#sources) {
      let source = prepared;
      const state = this.#state.sources[source.root]!;
      if (this.#abort.signal.aborted) return;
      if (!(await this.#waitForIdle(deps.isBusy))) return;
      try {
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
      try {
        const inventory = path.join(this.#options.home.root, 'store', 'legacy-upgrade', `${key(source.root)}.json`);
        const cached = await readJson<{ projects: LegacySource['projects'] }>(inventory);
        if (cached) {
          if (!Array.isArray(cached.projects)) throw new Error('Invalid legacy inventory');
          source.projects = cached.projects;
        } else {
          const discovered = await readLegacySource(source.root, this.#options.platform, { discoverProjects: false });
          if (!discovered && !source.v1PreferenceFiles?.length) throw new Error('Legacy source unavailable');
          source.projects = discovered ? await discoverLegacyProjects(discovered, this.#options.platform) : [];
          await writeJsonAtomic(inventory, { projects: source.projects }, { mode: 0o600 });
        }
      } catch {
        state.pending.push('project-discovery-unavailable');
        await this.#save();
        continue;
      }
      const completed = new Set(
        Object.values(this.#state.sources).flatMap((s) =>
          Object.entries(s.projects)
            .filter(([, p]) => p.complete)
            .map(([p]) => p),
        ),
      );
      for (const project of source.projects) {
        if (completed.has(project.path)) continue;
        if (!(await this.#waitForIdle(deps.isBusy))) return;
        try {
          const canonical = await fs.realpath(project.path);
          if (completed.has(canonical)) continue;
          const record = (state.projects[canonical] ??= { target: path.join(this.#options.home.projectsDir, `legacy-${key(canonical)}`) });
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
          const request: ImportRequest = { source: canonical, version, entry: project.entry, target: record.target, engine: deps.engine };
          if (this.#options.importProject) await this.#options.importProject(request, this.#abort.signal);
          else await runProjectImport(request, await deps.env(), this.#abort.signal);
          if (this.#abort.signal.aborted) return;
          const report = await readJson<{ name?: string }>(path.join(record.target, 'import-report.json'));
          await deps.openProject(record.target, report?.name ?? project.entry.title);
          record.complete = true;
          completed.add(canonical);
          await this.#save();
        } catch {
          state.pending.push(`project:${project.path}`);
          this.#options.log.warn('Legacy project import deferred', { source: project.path });
          await this.#save();
        }
      }
      if (!state.pending.length && state.settings && state.cloud) state.complete = true;
      await this.#save();
      this.#options.log.info('Legacy upgrade pass finished', {
        source: source.root,
        complete: !!state.complete,
        pending: state.pending.length,
        unsupported: state.unsupported,
      });
    }
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
