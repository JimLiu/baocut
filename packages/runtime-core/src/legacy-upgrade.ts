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
  readLegacySource,
  readV1Preferences,
  type LegacyObject,
  type LegacySource,
} from './legacy-upgrade-sources.ts';

interface SourceState {
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
  #abort = new AbortController();
  #running: Promise<void> | null = null;
  active = false;
  constructor(options: LegacyUpgradeOptions) {
    this.#options = options;
    this.#file = path.join(options.home.root, 'store', 'legacy-upgrade.json');
  }
  async #save(): Promise<void> {
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
    const settings = new SettingsStore(this.#options.home.settingsFile);
    await settings.load();
    const prefFile =
      this.#options.v1Preferences !== undefined
        ? this.#options.v1Preferences
        : platform === 'darwin' &&
            !process.env.BAOCUT_LEGACY_ROOT &&
            (!process.env.BAOCUT_HOME || path.resolve(process.env.BAOCUT_HOME) === path.join(os.homedir(), '.baocut'))
          ? path.join(os.homedir(), 'Library', 'Preferences', 'com.jimliu.baocut.plist')
          : null;
    for (const root of roots) {
      const id = path.resolve(root);
      if (this.#state.sources[id]?.complete) continue;
      const state = (this.#state.sources[id] ??= { credentials: [], projects: {}, pending: [], unsupported: [] });
      state.pending = [];
      try {
        const v1Files = prefFile ? [path.join(path.dirname(prefFile), 'VoiceInk.plist'), prefFile] : [];
        const existingV1Files: string[] = [];
        for (const file of v1Files) if (await isFile(file)) existingV1Files.push(file);
        const source =
          (await readLegacySource(id, platform)) ??
          (existingV1Files.length && id === path.resolve(roots[0]!)
            ? { root: id, config: {}, preferences: {}, cloud: {}, projects: [] }
            : null);
        if (!source) continue;
        if (id === path.resolve(roots[0]!)) source.v1PreferenceFiles = existingV1Files;
        this.#sources.push(source);
        const v1: LegacyObject = {};
        if (!state.settings || !state.cloud) {
          for (const file of source.v1PreferenceFiles ?? []) Object.assign(v1, await readV1Preferences(file));
          if (!source.config['llm.default'] && v1['vk-ai-last-provider'] && v1['vk-ai-last-model'])
            source.config['llm.default'] = `provider:${v1['vk-ai-last-provider']}/${v1['vk-ai-last-model']}`;
        }
        if (!state.settings) {
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

  async #run(deps: Parameters<LegacyUpgrade['start']>[0]): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
    for (const source of this.#sources) {
      const state = this.#state.sources[source.root]!;
      if (this.#abort.signal.aborted) return;
      try {
        if (!state.cloud) {
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
      for (const project of source.projects) {
        if (this.#abort.signal.aborted) return;
        try {
          const canonical = await fs.realpath(project.path);
          if (Object.values(this.#state.sources).some((s) => s.projects[canonical]?.complete)) continue;
          const record = (state.projects[canonical] ??= { target: path.join(this.#options.home.projectsDir, `legacy-${key(canonical)}`) });
          if (record.complete) continue;
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
