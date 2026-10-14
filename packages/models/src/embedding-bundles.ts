import type { ModelLicense } from '@baocut/protocol';
import { ModelsEmbedding as M } from '@baocut/protocol/messages/models/embedding.ts';
import type { BundleComponentSource, BundleDefinition, ComponentRelease } from './bundle-registry.ts';

/**
 * 本机语义检索的 embedding 模型包（EmbeddingGemma 2 检索集成方案 v0.1 §4.2；Model Worker 协议规范 §4.5）。`bundleId` 是
 * `<模型>@litert-lm`。两个包给人选：「文字搜索」（`embeddinggemma2-text`，只有文字编码器）与「多模态搜索」
 * （`embeddinggemma2-multimodal`，完整的 740M 包，另有图像编码器，用来按描述找画面）。装了多模态包就不必再装文字包。
 *
 * 权重是 litert-community 发布的 `.litertlm` 单文件，由 Model Worker 的 `litert-lm` 后端经 LiteRT-LM 的 C API 加载。C 库不随应用
 * 分发，是两个模型包共用的发布页组件 `litertlm-runtime`（`workerLibrary`）：随模型包下载、核对，解开到 `tools/litertlm-runtime/<版本>/`，
 * 交给 Worker 在加载时 `dlopen`。上游只为 macOS 发布了 C 库（一个 arm64 + x86_64 的通用 dylib，在 xcframework 的子目录里），
 * Windows 与 Linux 没有压缩包，模型包在那里报告为 `unsupported`。
 *
 * 大小与 sha256：C 库压缩包取自上游 v0.18.0 Releases，下载后重新算过；模型文件取自 Hugging Face 的 LFS 指针，下载后重新算过。
 * 许可：两个模型与 LiteRT-LM 都是 Apache-2.0。
 */

const MiB = 1024 * 1024;

/** 组件目录与镜像路径里 C 库的名字：`<toolsDir>/litertlm-runtime/<版本>/`。 */
export const LITERTLM_RUNTIME_TOOL = 'litertlm-runtime';

/** LiteRT-LM 的版本（C 库组件的版本与下载地址）。不进 `encoderProfileId`：那里只放 `EMBEDDING_VECTOR_COMPAT`。 */
export const LITERTLM_VERSION = '0.18.0';

/**
 * 向量兼容标签，进 `encoderProfileId`（检索规格 v0.1 §5.3 的「SDK/实现版本」）。升级 LiteRT-LM、换编译选项或换 Worker 时
 * 不跟着变；用 `tools/embedding-eval/reference-vectors.ts` 把固定的文字与合成帧重新编码，与仓库里存的参考向量比，任何一条
 * 余弦低于 0.9999 才把它加一（旧向量随之不再比较、索引重建），再重新生成参考。
 */
export const EMBEDDING_VECTOR_COMPAT = 'vec-v1';

const MAC_ASSET = {
  fileName: 'CLiteRTLM_mac.xcframework.zip',
  size: 45143303,
  sha256: '5f6ee68d95eeccb084c6e66d5ee47255e3020fa0fb29696dd0301ae26d6cfb4f',
  // 通用 dylib 在 xcframework 的这个子目录里；同目录的 `Headers/` 是子目录，不解开。
  archive: { format: 'zip' as const, skip: [], root: 'CLiteRTLM_mac.xcframework/macos-arm64_x86_64' },
  executable: 'libCLiteRTLM_mac.dylib',
};

export const LITERTLM_RUNTIME_RELEASE: ComponentRelease = {
  name: LITERTLM_RUNTIME_TOOL,
  version: LITERTLM_VERSION,
  urlTemplate: 'https://github.com/google-ai-edge/LiteRT-LM/releases/download/v{version}/{file}',
  // 只有 Apple Silicon：Intel Mac 的 Model Worker 构建不带 `backend-litert`，登记了会下载 200 多 MB 再在加载时失败；没有库包的
  // 平台显示 `unsupported`（v0.1 §4.3）。
  assets: { 'darwin-arm64': MAC_ASSET },
  workerLibrary: true,
};

const APACHE_LICENSE = (url: string): ModelLicense => ({
  name: 'Apache-2.0',
  url,
  commercialUse: true,
  // 许可摘要给人看：用 getter，读的时候（列出状态、序列化过线）按当前语言生成。
  get summary() {
    return M.apacheLicense().text;
  },
});

export const LITERTLM_RUNTIME_COMPONENT: BundleComponentSource = {
  family: 'litertlm-runtime',
  repo: 'google-ai-edge/LiteRT-LM',
  revision: `v${LITERTLM_VERSION}`,
  license: APACHE_LICENSE('https://github.com/google-ai-edge/LiteRT-LM/blob/main/LICENSE'),
  release: LITERTLM_RUNTIME_RELEASE,
};

