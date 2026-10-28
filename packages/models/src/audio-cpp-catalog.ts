import type { AudioCppAddableFamily, AudioCppAddablePackage, AudioCppIdleReason, ModelAddedInfo, ModelLicense } from '@baocut/protocol';
import { ModelsAudioCppCatalog as M } from '@baocut/protocol/messages/models/audio-cpp-catalog.ts';
import crypto from 'node:crypto';
import path from 'node:path';
import { AUDIO_CPP_RELEASE } from './audio-cpp-engine.ts';
import type { BundleDefinition, MusicBundleProfile, SpeechBundleProfile } from './bundle-registry.ts';
import { AUDIO_CPP_CATALOG_DATA } from './audio-cpp-catalog.data.ts';
import { YUE2_3B_Q8 } from './music-bundles.ts';
import type { RepoManifestSpec } from './repo-manifests.ts';

/**
 * 添加 audio.cpp 模型（架构设计 §6.3「添加 audio.cpp 模型」，issue 113）：内置之外，随应用分发的 audio.cpp 引擎支持的模型都能加进
 * 模型列表，加进来的与内置的一样下载、检查、试听、删除。
 *
 * 目录是生成的数据（`audio-cpp-catalog.data.ts`，`tools/audio-cpp-catalog.ts`）：上游在引擎同一版本上的模型规格、许可表与引擎的
 * 加载器清单，每个 GGUF 包钉在下载来源的一个提交上，每个文件带大小与 sha256。这里按 BaoCut 的用法分组、换成模型包登记：
 *
 * - 语音合成（`tts`）：引擎在 `tts` 路由上服务的模型族都能加，请求按规格列出的参数换算（`genericSpeechProfile`）；
 * - 音乐生成（`music`）：只有 YuE2（BaoCut 的音乐请求就是它的形状），别的音乐模型族的请求另有形状，列为暂时用不上；
 * - 识别、分离与其余任务：列出来、写清为什么用不上，不能添加。
 *
 * 一个包加进来是一个模型包，只有一个组件（`tts` 或 `music`），装在模型目录的 `audio-cpp-added/<包 ID>/`，从包的上游仓库下载；包要
 * 的同族配件（YuE2 的 VAE、AuK 的 Qwen 与 VAE）一并列进这个组件：引擎只认相对模型根的路径，配件得和主模型在同一个目录里。
 */

/** 生成的目录数据的形状（`tools/audio-cpp-catalog.ts` 写出）。 */
export interface AudioCppCatalogData {
  engine: string;
  generated: string;
  families: AudioCppCatalogFamily[];
}

export interface AudioCppCatalogFamily {
  family: string;
  name: string;
  group: 'tts' | 'music' | 'asr' | 'sep' | 'other';
  tasks: string[];
  status: string | null;
  languages: string[];
  traits: { clone?: true; design?: true; voices?: number; style?: true; emotion?: true; lyrics?: true; instrumental?: true };
  license: { name: string; url: string | null; commercial: string } | null;
  engine: { endpoints: string[]; instructions: string; tasks: string[] };
  request: { options: string[]; voices?: string[]; speed?: { min: number; max: number; default: number } };
  packages: AudioCppCatalogPackage[];
}

export interface AudioCppCatalogPackage {
  id: string;
  name: string;
  precision: string | null;
  default?: true;
  repo: string;
  revision: string;
  /** 包的根（相对仓库）：多文件的包交给引擎的是这个目录。 */
  root: string;
  files: Array<{ path: string; size: number; sha256: string }>;
}

/** 已经内置的包（上游包 ID → 内置模型包）：目录里标「已内置」，不能再加。 */
export const BUILTIN_PACKAGES: Readonly<Record<string, string>> = {
  qwen3_tts_0_6b_base_q8_0: 'qwen3-tts-0.6b-base@audio-cpp-q8',
  qwen3_tts_1_7b_base_q8_0: 'qwen3-tts-1.7b-base@audio-cpp-q8',
  qwen3_tts_1_7b_customvoice_q8_0: 'qwen3-tts-1.7b-customvoice@audio-cpp-q8',
  qwen3_tts_1_7b_voicedesign_q8_0: 'qwen3-tts-1.7b-voicedesign@audio-cpp-q8',
  index_tts2_q8_0: 'indextts2@audio-cpp-q8',
  index_tts2_5_q8_0: 'index-tts2.5@audio-cpp-q8',
  voxcpm2_q8_0: 'voxcpm2@audio-cpp-q8',
  omnivoice_q8_0: 'omnivoice@audio-cpp-q8',
  fish_audio_s2_pro_q8_0: 'fish-s2-pro@audio-cpp-q8',
  yue2_main_q8_0: 'yue2-3b@audio-cpp-q8',
};

