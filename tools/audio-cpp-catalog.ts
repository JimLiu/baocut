#!/usr/bin/env node
/**
 * 生成 audio.cpp 模型目录（`packages/models/src/audio-cpp-catalog.data.ts`，架构设计 §6.3「添加 audio.cpp 模型」）。
 *
 * 来源都钉在内置引擎的版本上（`AUDIO_CPP_RELEASE.version`）：
 * - 上游仓库在这个标签上的 `model_specs/*.json`（每个模型族的任务、语言、请求参数与 GGUF 包）与 `docs/model_licenses.md`（许可表）；
 * - 内置引擎 `audiocpp_cli --list-loaders --json`（引擎真的编进去的模型族、服务端点与任务路由）；
 * - 每个 GGUF 包的 Hugging Face 仓库：规格写的 `revision`（多是 `main`）解析成提交，按这个提交取每个文件的大小与 sha256。LFS 文件用
 *   下载来源的 LFS 记录；不走 LFS 的小文件（配置、分词表）按这个提交下载下来计算。
 *
 * 只收 `format: gguf`、`huggingface_snapshot` 且不要授权（`gated`）的包；别的包（safetensors 原版、要先登录的仓库）不列。
 *
 *   node --experimental-strip-types tools/audio-cpp-catalog.ts
 *   node --experimental-strip-types tools/audio-cpp-catalog.ts --cli <audiocpp_cli> --cache <目录>
 *
 * 下载下来的规格、许可表与小文件缓存在 `--cache`（默认系统临时目录下的 `baocut-audiocpp-catalog/`），重跑不再下载。`HF_ENDPOINT` 给了时
 * 从那个镜像取 Hugging Face 的记录。根 `package.json` 的 `build:audiocpp-catalog` 跑它。
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { AUDIO_CPP_RELEASE, AUDIO_CPP_TOOL } from '../packages/models/src/audio-cpp-engine.ts';
import { cargoTargetDirs } from '../packages/process-host/src/cargo-target.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'packages/models/src/audio-cpp-catalog.data.ts');
const UPSTREAM = '0xShug0/audio.cpp';
const HF = (process.env.HF_ENDPOINT ?? 'https://huggingface.co').replace(/\/+$/, '');

const { values: args } = parseArgs({
  options: { cli: { type: 'string' }, cache: { type: 'string' } },
});
const cacheDir = args.cache ?? path.join(os.tmpdir(), 'baocut-audiocpp-catalog');
const tag = `v${AUDIO_CPP_RELEASE.version}`;

interface SpecOption {
  name: string;
  type?: string;
  default?: unknown;
  min?: number;
  max?: number;
  values?: unknown[];
  required?: boolean;
}
interface SpecPackage {
  id: string;
  display_name: string;
  format: string;
  precision?: string;
  default?: boolean;
  files: string[];
  strip_prefix?: string;
  download?: { kind?: string; repo?: string; revision?: string; gated?: boolean };
}
interface Spec {
  family: string;
  display_name?: string;
  category?: string;
  status?: string;
  tasks?: string[];
  languages?: string[];
  capabilities?: Record<string, string[]>;
  options?: { request?: SpecOption[] };
  ui?: { builtin_voices?: string[] };
  packages?: SpecPackage[];
  package_defaults?: { download?: SpecPackage['download'] };
}
interface Loader {
  api_endpoints?: string[];
  instructions_policy?: string;
  tasks?: Record<string, string[]>;
}

async function cached(name: string, fetcher: () => Promise<Buffer>): Promise<Buffer> {
  const file = path.join(cacheDir, name);
  try {
    return await fs.readFile(file);
  } catch {
    const bytes = await fetcher();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes);
    return bytes;
  }
}

async function get(url: string, init?: RequestInit): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, init);
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (attempt >= 4 || (res.status !== 429 && res.status < 500)) throw new Error(`${res.status} ${url}`);
    await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
  }
}

async function json<T>(name: string, url: string, init?: RequestInit): Promise<T> {
  return JSON.parse((await cached(name, () => get(url, init))).toString('utf8')) as T;
}

async function engineCli(): Promise<string> {
  if (args.cli) return args.cli;
  for (const dir of cargoTargetDirs(ROOT)) {
    const cli = path.join(dir, AUDIO_CPP_TOOL, process.platform === 'win32' ? 'audiocpp_cli.exe' : 'audiocpp_cli');
    try {
      await fs.access(cli);
      return cli;
    } catch {
      // 试下一个产物目录。
    }
  }
  throw new Error('audiocpp_cli not found; run `npm run build:audiocpp` or pass --cli');
}

/** 许可表：`| \`family\` | [来源](url) | 许可 | 能否商用 |`。 */
function licenses(md: string): Map<string, { name: string; url: string | null; commercial: string }> {
  const out = new Map<string, { name: string; url: string | null; commercial: string }>();
  for (const line of md.split('\n')) {
    const m = /^\|\s*`([a-z0-9_]+)`\s*\|(.*?)\|(.*?)\|(.*?)\|/.exec(line);
    if (!m) continue;
    const name = m[3]!.trim().replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    const url = /\((https?:\/\/[^)]+)\)/.exec(m[3]!)?.[1] ?? /\((https?:\/\/[^)]+)\)/.exec(m[2]!)?.[1] ?? null;
    out.set(m[1]!, { name, url, commercial: m[4]!.trim().toLowerCase() });
  }
  return out;
}