/**
 * 量化兼容组。两个包的文字编码器在 LiteRT-LM 0.18.0 的 CPU 上出的向量逐位相同（2026-10-12 实测同一组句子，768 维最大差 0），
 * 所以同组、同空间：先装文字包、后装多模态包时旧索引仍可比较。`encoderProfileId` 仍随模型文件的 sha256 变。
 */
const QUANT_GROUP = 'litertlm-2d079ee2';

/** 两个包共用的文字编码器变体（进 `embeddingSpaceId`）。 */
const TEXT_ENCODER = 'text-270m';

const PROFILE = {
  variant: TEXT_ENCODER,
  quantGroup: QUANT_GROUP,
  outputSize: 768,
  dims: 512,
  maxInputTokens: 2048,
  // 与 SentenceTransformers 参考实现一致（逐条余弦 ≥ 0.98；不插入时只有 0.81–0.88）。
  insertSpecialTokens: true,
};

export const EMBEDDINGGEMMA2_TEXT_BUNDLE = 'embeddinggemma2-text@litert-lm';
export const EMBEDDINGGEMMA2_MULTIMODAL_BUNDLE = 'embeddinggemma2-multimodal@litert-lm';

const TEXT: BundleDefinition = {
  bundleId: EMBEDDINGGEMMA2_TEXT_BUNDLE,
  capability: 'embed',
  backend: 'litert-lm',
  device: 'cpu',
  components: {
    // 权重在前：安装按登记的顺序下载。
    embedding: {
      family: 'embeddinggemma2-litert',
      repo: 'litert-community/embeddinggemma-2-text-270m-litert-lm',
      revision: '9be6e8b90982095dc05c2bd162e4b954ee4dbac7',
    },
    'litertlm-runtime': LITERTLM_RUNTIME_COMPONENT,
  },
  label: 'EmbeddingGemma 2 Text 270M',
  license: APACHE_LICENSE('https://huggingface.co/litert-community/embeddinggemma-2-text-270m-litert-lm'),
  embedding: {
    ...PROFILE,
    modalities: ['text'],
    modelFile: 'embeddinggemma-2-text-270m.litertlm',
    modelSha256: '2d079ee2f6f066b1f368e8d7c819f55214eaef1d0513b312321901f30ab286fb',
  },
};

const MULTIMODAL: BundleDefinition = {
  bundleId: EMBEDDINGGEMMA2_MULTIMODAL_BUNDLE,
  capability: 'embed',
  backend: 'litert-lm',
  device: 'cpu',
  components: {
    embedding: {
      family: 'embeddinggemma2-litert',
      repo: 'litert-community/embeddinggemma-2-740m-litert-lm',
      revision: '24d962e906c7d332c6428e71c9676855024569e2',
    },
    'litertlm-runtime': LITERTLM_RUNTIME_COMPONENT,
  },
  label: 'EmbeddingGemma 2 740M',
  license: APACHE_LICENSE('https://huggingface.co/litert-community/embeddinggemma-2-740m-litert-lm'),
  embedding: {
    ...PROFILE,
    modalities: ['text', 'image'],
    // G0 多模态评测（`tools/embedding-eval/reports/g0-multimodal-2026-10-13.md`）的取法：长边 512 px 的 JPEG，每张 140 个视觉
    // token（模型的默认值）。截到 512 维与 768 维的检索结果相同（R@1 一致，正例与无答案的分数差 ≤ 0.012）。
    vision: { tokensPerImage: 140, frameEdge: 512, frameFormat: 'jpeg' },
    modelFile: 'embeddinggemma-2-740m.litertlm',
    modelSha256: 'e7a8a2204b91e0f96e92960e84a09a89212e1633dcb7575a9bf3378b4df77f4c',
  },
};

/** 文字包在前：没有选过时按这个次序挑已装好的（多模态包也满足文字检索）。 */
export const EMBEDDING_BUNDLES: readonly BundleDefinition[] = [TEXT, MULTIMODAL];

/**
 * Worker 加载 embedding 模型包后，在模型文件与 C 库压缩包大小之外还要的内存（字节，资源调度计 `memory`）。2026-10-12 在 Apple M 系列的
 * CPU 上实测：文字包加载后常驻约 365 MB、16 条约 500 字的批次峰值约 475 MB；多模态包加载后约 760 MB（整个文件都映射进来）。
 * 文件 + 压缩包 + 这个余量分别约 466 MB 与 786 MB，覆盖实测值。
 */
export const EMBEDDING_WORKER_OVERHEAD_BYTES = 256 * MiB;

/** 有图像编码器的模型包另计的内存：打开图像编码器后常驻约多 1 GB（2026-10-13 实测）。按能打开计，不论这次加载有没有打开。 */
export const EMBEDDING_VISION_OVERHEAD_BYTES = 1024 * MiB;