/**
 * 配件：同一族里不单独用、跟着主模型一起下的包（上游规格没有依赖字段，按包 ID 的段认）。每种配件取规格里排在前面的那个精度
 * （上游列在前面的是推荐的）。
 */
const PART_KINDS: Readonly<Record<string, readonly string[]>> = { auk: ['qwen', 'vae'], yue2: ['vae'] };

/** 能用的音乐模型族：BaoCut 的音乐请求（风格、歌词、编排、时长）是 YuE2 的形状。 */
const MUSIC_FAMILIES: ReadonlySet<string> = new Set(['yue2']);

/** 添加的模型包放在模型目录的这个「所有者」下：`<root>/audio-cpp-added/<名字>/`。 */
export const ADDED_REPO_OWNER = 'audio-cpp-added';

const LICENSE_TABLE_URL = `https://github.com/0xShug0/audio.cpp/blob/v${AUDIO_CPP_RELEASE.version}/docs/model_licenses.md`;
const CATALOG_PROVENANCE =
  "Sizes and sha256 come from the download source's LFS records at this revision; non-LFS files were downloaded at this revision and hashed (tools/audio-cpp-catalog.ts)";
const CUSTOM_PROVENANCE = "Size and sha256 come from the download source's LFS record for this file at this revision, read when the model was added";

const families = AUDIO_CPP_CATALOG_DATA.families;
const byFamily = new Map(families.map((f) => [f.family, f]));

export function catalogFamily(family: string): AudioCppCatalogFamily | null {
  return byFamily.get(family) ?? null;
}

/** 包是不是配件。 */
export function isPart(family: AudioCppCatalogFamily, pkg: AudioCppCatalogPackage): boolean {
  return (PART_KINDS[family.family] ?? []).some((kind) => pkg.id.startsWith(`${family.family}_${kind}_`));
}

/** 包所在的族；目录里没有这个包时 null。 */
export function packageFamily(packageId: string): AudioCppCatalogFamily | null {
  return families.find((f) => f.packages.some((p) => p.id === packageId)) ?? null;
}

/** 包要一起下的配件：每种配件取规格里排在前面的那个。 */
export function partsOf(family: AudioCppCatalogFamily, pkg: AudioCppCatalogPackage): AudioCppCatalogPackage[] {
  if (isPart(family, pkg)) return [];
  return (PART_KINDS[family.family] ?? [])
    .map((kind) => family.packages.find((p) => p.id.startsWith(`${family.family}_${kind}_`)))
    .filter((p): p is AudioCppCatalogPackage => p !== undefined);
}

/** 模型族在 BaoCut 里能不能加、为什么不能。 */
export function idleReason(family: AudioCppCatalogFamily): AudioCppIdleReason | null {
  if (family.group === 'asr') return 'recognize';
  if (family.group === 'sep') return 'separate';
  if (family.group === 'other') return 'other';
  if (family.group === 'music') return MUSIC_FAMILIES.has(family.family) ? null : 'music-request';
  // 合成走引擎的 `tts` 路由；只在别的路由上服务的（MOSS VoiceGen 只有 `vdes`）暂时接不上。
  return family.engine.tasks.includes('tts') && family.engine.endpoints.includes('/v1/audio/speech') ? null : 'engine-route';
}

/** 目录里的包加进来的模型包 ID。 */
export function catalogBundleId(packageId: string): string {
  return `${packageId.replace(/_/g, '-')}@audio-cpp`;
}

/** 包（连同配件）的全部文件：同一路径只列一次。 */
function packageFiles(family: AudioCppCatalogFamily, pkg: AudioCppCatalogPackage): AudioCppCatalogPackage['files'] {
  const files = new Map<string, AudioCppCatalogPackage['files'][number]>();
  for (const p of [pkg, ...partsOf(family, pkg)]) for (const f of p.files) files.set(f.path, f);
  return [...files.values()];
}