/** BaoCut 的分组：音乐生成、语音合成、识别、分离，其余。 */
function groupOf(spec: Spec): 'tts' | 'music' | 'asr' | 'sep' | 'other' {
  const tasks = new Set(spec.tasks ?? []);
  if (tasks.has('music') && spec.category === 'audio_generation') return 'music';
  if (tasks.has('tts') || tasks.has('clone') || tasks.has('design')) return 'tts';
  if (tasks.has('asr')) return 'asr';
  if (tasks.has('sep')) return 'sep';
  return 'other';
}

function traitsOf(spec: Spec, request: Map<string, SpecOption>): Record<string, number | true> {
  const flat = new Set(Object.entries(spec.capabilities ?? {}).flatMap(([k, v]) => v.map((x) => `${k}:${x}`)));
  const has = (suffix: string) => [...flat].some((x) => x.endsWith(suffix));
  const tasks = new Set(spec.tasks ?? []);
  const voices = spec.ui?.builtin_voices?.length || (request.get('voice_id')?.values?.length ?? 0);
  const traits: Record<string, number | true> = {};
  if (tasks.has('clone') || has('speaker_reference')) traits.clone = true;
  if (tasks.has('design') || has('voice_design')) traits.design = true;
  if (voices) traits.voices = voices;
  if (request.has('instruct') || has('style_control')) traits.style = true;
  if (has('emotion_control')) traits.emotion = true;
  if (request.has('lyrics') || flat.has('music:lyrics')) traits.lyrics = true;
  if (flat.has('music:instrumental')) traits.instrumental = true;
  return traits;
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const keyOf = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_');

async function main(): Promise<void> {
  const list = await json<Array<{ name: string }>>(
    `${tag}/model_specs.json`,
    `https://api.github.com/repos/${UPSTREAM}/contents/model_specs?ref=${tag}`,
  );
  const specs: Spec[] = [];
  for (const entry of list.filter((e) => e.name.endsWith('.json')).sort((a, b) => a.name.localeCompare(b.name))) {
    const raw = await cached(`${tag}/model_specs/${entry.name}`, () =>
      get(`https://raw.githubusercontent.com/${UPSTREAM}/${tag}/model_specs/${entry.name}`),
    );
    specs.push(JSON.parse(raw.toString('utf8')) as Spec);
  }
  const licenseMd = (
    await cached(`${tag}/model_licenses.md`, () => get(`https://raw.githubusercontent.com/${UPSTREAM}/${tag}/docs/model_licenses.md`))
  ).toString('utf8');
  const licenseOf = licenses(licenseMd);

  const cli = await engineCli();
  const { stdout } = await promisify(execFile)(cli, ['--list-loaders', '--json'], { maxBuffer: 16 * 1024 * 1024 });
  const loaders = (JSON.parse(stdout) as { loaders: Record<string, Loader> }).loaders;

  const commits = new Map<string, string>();
  const commitOf = async (repo: string, revision: string) => {
    const key = `${repo}@${revision}`;
    if (!commits.has(key)) {
      // 规格里的 `main` 每次重跑都可能前进：缓存按日期分开，重跑当天的结果一致。
      const day = new Date().toISOString().slice(0, 10);
      const info = await json<{ sha: string }>(`hf/${day}/${keyOf(key)}.json`, `${HF}/api/models/${repo}/revision/${encodeURIComponent(revision)}`);
      commits.set(key, info.sha);
    }
    return commits.get(key)!;
  };

  type FileRecord = { path: string; size: number; sha256: string };
  const fileInfo = new Map<string, FileRecord>();
  // 规格列了、仓库在这个提交上却没有的文件：整个包不列（返回 null）。
  const filesOf = async (repo: string, commit: string, paths: string[]): Promise<FileRecord[] | null> => {
    const missing = paths.filter((p) => !fileInfo.has(`${repo}@${commit}/${p}`));
    for (let i = 0; i < missing.length; i += 50) {
      const batch = missing.slice(i, i + 50);
      const infos = await json<Array<{ path: string; size: number; lfs?: { oid: string; size: number } }>>(
        `hf/${keyOf(repo)}@${commit}/paths-${sha256(Buffer.from(batch.join('\n'))).slice(0, 16)}.json`,
        `${HF}/api/models/${repo}/paths-info/${commit}`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paths: batch, expand: false }) },
      );
      for (const info of infos) {
        let digest = info.lfs?.oid ?? null;
        let size = info.lfs?.size ?? info.size;
        if (!digest) {
          const bytes = await cached(`hf/${keyOf(repo)}@${commit}/files/${info.path}`, () => get(`${HF}/${repo}/resolve/${commit}/${info.path}`));
          digest = sha256(bytes);
          size = bytes.length;
        }
        fileInfo.set(`${repo}@${commit}/${info.path}`, { path: info.path, size, sha256: digest });
      }
    }
    const records = paths.map((p) => fileInfo.get(`${repo}@${commit}/${p}`));
    return records.every((r) => r !== undefined) ? (records as FileRecord[]) : null;
  };

  const families = [];
  let dropped = 0;
  let missing = 0;
  for (const spec of specs) {
    const loader = loaders[spec.family];
    if (!loader) throw new Error(`engine has no loader for ${spec.family}`);
    const request = new Map((spec.options?.request ?? []).map((o) => [o.name, o]));
    const group = groupOf(spec);
    const packages = [];
    if (group === 'tts' || group === 'music' || group === 'sep') {
      for (const pkg of spec.packages ?? []) {
        const dl = pkg.download ?? spec.package_defaults?.download ?? {};
        if (pkg.format !== 'gguf' || dl.kind !== 'huggingface_snapshot' || !dl.repo || dl.gated) {
          dropped++;
          continue;
        }
        const revision = await commitOf(dl.repo, dl.revision ?? 'main');
        const files = await filesOf(dl.repo, revision, pkg.files);
        if (!files) {
          missing++;
          continue;
        }
        packages.push({
          id: pkg.id,
          name: pkg.display_name,
          precision: pkg.precision ?? null,
          ...(pkg.default ? { default: true } : {}),
          repo: dl.repo,
          revision,
          root: pkg.strip_prefix ?? '',
          files,
        });
      }
    }
    const voiceValues = request.get('voice_id')?.values?.map(String) ?? spec.ui?.builtin_voices ?? null;
    const speed = request.get('speed');
    const lic = licenseOf.get(spec.family) ?? null;
    families.push({
      family: spec.family,
      name: spec.display_name ?? spec.family,
      group,
      tasks: spec.tasks ?? [],
      status: spec.status ?? null,
      languages: spec.languages ?? [],
      traits: traitsOf(spec, request),
      license: lic,
      engine: {
        endpoints: loader.api_endpoints ?? [],
        instructions: loader.instructions_policy ?? 'none',
        tasks: Object.keys(loader.tasks ?? {}),
      },
      request: {
        options: [...request.keys()].sort(),
        ...(voiceValues?.length ? { voices: voiceValues } : {}),
        ...(speed && typeof speed.min === 'number' && typeof speed.max === 'number'
          ? { speed: { min: speed.min, max: speed.max, default: typeof speed.default === 'number' ? speed.default : 1 } }
          : {}),
      },
      packages,
    });
  }

  const body = JSON.stringify({ engine: AUDIO_CPP_RELEASE.version, generated: new Date().toISOString().slice(0, 10), families }, null, 1);
  const header = [
    '// i18n-ignore-file: generated data (upstream model names, licence names and option keys stay as published)',
    `// Generated by tools/audio-cpp-catalog.ts from audio.cpp ${tag} (model_specs, docs/model_licenses.md, --list-loaders) and the`,
    "// Hugging Face LFS records at each pinned commit. Do not edit by hand; rerun the tool after bumping the engine.",
    "import type { AudioCppCatalogData } from './audio-cpp-catalog.ts';",
    '',
    `export const AUDIO_CPP_CATALOG_DATA: AudioCppCatalogData = ${body};`,
    '',
  ].join('\n');
  await fs.writeFile(OUT, header);
  const count = families.reduce((n, f) => n + f.packages.length, 0);
  console.log(`${families.length} families, ${count} packages (${dropped} non-GGUF or gated, ${missing} with files missing upstream skipped) → ${path.relative(ROOT, OUT)}`);
}

await main();
