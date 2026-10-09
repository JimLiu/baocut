import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BUNDLES,
  platformBundles,
  QWEN3_ASR_0_6B_BUNDLE,
  QWEN3_FORCED_ALIGNER,
  SPEAKER_DIARIZATION_BUNDLE,
  WESPEAKER,
} from './bundle-registry.ts';
import { LocalProviderSource } from './local-source.ts';
import { MANIFEST_FILE, ModelCatalog, resolveModelsDir, resolveModelsRoot } from './model-catalog.ts';
import { weightBytes } from './repo-manifests.ts';

/** 在模型目录里写一个合成的仓库：几个小文件和与之相符的清单。 */
async function writeRepo(root: string, repo: string, revision: string, files: Record<string, string>): Promise<string> {
  const dir = path.join(root, ...repo.split('/'));
  await fs.mkdir(dir, { recursive: true });
  const entries = [];
  for (const [name, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await fs.writeFile(path.join(dir, name), content);
    entries.push({
      path: name,
      size: Buffer.byteLength(content),
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
      source_verified: true,
    });
  }
  await fs.writeFile(
    path.join(dir, MANIFEST_FILE),
    JSON.stringify({ format_version: 1, repo, revision, source: 'https://huggingface.co', files: entries }),
  );
  return dir;
}

const def = BUNDLES.find((b) => b.bundleId === QWEN3_ASR_0_6B_BUNDLE)!;
const asr = def.components.asr!;
const vad = def.components.vad!;

describe('ModelCatalog', () => {
  let root: string;
  const mac = { platform: 'darwin' as const, arch: 'arm64' };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-models-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function installBoth() {
    await writeRepo(root, asr.repo, asr.revision, { 'config.json': '{"a":1}', 'model.safetensors': 'weights-asr', 'sub/vocab.json': '{}' });
    await writeRepo(root, vad.repo, vad.revision, { 'config.json': '{}', 'model.safetensors': 'weights-vad' });
  }

  it('模型目录的根：BAOCUT_MODELS_DIR 覆盖默认的 <home>/models', () => {
    expect(resolveModelsRoot('/h', {})).toBe(path.join('/h', 'models'));
    expect(resolveModelsRoot('/h', { BAOCUT_MODELS_DIR: '/m' })).toBe(path.resolve('/m'));
    // 设置 `models.dir` 在环境变量之后、缺省之前；设成缺省位置等于没设。
    expect(resolveModelsDir('/h', {}, '/s')).toEqual({
      path: path.resolve('/s'),
      source: 'setting',
      defaultPath: path.join('/h', 'models'),
    });
    expect(resolveModelsDir('/h', { BAOCUT_MODELS_DIR: '/m' }, '/s')).toMatchObject({ path: path.resolve('/m'), source: 'env' });
    expect(resolveModelsDir('/h', {}, path.join('/h', 'models'))).toMatchObject({ source: 'default' });
  });

  it('换模型目录的根之后按新目录重算；移动期间模型包不可用', async () => {
    const catalog = new ModelCatalog({ root, ...mac });
    await installBoth();
    expect((await catalog.status(QWEN3_ASR_0_6B_BUNDLE))?.state).toBe('installed');
    const changed: string[] = [];
    catalog.onChange((id) => changed.push(id));
    catalog.setRelocating(true);
    expect(await catalog.status(QWEN3_ASR_0_6B_BUNDLE)).toMatchObject({ state: 'error', reason: 'relocating' });
    catalog.setRelocating(false);
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-catalog-empty-'));
    try {
      catalog.setRoot(empty);
      expect(catalog.root).toBe(empty);
      expect(changed).toContain(QWEN3_ASR_0_6B_BUNDLE);
      expect((await catalog.status(QWEN3_ASR_0_6B_BUNDLE))?.state).toBe('not-installed');
    } finally {
      await fs.rm(empty, { recursive: true, force: true });
    }
  });

  it('缺清单、缺文件、大小不符、版本不符都是 not-installed；只缺一部分组件是 incomplete；齐全是 installed', async () => {
    const catalog = new ModelCatalog({ root, ...mac });
    expect(await catalog.status(QWEN3_ASR_0_6B_BUNDLE)).toMatchObject({
      state: 'not-installed',
      reason: 'missing-manifest',
      capability: 'transcribe',
      backend: 'mlx',
      device: 'metal',
      // 说明带着引用：界面与 CLI 按读者的语言重新生成。
      detailRef: { key: 'modelsModelCatalog.noManifest', params: { repo: expect.any(String) } },
    });
    await installBoth();
    expect(await catalog.status(QWEN3_ASR_0_6B_BUNDLE)).toEqual({
      bundleId: QWEN3_ASR_0_6B_BUNDLE,
      capability: 'transcribe',
      backend: 'mlx',
      device: 'metal',
      label: 'Qwen3-ASR 0.6B',
      state: 'installed',
      // 必需组件的下载大小，按随应用发布的清单估计（不看本机装的文件）。
      estimatedBytes: 714_289_971,
      license: expect.objectContaining({ name: 'Apache-2.0', commercialUse: true }),
      components: [
        // 每个组件也带按清单估的下载大小（装好的照样给），界面在缺组件时据此写要下多少。
        {
          component: 'asr',
          repo: asr.repo,
          revision: asr.revision,
          state: 'installed',
          bytes: 20,
          estimatedBytes: 713_031_680,
          sharedWith: [],
        },
        // 大一档的 Qwen3-ASR 用同一个 VAD。
        {
          component: 'vad',
          repo: vad.repo,
          revision: vad.revision,
          state: 'installed',
          bytes: 13,
          estimatedBytes: 1_258_291,
          sharedWith: ['qwen3-asr-1.7b@mlx-8bit', 'whisper-large-v3@coreml', 'whisper-large-v3-turbo@coreml'],
        },
        // 可选的对齐器没装：模型包照样算装好。
        {
          component: 'aligner',
          repo: QWEN3_FORCED_ALIGNER.repo,
          revision: QWEN3_FORCED_ALIGNER.revision,
          state: 'missing',
          bytes: null,
          estimatedBytes: 983_141_596,
          sharedWith: [
            'qwen3-asr-1.7b@mlx-8bit',
            'whisper-large-v3@coreml',
            'whisper-large-v3-turbo@coreml',
            'moss-transcribe-diarize@mlx-8bit',
          ],
          optional: true,
          // 组件自己的许可随状态带出。
          license: QWEN3_FORCED_ALIGNER.license,
        },
      ],
    });
    expect((await catalog.list()).map((b) => b.bundleId)).toEqual(platformBundles('darwin', 'arm64').map((b) => b.bundleId));

    // ASR 好、VAD 坏：缺一部分组件，报告 incomplete 并点名缺的组件与原因，不当成整包没装。
    const weights = path.join(catalog.repoDir(vad.repo), 'model.safetensors');
    await fs.writeFile(weights, 'weights-vad-longer');
    let status = await catalog.status(QWEN3_ASR_0_6B_BUNDLE);
    expect(status).toMatchObject({ state: 'not-installed', reason: 'incomplete' });
    expect(status!.detail).toContain('大小不符');
    expect(status!.components!.map((c) => c.state)).toEqual(['installed', 'missing', 'missing']);
    await fs.rm(weights);
    status = await catalog.status(QWEN3_ASR_0_6B_BUNDLE);
    expect(status).toMatchObject({ state: 'not-installed', reason: 'incomplete' });
    expect(status!.detail).toContain('缺少 model.safetensors');

    await writeRepo(root, vad.repo, 'other-revision', { 'model.safetensors': 'x' });
    expect((await catalog.status(QWEN3_ASR_0_6B_BUNDLE))!.detail).toContain('版本不是');
    // 两个组件都缺：报第一个组件的具体原因。
    await fs.rm(path.join(catalog.repoDir(asr.repo), 'config.json'));
    expect(await catalog.status(QWEN3_ASR_0_6B_BUNDLE)).toMatchObject({ state: 'not-installed', reason: 'missing-file' });
    expect(await catalog.status('nope')).toBeNull();
  });

  it('组件带登记里自己的许可：MOSS 的说话人模型是 CC-BY-4.0 并带署名；没登记许可的组件不带', async () => {
    const catalog = new ModelCatalog({ root, ...mac });
    const moss = await catalog.status('moss-transcribe-diarize@mlx-8bit');
    const speaker = moss!.components!.find((c) => c.component === 'speaker')!;
    expect(speaker.license).toEqual(WESPEAKER.license);
    expect(speaker.license).toMatchObject({ name: 'CC-BY-4.0', commercialUse: true });
    expect(speaker.license!.summary).toMatch(/署名：.*WeSpeaker.*pyannote\.audio/);
    expect(moss!.components!.find((c) => c.component === 'asr')).not.toHaveProperty('license');
    const qwen = await catalog.status(QWEN3_ASR_0_6B_BUNDLE);
    expect(qwen!.components!.find((c) => c.component === 'vad')).not.toHaveProperty('license');
  });

  it('Worker 要加载的权重：识别按清单相加；分离的权重 16 位存、32 位算，按文件的两倍；合成不估', async () => {
    const catalog = new ModelCatalog({ root, ...mac });
    const separate = BUNDLES.find((b) => b.bundleId === 'htdemucs-ft@mlx')!;
    const file = weightBytes([separate.components.separator!]);
    expect(file).toBeGreaterThan(300_000_000);
    expect(await catalog.workerWeightBytes(separate.bundleId)).toBe(file! * 2);
    expect(await catalog.workerWeightBytes(QWEN3_ASR_0_6B_BUNDLE)).toBe(weightBytes([asr, vad]));
    const speech = BUNDLES.find((b) => b.capability === 'synthesize')!;
    expect(await catalog.workerWeightBytes(speech.bundleId)).toBeNull();
  });

  it('分离模型包随平台：Apple Silicon 列 MLX 的，别的平台列 candle 的（同一个仓库），各自是人声分离的默认；candle 的常驻按文件两倍、池随设备', async () => {
    const silicon = new ModelCatalog({ root, ...mac });
    const siliconSeparate = silicon.definitions().filter((d) => d.capability === 'separate');
    expect(siliconSeparate.map((d) => d.bundleId)).toEqual(['htdemucs-ft@mlx']);
    const siliconView = await new LocalProviderSource({ catalog: silicon, transcriber: null }).describe('local', 'view');
    expect(siliconView!.capabilities.separateAudio!.models).toMatchObject([{ modelId: 'htdemucs-ft@mlx', default: true }]);
    for (const [platform, arch] of [
      ['win32', 'x64'],
      ['linux', 'x64'],
      ['linux', 'arm64'],
      ['darwin', 'x64'],
    ] as const) {
      const other = new ModelCatalog({ root, platform, arch });
      const separate = other.definitions().filter((d) => d.capability === 'separate');
      expect(
        separate.map((d) => d.bundleId),
        `${platform}/${arch}`,
      ).toEqual(['htdemucs-ft@candle']);
      expect(separate[0]).toMatchObject({ backend: 'candle', device: 'cpu', components: siliconSeparate[0]!.components });
      expect(await other.status('htdemucs-ft@mlx'), `${platform}/${arch}`).toBeNull();
      const view = await new LocalProviderSource({ catalog: other, transcriber: null }).describe('local', 'view');
      expect(view!.capabilities.separateAudio!.models, `${platform}/${arch}`).toMatchObject([
        { modelId: 'htdemucs-ft@candle', default: true },
      ]);
    }
    // candle 的分离在 CPU 与 CUDA 上都升成 f32：常驻按文件的两倍，CPU 计在内存、CUDA 计在 GPU 内存。
    const linux = new ModelCatalog({ root, platform: 'linux', arch: 'x64' });
    const bytes = (await linux.workerWeightBytes('htdemucs-ft@candle'))!;
    expect(bytes).toBe(await silicon.workerWeightBytes('htdemucs-ft@mlx'));
    expect(await linux.workerFootprint('htdemucs-ft@candle')).toEqual({ bytes, pool: 'memory' });
    linux.setWorkerDevice('candle', 'cuda');
    expect(await linux.workerFootprint('htdemucs-ft@candle')).toEqual({ bytes, pool: 'gpuMemory' });
  });

  it('mlx 只在 darwin/arm64 上可用；别的平台不列出，硬登记进去的是 error / unsupported', async () => {
    await installBoth();
    const linux = new ModelCatalog({ root, platform: 'linux', arch: 'x64' });
    expect(await linux.status(QWEN3_ASR_0_6B_BUNDLE)).toBeNull();
    for (const platform of ['linux', 'darwin'] as const) {
      const forced = new ModelCatalog({ root, platform, arch: 'x64', bundles: [def] });
      expect(await forced.status(QWEN3_ASR_0_6B_BUNDLE)).toMatchObject({ state: 'error', reason: 'unsupported' });
    }
  });

  it('按平台列出：Apple Silicon 只列 MLX 与 Core ML，别的平台只列 candle 与 GGML；名字与仓库相同，默认模型包随平台', async () => {
    const ids = (catalog: ModelCatalog) => catalog.definitions().map((d) => d.bundleId);
    const silicon = new ModelCatalog({ root, ...mac });
    expect(silicon.definitions().every((d) => d.backend === 'mlx' || d.backend === 'coreml')).toBe(true);
    expect(ids(silicon)).toEqual(
      expect.arrayContaining([
        'qwen3-asr-0.6b@mlx-4bit',
        'qwen3-asr-1.7b@mlx-8bit',
        'moss-transcribe-diarize@mlx-8bit',
        'whisper-large-v3@coreml',
        'speaker-diarization@mlx',
      ]),
    );
    expect(silicon.defaultTranscribeBundle()).toBe('moss-transcribe-diarize@mlx-8bit');

    for (const [platform, arch] of [
      ['linux', 'x64'],
      ['win32', 'x64'],
      ['linux', 'arm64'],
      ['darwin', 'x64'],
    ] as const) {
      const catalog = new ModelCatalog({ root, platform, arch });
      expect(ids(catalog), `${platform}/${arch}`).toEqual([
        'qwen3-asr-0.6b@candle',
        'qwen3-asr-1.7b@candle',
        'moss-transcribe-diarize@candle',
        'speaker-diarization@candle',
        'whisper-large-v3@ggml',
        'whisper-large-v3-turbo@ggml',
        'qwen3-tts-0.6b-base@candle',
        'qwen3-tts-0.6b-customvoice@candle',
        'qwen3-tts-1.7b-base@candle',
        'qwen3-tts-1.7b-customvoice@candle',
        'qwen3-tts-1.7b-voicedesign@candle',
        'indextts2@candle',
        'index-tts2.5@candle',
        'gpt-sovits-v2@candle',
        'voxcpm2@candle',
        'omnivoice@candle',
        'qwen-image-2.1@candle',
        'htdemucs-ft@candle',
      ]);
      expect(catalog.defaultTranscribeBundle()).toBe('moss-transcribe-diarize@candle');
    }

    const linux = new ModelCatalog({ root, platform: 'linux', arch: 'x64' });
    for (const candle of linux.definitions().filter((d) => d.backend === 'candle')) {
      const twin = silicon.definitions().find((d) => d.label === candle.label)!;
      expect(twin, candle.bundleId).toBeDefined();
      expect(candle.components).toEqual(twin.components);
      expect(candle).toMatchObject({ backend: 'candle', device: 'cpu', capability: twin.capability });
    }
    expect(linux.definitions().map((d) => d.label)).toEqual([
      'Qwen3-ASR 0.6B',
      'Qwen3-ASR 1.7B',
      'MOSS Transcribe',
      '说话人区分',
      'Whisper large-v3',
      'Whisper large-v3 turbo',
      'Qwen3-TTS 0.6B Base',
      'Qwen3-TTS 0.6B CustomVoice',
      'Qwen3-TTS 1.7B Base',
      'Qwen3-TTS 1.7B CustomVoice',
      'Qwen3-TTS 1.7B VoiceDesign',
      'IndexTTS2',
      'IndexTTS 2.5',
      'GPT-SoVITS v2',
      'VoxCPM2',
      'OmniVoice',
      'Qwen-Image-2.1',
      'HTDemucs-FT',
    ]);
    expect(silicon.definitions().some((d) => d.backend === 'ggml')).toBe(false);
  });

  it('GGML 模型包：设备随 Worker 握手报告的（CUDA、Vulkan 或 CPU）；常驻量是 Whisper 权重的存储字节加 candle 的 VAD 与对齐器', async () => {
    const turbo = BUNDLES.find((b) => b.bundleId === 'whisper-large-v3-turbo@ggml')!;
    const whisper = turbo.components.asr!;
    await writeRepo(root, whisper.repo, whisper.revision, { 'ggml-large-v3-turbo-q8_0.bin': 'ggml-weights' });
    await writeRepo(root, vad.repo, vad.revision, { 'config.json': '{}', 'model.safetensors': 'weights-vad' });
    const windows = new ModelCatalog({ root, platform: 'win32', arch: 'x64', threads: 2 });
    expect(await windows.status(turbo.bundleId)).toMatchObject({ state: 'installed', backend: 'ggml', device: 'cpu' });
    // 没装可选的对齐器：Whisper 的权重字节（内置清单大小未知，按估计的 834 MiB）加上 VAD 在 candle CPU 上的 f32 常驻量，计在内存。
    const memory = { bytes: 834 * 1024 * 1024 + vad.parameters! * 4, pool: 'memory' };
    expect(await windows.workerFootprint(turbo.bundleId)).toEqual(memory);
    windows.setWorkerDevice('ggml', 'vulkan');
    expect(await windows.status(turbo.bundleId)).toMatchObject({ device: 'vulkan' });
    expect(await windows.bundleFor(turbo.bundleId)).toMatchObject({ backend: 'ggml', device: 'vulkan' });
    expect(await windows.workerFootprint(turbo.bundleId)).toEqual({ ...memory, pool: 'gpuMemory' });
    // CUDA 安装包的 Worker 报 `cuda`：同样计在 GPU 内存。
    windows.setWorkerDevice('ggml', 'cuda');
    expect(await windows.status(turbo.bundleId)).toMatchObject({ device: 'cuda' });
    expect(await windows.bundleFor(turbo.bundleId)).toMatchObject({ backend: 'ggml', device: 'cuda' });
    expect(await windows.workerFootprint(turbo.bundleId)).toEqual({ ...memory, pool: 'gpuMemory' });
    // candle 的设备与 GGML 的各记各的。
    expect(await windows.status('qwen3-asr-0.6b@candle')).toMatchObject({ device: 'cpu' });
    windows.setWorkerDevice('ggml', null);
    expect(await windows.status(turbo.bundleId)).toMatchObject({ device: 'cpu' });
  });

  it('candle 模型包：装好就可用，设备随 Worker 握手报告的（CUDA 或 CPU），交给 Worker 时也用它', async () => {
    await installBoth();
    const linux = new ModelCatalog({ root, platform: 'linux', arch: 'x64', threads: 2 });
    expect(await linux.status('qwen3-asr-0.6b@candle')).toMatchObject({ state: 'installed', backend: 'candle', device: 'cpu' });
    expect(await linux.bundleFor('qwen3-asr-0.6b@candle')).toMatchObject({ backend: 'candle', device: 'cpu' });
    const changed: string[] = [];
    linux.onChange((id) => changed.push(id));
    linux.setWorkerDevice('candle', 'cuda');
    expect(changed.sort()).toEqual(
      [
        'htdemucs-ft@candle',
        'moss-transcribe-diarize@candle',
        'qwen-image-2.1@candle',
        'qwen3-asr-0.6b@candle',
        'qwen3-asr-1.7b@candle',
        'qwen3-tts-0.6b-base@candle',
        'qwen3-tts-0.6b-customvoice@candle',
        'qwen3-tts-1.7b-base@candle',
        'qwen3-tts-1.7b-customvoice@candle',
        'qwen3-tts-1.7b-voicedesign@candle',
        'indextts2@candle',
        'index-tts2.5@candle',
        'gpt-sovits-v2@candle',
        'voxcpm2@candle',
        'omnivoice@candle',
        'speaker-diarization@candle',
      ].sort(),
    );
    expect(await linux.status('qwen3-asr-0.6b@candle')).toMatchObject({ device: 'cuda' });
    expect(await linux.bundleFor('qwen3-asr-0.6b@candle')).toMatchObject({ device: 'cuda' });
    expect(await linux.bundleFor('qwen3-asr-0.6b@candle', { device: 'cpu' })).toMatchObject({ device: 'cpu' });
    linux.setWorkerDevice('candle', null);
    expect(await linux.status('qwen3-asr-0.6b@candle')).toMatchObject({ device: 'cpu' });
    // MLX 的设备是登记好的，不随握手变。
    const silicon = new ModelCatalog({ root, ...mac });
    silicon.setWorkerDevice('mlx', 'cpu');
    expect(await silicon.status(QWEN3_ASR_0_6B_BUNDLE)).toMatchObject({ device: 'metal' });
  });

  it('bundleFor 按协议规范 §4 给出绝对目录与清单里的文件', async () => {
    await installBoth();
    const catalog = new ModelCatalog({ root, ...mac, threads: 3 });
    const bundle = await catalog.bundleFor(QWEN3_ASR_0_6B_BUNDLE);
    expect(bundle).toEqual({
      bundleId: QWEN3_ASR_0_6B_BUNDLE,
      backend: 'mlx',
      device: 'metal',
      threads: 3,
      memoryBudgetBytes: null,
      components: {
        asr: {
          family: 'qwen3-asr',
          revision: asr.revision,
          dir: path.join(root, 'aufklarer', 'Qwen3-ASR-0.6B-MLX-4bit'),
          files: [
            { path: 'config.json', sha256: expect.stringMatching(/^[0-9a-f]{64}$/), byteLength: 7 },
            { path: 'model.safetensors', sha256: expect.any(String), byteLength: 11 },
            { path: 'sub/vocab.json', sha256: expect.any(String), byteLength: 2 },
          ],
        },
        vad: {
          family: 'silero-vad',
          revision: vad.revision,
          dir: path.join(root, 'aufklarer', 'Silero-VAD-v6.2.1-MLX'),
          files: [
            { path: 'config.json', sha256: expect.any(String), byteLength: 2 },
            { path: 'model.safetensors', sha256: expect.any(String), byteLength: 11 },
          ],
        },
      },
    });
    expect(path.isAbsolute(bundle.components.asr!.dir)).toBe(true);
  });

  it('「说话人区分」模型包：装好之后用它的识别模型包带上它的组件、权重计进常驻；MOSS 自己区分，没装时不带', async () => {
    await installBoth();
    const catalog = new ModelCatalog({ root, ...mac });
    const pack = catalog.definition(SPEAKER_DIARIZATION_BUNDLE)!;
    expect(pack).toMatchObject({ capability: 'diarize', label: '说话人区分' });
    expect(catalog.definition(QWEN3_ASR_0_6B_BUNDLE)!.diarization).toBe(SPEAKER_DIARIZATION_BUNDLE);
    expect(catalog.diarizationUsers(SPEAKER_DIARIZATION_BUNDLE)).toEqual(
      expect.arrayContaining([
        QWEN3_ASR_0_6B_BUNDLE,
        'qwen3-asr-1.7b@mlx-8bit',
        'whisper-large-v3@coreml',
        'whisper-large-v3-turbo@coreml',
      ]),
    );
    expect(catalog.diarizationUsers(SPEAKER_DIARIZATION_BUNDLE)).not.toContain('moss-transcribe-diarize@mlx-8bit');
    const local = async () =>
      (await new LocalProviderSource({ catalog, transcriber: null }).describe('local', 'view'))!.capabilities.transcribe!.models;

    // 没装：识别模型包不带说话人组件。
    const before = await catalog.workerWeightBytes(QWEN3_ASR_0_6B_BUNDLE);
    expect(Object.keys((await catalog.bundleFor(QWEN3_ASR_0_6B_BUNDLE)).components).sort()).toEqual(['asr', 'vad']);
    expect(await catalog.speakers(QWEN3_ASR_0_6B_BUNDLE)).toBe('none');
    expect(await catalog.speakers('moss-transcribe-diarize@mlx-8bit')).toBe('native');
    // 没装也说出要哪个模型包（界面据此给「下载」）；MOSS 自己区分，不给。
    expect(await local()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ modelId: QWEN3_ASR_0_6B_BUNDLE, speakers: 'none', diarizationPack: SPEAKER_DIARIZATION_BUNDLE }),
      ]),
    );
    expect((await local()).find((m) => m.modelId === 'moss-transcribe-diarize@mlx-8bit')).not.toHaveProperty('diarizationPack');
    expect((await local()).some((m) => m.modelId === SPEAKER_DIARIZATION_BUNDLE)).toBe(false);

    // 只装了一半（缺 WeSpeaker）还是不带。
    const segmentation = pack.components.segmentation!;
    const speaker = pack.components.speaker!;
    expect(speaker.optional).toBeFalsy();
    await writeRepo(root, segmentation.repo, segmentation.revision, { 'config.json': '{}', 'model.safetensors': 'weights-seg' });
    expect(await catalog.speakers(QWEN3_ASR_0_6B_BUNDLE)).toBe('none');
    await writeRepo(root, speaker.repo, speaker.revision, { 'config.json': '{}', 'model.safetensors': 'weights-spk' });

    expect((await catalog.status(SPEAKER_DIARIZATION_BUNDLE))?.state).toBe('installed');
    expect(await catalog.speakers(QWEN3_ASR_0_6B_BUNDLE)).toBe('pack');
    const bundle = await catalog.bundleFor(QWEN3_ASR_0_6B_BUNDLE);
    expect(bundle.components.segmentation).toMatchObject({ family: 'pyannote-segmentation', revision: segmentation.revision });
    expect(bundle.components.speaker).toMatchObject({ family: 'wespeaker', revision: speaker.revision });
    expect(await catalog.workerWeightBytes(QWEN3_ASR_0_6B_BUNDLE)).toBeGreaterThan(before!);
    expect(await local()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ modelId: QWEN3_ASR_0_6B_BUNDLE, speakers: 'pack', diarizationPack: SPEAKER_DIARIZATION_BUNDLE }),
      ]),
    );
  });

  it('清单里越出目录的路径视为没有清单', async () => {
    await installBoth();
    const manifestFile = path.join(root, ...vad.repo.split('/'), MANIFEST_FILE);
    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
    manifest.files[0].path = '../escape.json';
    await fs.writeFile(manifestFile, JSON.stringify(manifest));
    const catalog = new ModelCatalog({ root, ...mac });
    const status = await catalog.status(QWEN3_ASR_0_6B_BUNDLE);
    expect(status).toMatchObject({ state: 'not-installed', reason: 'incomplete' });
    expect(status!.detail).toContain('没有清单');
  });

  it('verify 显式校验 sha256 并缓存结果；enable 清掉', async () => {
    await installBoth();
    const catalog = new ModelCatalog({ root, ...mac });
    expect((await catalog.verify(QWEN3_ASR_0_6B_BUNDLE)).ok).toBe(true);
    // 同样大小、内容不同：只有 verify 发现得了。
    await fs.writeFile(path.join(catalog.repoDir(asr.repo), 'model.safetensors'), 'weights-ASR');
    expect(await catalog.status(QWEN3_ASR_0_6B_BUNDLE)).toMatchObject({ state: 'installed' });
    const result = await catalog.verify(QWEN3_ASR_0_6B_BUNDLE);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([{ repo: asr.repo, path: 'model.safetensors', problem: 'hash-mismatch' }]);
    expect(await catalog.status(QWEN3_ASR_0_6B_BUNDLE)).toMatchObject({ state: 'not-installed', reason: 'hash-mismatch' });
    catalog.enable(QWEN3_ASR_0_6B_BUNDLE);
    expect(await catalog.status(QWEN3_ASR_0_6B_BUNDLE)).toMatchObject({ state: 'installed' });
  });

  it('运行状态、停用与没有 Worker 叠加在磁盘状态之上', async () => {
    await installBoth();
    let worker = true;
    const catalog = new ModelCatalog({ root, ...mac, workerAvailable: () => worker });
    catalog.setRuntimeState(QWEN3_ASR_0_6B_BUNDLE, 'busy');
    expect(await catalog.status(QWEN3_ASR_0_6B_BUNDLE)).toMatchObject({ state: 'busy' });
    catalog.setRuntimeState(QWEN3_ASR_0_6B_BUNDLE, null);
    expect(await catalog.status(QWEN3_ASR_0_6B_BUNDLE)).toMatchObject({ state: 'installed' });
    catalog.block(QWEN3_ASR_0_6B_BUNDLE, 'error', 'resource', '反复崩溃');
    expect(await catalog.status(QWEN3_ASR_0_6B_BUNDLE)).toMatchObject({ state: 'error', reason: 'resource', detail: '反复崩溃' });
    catalog.enable(QWEN3_ASR_0_6B_BUNDLE);
    worker = false;
    expect(await catalog.status(QWEN3_ASR_0_6B_BUNDLE)).toMatchObject({ state: 'error', reason: 'worker-missing' });
  });

  const realRoot = '/Users/jim/Library/Application Support/BaoCut/models';
  // 只在显式要求时读真实目录（BAOCUT_REAL_MODELS_TEST=1）：平时的测试不碰用户的数据目录。
  const realAvailable =
    process.env.BAOCUT_REAL_MODELS_TEST === '1' &&
    process.platform === 'darwin' &&
    process.arch === 'arm64' &&
    fsSync.existsSync(path.join(realRoot, ...asr.repo.split('/'), MANIFEST_FILE));

  it.skipIf(!realAvailable)('读这台机器上真实的模型目录（只查大小，不算 hash）', async () => {
    const catalog = new ModelCatalog({ root: realRoot });
    const status = await catalog.status(QWEN3_ASR_0_6B_BUNDLE);
    expect(status?.state).toBe('installed');
    const bundle = await catalog.bundleFor(QWEN3_ASR_0_6B_BUNDLE);
    expect(bundle.components.asr!.files.length).toBeGreaterThan(0);
    expect(bundle.components.vad!.files.map((f) => f.path)).toContain('model.safetensors');
  });
});