/** 上游许可表的一行 → 给人看的许可。表里写「有条件」「不明」的、没有这一族的，`commercialUse` 是 null（商用待核实）。 */
export function catalogLicense(family: AudioCppCatalogFamily): ModelLicense {
  const lic = family.license;
  const commercial = lic?.commercial ?? 'unclear';
  const commercialUse = commercial === 'yes' ? true : commercial === 'no' ? false : null;
  const name = lic?.name ?? M.noLicense().text;
  return {
    name,
    url: lic?.url ?? LICENSE_TABLE_URL,
    commercialUse,
    get summary() {
      if (!lic) return M.licenseMissing().text;
      if (commercial === 'yes') return M.licenseCommercial({ name }).text;
      if (commercial === 'no') return M.licenseNonCommercial({ name }).text;
      if (commercial === 'conditional') return M.licenseConditional({ name }).text;
      return M.licenseUnclear({ name }).text;
    },
  };
}

/** 自己指定的文件：不一定是这一族的官方权重，许可不明、商用待核实。 */
export function customLicense(): ModelLicense {
  return {
    get name() {
      return M.customLicenseName().text;
    },
    url: LICENSE_TABLE_URL,
    commercialUse: null,
    get summary() {
      return M.licenseCustom().text;
    },
  };
}

/**
 * 添加对话框用的目录（`models.addable`）：每一族的分组、为什么用不上、特点、许可与能加的包。`present` 是模型列表里已有的模型包
 * （内置的与加过的），包据此标「已内置」「已添加」。
 */
export function addableFamilies(present: ReadonlySet<string>): AudioCppAddableFamily[] {
  return families.map((family) => {
    const idle = idleReason(family);
    const packages: AudioCppAddablePackage[] =
      idle === null
        ? family.packages
            .filter((p) => !isPart(family, p))
            .map((p) => {
              const builtin = BUILTIN_PACKAGES[p.id] ?? null;
              const bundleId = builtin ?? catalogBundleId(p.id);
              return {
                id: p.id,
                name: p.name,
                precision: p.precision,
                bytes: packageFiles(family, p).reduce((sum, f) => sum + f.size, 0),
                parts: partsOf(family, p).map((part) => part.name),
                ...(p.default ? { default: true } : {}),
                bundleId,
                state: builtin ? 'builtin' : present.has(bundleId) ? 'added' : null,
              };
            })
        : [];
    return {
      family: family.family,
      name: family.name,
      group: idle === null ? (family.group as 'tts' | 'music') : 'idle',
      ...(idle ? { idle } : {}),
      tasks: [...family.tasks],
      status: family.status,
      languages: [...family.languages],
      traits: { ...family.traits },
      license: catalogLicense(family),
      packages,
    };
  });
}

/** 一个添加的模型包：登记、它的仓库清单（原地引用的本机文件没有清单）与来源。 */
export interface AddedBundle {
  definition: BundleDefinition;
  manifest: RepoManifestSpec | null;
  info: ModelAddedInfo;
}

/** 目录里的一个包 → 模型包。不认识的包、配件、内置的包、暂时用不上的族返回 null。 */
export function catalogBundle(packageId: string): AddedBundle | null {
  for (const family of families) {
    const pkg = family.packages.find((p) => p.id === packageId);
    if (!pkg) continue;
    if (isPart(family, pkg) || BUILTIN_PACKAGES[pkg.id] || idleReason(family) !== null) return null;
    const files = packageFiles(family, pkg);
    const repo = `${ADDED_REPO_OWNER}/${pkg.id}`;
    const manifest: RepoManifestSpec = {
      repo,
      sourceRepo: pkg.repo,
      revision: pkg.revision,
      files: files.map((f) => ({ ...f })),
      estimatedBytes: files.reduce((sum, f) => sum + f.size, 0),
      provenance: CATALOG_PROVENANCE,
    };
    const label = pkg.name.replace(/\s+GGUF$/i, '');
    const license = catalogLicense(family);
    const source = { family: 'audio-cpp-gguf' as const, repo, revision: pkg.revision };
    if (family.group === 'music') {
      const main = pkg.files.find((f) => f.path.endsWith('.gguf'));
      const vae = partsOf(family, pkg)[0]?.files.find((f) => f.path.endsWith('.gguf'));
      if (!main || !vae) return null;
      return {
        definition: {
          bundleId: catalogBundleId(pkg.id),
          capability: 'music',
          backend: 'audio-cpp',
          device: 'auto',
          components: { music: source },
          label,
          license,
          music: yue2Profile(main, vae),
        },
        manifest,
        info: { kind: 'catalog', family: family.family, familyName: family.name, source: pkg.id },
      };
    }
    // 一个文件的包交给引擎那个文件；多个文件的（权重、分词表、声音、配件……）交给包的根目录，引擎在里面按自己的布局找（上游的
    // 服务配置示例就是给目录）。
    const file = files.length === 1 ? files[0]!.path : pkg.root;
    return {
      definition: speechDefinition(catalogBundleId(pkg.id), label, license, family, source, file, manifest.estimatedBytes),
      manifest,
      info: { kind: 'catalog', family: family.family, familyName: family.name, source: pkg.id },
    };
  }
  return null;
}

/** 添加的模型包的组件来源（`tts` 或 `music`）。 */
type AddedSource = BundleDefinition['components']['tts'] & object;

function speechDefinition(
  bundleId: string,
  label: string,
  license: ModelLicense,
  family: AudioCppCatalogFamily,
  source: AddedSource,
  file: string,
  bytes: number,
): BundleDefinition {
  return {
    bundleId,
    capability: 'synthesize',
    backend: 'audio-cpp',
    device: 'auto',
    components: { tts: source },
    label,
    license,
    speech: genericSpeechProfile(family, file, bytes),
  };
}

/** 加载后约慢于实时的大模型：界面提示耗时。没有逐个实测，按存储大小划线（内置的 1.7B Q8 约 2 GB，标的是慢）。 */
const SLOW_BYTES = 1.8e9;
/** 参考录音的建议时长（秒），同内置的克隆模型。 */
const REFERENCE_SECONDS: [number, number] = [3, 15];
/**
 * 引擎输出的采样率：上游规格不写，按 WAV 头为准（合成结果原样交出、不重采样）。模型描述里的这个数只给界面说明，这里写多数模型的
 * 24 kHz。
 */
const DEFAULT_SAMPLE_RATE = 24_000;

/**
 * 按上游规格给一个没有专门登记的模型族配合成特性（架构设计 §6.3）。只发规格列出的请求参数（`engine.options`），不套用别的模型族
 * 的写法：
 *
 * - 声音：规格列了说话人（`voice_id` 的取值或界面的内置声音）就是模型自带的说话人；能克隆（`clone` 任务或说话人参考）的另有克隆，
 *   没有说话人时用内置音色的参考录音当预设；能按描述造声（`design` 且有 `instruct`）的另有描述。都没有的是单一声音的模型，
 *   预设只有一个 `default`（不发 `voice_id`）。
 * - 风格说明：规格有 `instruct`、引擎按 OpenAI 的 `instructions` 读时交给 `instruct`；引擎按正文前缀读的（VoxCPM）接在正文前；
 *   软标签（OmniVoice）不接。
 * - 语言：只把规格里像 BCP 47 的语言 ID 交给引擎的 `language`；规格写「auto」「50+ languages」之类的，语言不限、由模型自己判断。
 * - 语速：规格给了 `speed` 的范围才有。
 */
export function genericSpeechProfile(family: AudioCppCatalogFamily, file: string, bytes: number): SpeechBundleProfile {
  const options = new Set(family.request.options);
  const speakers = family.request.voices ?? [];
  const clone = family.traits.clone === true;
  const describe = family.traits.design === true && options.has('instruct');
  const codes = family.languages.filter((l) => /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(l) && l.toLowerCase() !== 'auto').map((l) => l.toLowerCase());
  const anyLanguage = codes.length === 0 || codes.length !== family.languages.length;
  const presets: SpeechBundleProfile['presets'] =
    speakers.length > 0 ? 'model' : clone ? 'builtin-reference' : describe ? 'builtin-description' : 'model';
  const instructionsAs = family.engine.instructions === 'text_prefix' ? 'prefix' : family.engine.instructions === 'openai_instruct' && options.has('instruct') ? 'option' : null;
  const speed = family.request.speed;
  return {
    family: family.family,
    engine: {
      family: family.family,
      task: 'tts',
      file,
      ...(options.has('language') && codes.length ? { languages: codes } : {}),
      options: [...options],
      ...(instructionsAs === 'prefix' ? { instructionsAs } : {}),
    },
    languages: anyLanguage ? 'any' : codes,
    voiceModes: ['preset', ...(clone ? (['clone'] as const) : []), ...(describe ? (['describe'] as const) : [])],
    presets,
    ...(presets === 'model' ? { speakers: speakers.length > 0 ? [...speakers] : ['default'] } : {}),
    reference: clone ? { recommendedSeconds: REFERENCE_SECONDS, withTranscriptSeconds: null, acceptsTranscript: options.has('reference_text') } : null,
    voiceDescription: describe ? { kind: 'free' } : null,
    // 按描述造声也用 `instruct`：两样都有时风格说明让给描述。
    instructions: instructionsAs !== null && !describe ? 'style' : null,
    emotion: false,
    knobs: speed ? { speed: { min: speed.min, max: speed.max, step: 0.05, default: speed.default } } : {},
    maxDurationSec: null,
    acceptsSeed: true,
    readings: 'unsupported',
    sampleRate: DEFAULT_SAMPLE_RATE,
    slow: bytes >= SLOW_BYTES,
  };
}

/** YuE2 别的精度：与内置的同一套请求，权重文件换成这个包的；峰值按主模型大小的差换算。 */
function yue2Profile(main: { path: string; size: number }, vae: { path: string; size: number }): MusicBundleProfile {
  const builtin = YUE2_3B_Q8.music!;
  const builtinMain = byFamily.get('yue2')?.packages.find((p) => p.id === 'yue2_main_q8_0')?.files.find((f) => f.path === builtin.files.model)?.size ?? main.size;
  return {
    ...builtin,
    files: { model: main.path, vae: vae.path },
    peakBytes: Math.max(builtin.peakBytes, builtin.peakBytes + main.size - builtinMain),
  };
}

/** 自己指定的文件能按哪些族跑：能添加的合成模型族（一个 GGUF 文件就是整套权重；音乐要配 VAE，不收单个文件）。 */
export function customFamilies(): AudioCppCatalogFamily[] {
  return families.filter((f) => f.group === 'tts' && idleReason(f) === null);
}

/** Hugging Face 上的一个 GGUF：添加时从下载来源读出的提交、大小与 sha256。 */
export interface RepoFileEntry {
  family: string;
  /** 上游 `<owner>/<repo>`。 */
  repo: string;
  /** 解析成的提交。 */
  revision: string;
  path: string;
  size: number;
  sha256: string;
  label: string;
}

/** 自己指定的文件的模型包 ID：按来源算，同一个文件加两次是同一个。 */
export function customBundleId(key: string): string {
  return `custom-${crypto.createHash('sha256').update(key).digest('hex').slice(0, 12)}@audio-cpp`;
}

export function repoFileBundle(entry: RepoFileEntry, bundleId: string): AddedBundle | null {
  const family = catalogFamily(entry.family);
  if (!family || !customFamilies().includes(family)) return null;
  const repo = `${ADDED_REPO_OWNER}/${bundleId.replace(/@.*$/, '')}`;
  const manifest: RepoManifestSpec = {
    repo,
    sourceRepo: entry.repo,
    revision: entry.revision,
    files: [{ path: entry.path, size: entry.size, sha256: entry.sha256 }],
    estimatedBytes: entry.size,
    provenance: CUSTOM_PROVENANCE,
  };
  const source = { family: 'audio-cpp-gguf' as const, repo, revision: entry.revision };
  return {
    definition: speechDefinition(bundleId, entry.label, customLicense(), family, source, entry.path, entry.size),
    manifest,
    info: { kind: 'repo-file', family: family.family, familyName: family.name, source: `${entry.repo}/${entry.path}` },
  };
}

/** 这台电脑上的一个 GGUF：原地引用，不复制。 */
export interface LocalFileEntry {
  family: string;
  /** 绝对路径。 */
  path: string;
  size: number;
  label: string;
}

export function localFileBundle(entry: LocalFileEntry, bundleId: string): AddedBundle | null {
  const family = catalogFamily(entry.family);
  if (!family || !customFamilies().includes(family)) return null;
  const source = {
    family: 'audio-cpp-gguf' as const,
    repo: `${ADDED_REPO_OWNER}/${bundleId.replace(/@.*$/, '')}`,
    revision: 'local',
    local: { path: entry.path, size: entry.size },
  };
  return {
    definition: speechDefinition(bundleId, entry.label, customLicense(), family, source, path.basename(entry.path), entry.size),
    manifest: null,
    info: { kind: 'local-file', family: family.family, familyName: family.name, source: entry.path },
  };
}

/** 目录数据对应的引擎版本。 */
export const AUDIO_CPP_CATALOG_ENGINE = AUDIO_CPP_CATALOG_DATA.engine;
