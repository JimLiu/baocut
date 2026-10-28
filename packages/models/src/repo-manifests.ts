import type { ComponentRelease } from './bundle-registry.ts';
import { hostPlatformKey, releaseAsset } from './release-component.ts';

/**
 * 内置的仓库清单（架构设计 §6.3；Model Worker 协议规范 §4）：每个登记的组件（上游仓库的一个固定版本）要下载哪些文件，
 * 每个文件的 sha256 与大小。下载器只下载这里列出的文件，逐个按这里的 sha256 校验；装好之后写进仓库目录的
 * `.bcut-manifest.json`。
 *
 * 规则：
 * - 不编造哈希。`sha256` 为 null 的文件没有可信的哈希，安装被拒绝（`MODEL_MANIFEST_INCOMPLETE`），不会「下载了再算」。
 * - `size` 为 null 表示离线时无法确认大小：安装计划先向下载来源发 HEAD 取得大小，取不到时总字节数报告为未知
 *   （不伪造百分比），确认时用 `estimatedBytes`。下载完成后以实际字节与 sha256 为准写入清单。
 * - `provenance` 记下哈希从哪里来；没有在这个环境里重新核对过的，列在架构设计 §14 的待评审事项里。
 */

export interface RepoFileSpec {
  /** 相对仓库目录，`/` 分隔。 */
  path: string;
  size: number | null;
  sha256: string | null;
}

export interface RepoManifestSpec {
  /** `<owner>/<repo>`：模型目录里的位置（`<models-root>/<owner>/<repo>/`），也是组件登记的 `repo`。 */
  repo: string;
  /**
   * 下载来源的 `<owner>/<repo>`，与 `repo` 不同时才写：几个模型包要的文件在上游同一个仓库、同一版本里，又要各装各删时，
   * 各自登记在兄弟目录名下，下载仍从上游仓库取（whisper.cpp 的 GGML 权重）。
   */
  sourceRepo?: string;
  revision: string;
  files: RepoFileSpec[];
  /** 大小未知时的估计（字节），只用于确认与提示。 */
  estimatedBytes: number;
  /** 哈希的来源。 */
  provenance: string;
}

/** 本机语义检索：大小与 sha256 取自下载来源在这个版本上的 LFS 记录，按版本下载后在本机重新算过，一致。 */
const EMBEDDING_HUB = "Sizes and sha256 come from the download source's LFS records at this revision; recomputed after downloading at this revision, identical";
const LEGACY_PINNED = 'sha256 pinned for the same revision by legacy BaoCut (baocut-app, catalog.rs in bcut-models); not re-verified offline in this repo; sizes unknown';
/**
 * 本地语音合成（audio.cpp 的 Q8 GGUF）：大小与 sha256 取自下载来源在这个版本上的 LFS 记录；OmniVoice 的 GGUF 在本机按版本下载后
 * 重新算过，一致，其余的没有在本机装过。
 */
const TTS_GGUF_HUB =
  "Sizes and sha256 come from the download source's LFS records at this revision; the OmniVoice GGUF was downloaded at this revision and rehashed, identical; the others were not installed locally";

/** 本地识别：sha256 取自旧版的固定清单；大小与哈希已和本机装好的同一版本逐个核对。 */
const ASR_PINNED_LOCAL =
  'sha256 pinned for the same revision by legacy BaoCut (baocut-app, catalog.rs in bcut-models); sizes and hashes checked one by one against a local install of the same revision';
/** Whisper 的 MLX 权重：大小与 safetensors 的 sha256 取自下载来源在这个版本上的 LFS 记录，config.json 按版本下载后计算。 */
const MLX_WHISPER_HUB = 'Sizes and the sha256 of model.safetensors come from the download source\'s LFS records at this revision; config.json computed after downloading at this revision';
/** 本地人声分离：sha256 取自旧版的固定清单；大小与哈希已和本机装好的同一版本逐个核对。 */
const SEP_PINNED_LOCAL = ASR_PINNED_LOCAL;

/**
 * 本地文生图（Qwen-Image-2.1）：9 个文件（`model_index.json`、`processor/tokenizer.json`、`scheduler/scheduler_config.json` 与三段的
 * `config.json`、`model.safetensors`）的 sha256 取自旧版的固定清单；其余 11 个旧版只记了大小，sha256 按本机装好的同一版本计算。
 * 全部 20 个的大小与哈希已和本机装好的同一版本逐个核对。
 */
const IMAGE_PINNED_LOCAL =
  'sha256 of 9 files pinned for the same revision by legacy BaoCut (baocut-app, catalog.rs in bcut-models); the other 11 computed from a local install of the same revision; all sizes and hashes checked one by one against the local install';
/**
 * 本地文生图的 Turbo 包（mlx-serve 的 8-bit 转换）：四个 safetensors 的大小与 sha256 取自下载来源在这个版本上的 LFS 记录；配置文件
 * 与分词器（不走 LFS）按这个版本下载后计算。11 个文件都和本机装好的同一版本逐个核对过。仓库里 mlx-serve 自己的元数据（根目录的
 * `config.json`）、说明、示例图与许可文本不下载。
 */
const IMAGE_TURBO_HUB =
  "Sizes and the sha256 of the four safetensors files come from the download source's LFS records at this revision; the seven config and tokenizer files were hashed after downloading at this revision; all 11 checked one by one against a local install";
/**
 * 本地音乐生成（YuE2 的 GGUF）：两个 GGUF 的大小与 sha256 取自下载来源在这个版本上的 LFS 记录；四个配置文件（不走 LFS）按版本
 * 从下载来源流式读下来计算。没有在本机装过，也没有跑过推理。
 */
const MUSIC_PINNED_HUB =
  "Sizes and the sha256 of the two GGUF files come from the download source's LFS records at this revision; the four sidecar files were streamed from the download source at this revision and hashed; no local install or inference in this repo";

export const REPO_MANIFESTS: readonly RepoManifestSpec[] = [
  {
    repo: 'aufklarer/Qwen3-ASR-0.6B-MLX-4bit',
    revision: 'bc441bd1e4295c1f42d9879f056049a925b6e013',
    files: [
      { path: 'config.json', size: null, sha256: '923618cf5ca452fda0253a6be5c1a17f94a2e4851d3b98beb45848565587bd72' },
      { path: 'merges.txt', size: null, sha256: '8831e4f1a044471340f7c0a83d7bd71306a5b867e95fd870f74d0c5308a904d5' },
      { path: 'model.safetensors', size: null, sha256: '70c7e67e588062adce4f10796e47ad42ead51c6671eda61a0987eae38ca95ddf' },
      { path: 'model.safetensors.index.json', size: null, sha256: 'e3bb80ef0fd42a5be07b04e90c97d60460bbde8af3531e0bfe9100a61404d81a' },
      { path: 'tokenizer_config.json', size: null, sha256: '4942d005604266809309cabc9f4e9cb89ce855d59b14681fdc0e1cc62ea26c4c' },
      { path: 'vocab.json', size: null, sha256: 'ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910' },
    ],
    estimatedBytes: 680 * 1024 * 1024,
    provenance: LEGACY_PINNED,
  },
  {
    repo: 'aufklarer/Silero-VAD-v6.2.1-MLX',
    revision: '0046cea48b26401909b24292b688fbc9b6322bc5',
    files: [
      { path: 'config.json', size: null, sha256: '59a798e628bf152b85db67cc5441cbc704b140a2e61854e2052d879c1d051813' },
      { path: 'model.safetensors', size: null, sha256: '8367dac03e6c9ae0e20b71886655e9b9cdc459eac66625e8afd770573e43bc0b' },
    ],
    estimatedBytes: Math.round(1.2 * 1024 * 1024),
    provenance: LEGACY_PINNED,
  },
  // ---- 本地识别：大一档的 Qwen3-ASR、共用的对齐器与说话人模型、Whisper、MOSS（bundle-registry.ts）----
  {
    repo: 'aufklarer/Qwen3-ASR-1.7B-MLX-8bit',
    revision: 'e5450a26d1fd417c45fc9c405651ddc3180a27a6',
    files: [
      { path: 'config.json', size: 7188, sha256: '1b76b3b6c655fc54595da025f7a96474ad9fa86363303fbdd61a7d8483ccfaf7' },
      { path: 'merges.txt', size: 1671853, sha256: '8831e4f1a044471340f7c0a83d7bd71306a5b867e95fd870f74d0c5308a904d5' },
      { path: 'model.safetensors', size: 2463307541, sha256: 'bf304b009cc7eca79283056f787b44c952d24ac22cec787b39732bba3c23c13c' },
      { path: 'model.safetensors.index.json', size: 78968, sha256: '0a5d0ec11188602242ff81a9969883d0fdeb98cd5d85cd1413089d897c201af5' },
      { path: 'tokenizer_config.json', size: 12487, sha256: '4942d005604266809309cabc9f4e9cb89ce855d59b14681fdc0e1cc62ea26c4c' },
      { path: 'vocab.json', size: 2776833, sha256: 'ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910' },
    ],
    estimatedBytes: 2467854870,
    provenance: ASR_PINNED_LOCAL,
  },
  {
    repo: 'aufklarer/Qwen3-ForcedAligner-0.6B-4bit',
    revision: 'f0e9f12a0ddbcb5f1e1b7f0339090628f1cede1d',
    files: [
      { path: 'config.json', size: 5982, sha256: 'd616c65d46c4b90bdc651b0a0963ea932732241140f337f9bb6b0335a9c8ef09' },
      { path: 'merges.txt', size: 1671853, sha256: '8831e4f1a044471340f7c0a83d7bd71306a5b867e95fd870f74d0c5308a904d5' },
      { path: 'model.safetensors', size: 978674048, sha256: '8187bcb2ab9046cbb274559523d21f60249410ccc561682bc5860b07101c5568' },
      { path: 'quantize_config.json', size: 214, sha256: 'ca0ac4de959081ae1ec67cd57f441faa4bb5f6c4704e8700a83879807f11b490' },
      { path: 'tokenizer_config.json', size: 12666, sha256: '3ab80063f8511deb9566e6ad438d17b7a6277fcffd52d92854112f19d36bd81c' },
      { path: 'vocab.json', size: 2776833, sha256: 'ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910' },
    ],
    estimatedBytes: 983141596,
    provenance: ASR_PINNED_LOCAL,
  },
  {
    repo: 'aufklarer/WeSpeaker-ResNet34-LM-MLX',
    revision: '26499ce11ad1b48ac96aacc8d6fa433f941bdc96',
    files: [
      { path: 'config.json', size: 237, sha256: 'ced07e72c93a98ff93cb6ab8f05ddc725c49407d6500b801370b671f5a051ae7' },
      { path: 'model.safetensors', size: 26526952, sha256: 'f56204883f2de969f584af7893e5373575556b422190c14c206a5fd94f3d7fe6' },
    ],
    estimatedBytes: 26527189,
    provenance: ASR_PINNED_LOCAL,
  },
  {
    repo: 'aufklarer/Pyannote-Segmentation-MLX',
    revision: 'abef0110277063f0ea117a802832a3eba22af84c',
    files: [
      { path: 'config.json', size: 644, sha256: '5ce54491e6cb094cb1aa85b5af9f065492e97fd3f7acabad1719ebef01689bba' },
      { path: 'model.safetensors', size: 5960404, sha256: 'd1630fa2c22f47e4c89034f8d5e3aff99884f55347d48ce70dd306328b4421f5' },
    ],
    estimatedBytes: 5961048,
    provenance: ASR_PINNED_LOCAL,
  },
  {
    repo: 'argmaxinc/whisperkit-coreml',
    revision: '97a5bf9bbc74c7d9c12c755d04dea59e672e3808',
    files: [
      {
        path: 'openai_whisper-large-v3_947MB/AudioEncoder.mlmodelc/analytics/coremldata.bin',
        size: 243,
        sha256: '387cff66366595358aa7b02ca8a5c587000dcef963c3a38c24a77a765757881d',
      },
      {
        path: 'openai_whisper-large-v3_947MB/AudioEncoder.mlmodelc/coremldata.bin',
        size: 348,
        sha256: '63b4db8a854c7a64a10b0a0b97048d6d8ee557536367f44dc9fb95fad4bffcf6',
      },
      {
        path: 'openai_whisper-large-v3_947MB/AudioEncoder.mlmodelc/metadata.json',
        size: 1933,
        sha256: 'b0deaf50cf43bbd8610b93ef694a1380ada2ee17680e6f881a7a03c26fb3c565',
      },
      {
        path: 'openai_whisper-large-v3_947MB/AudioEncoder.mlmodelc/model.mil',
        size: 1138803,
        sha256: '4b06d167d112929866a7d8054772f4fd0b7804f40f4233aeff851eefbe57d0f5',
      },
      {
        path: 'openai_whisper-large-v3_947MB/AudioEncoder.mlmodelc/weights/weight.bin',
        size: 353908416,
        sha256: '9b819fb62291e63c6b5596238a73964bfbdaccb8a12fd5672e7eb32639a57f83',
      },
      {
        path: 'openai_whisper-large-v3_947MB/MelSpectrogram.mlmodelc/analytics/coremldata.bin',
        size: 243,
        sha256: '7f478e6afa8fdee3711d97b00728f82ee4dcdf2912f7ff033ee0dfcf57bf28bb',
      },
      {
        path: 'openai_whisper-large-v3_947MB/MelSpectrogram.mlmodelc/coremldata.bin',
        size: 329,
        sha256: 'a888718e98af679eee42db9e3609627472c32f77e4fdda28f3735960cbf526b3',
      },
      {
        path: 'openai_whisper-large-v3_947MB/MelSpectrogram.mlmodelc/metadata.json',
        size: 1878,
        sha256: 'dcb839ca16e598dfb1720af0294a8e21ab18b3e5afab136093aa2fd5f5cfc923',
      },
      {
        path: 'openai_whisper-large-v3_947MB/MelSpectrogram.mlmodelc/model.mil',
        size: 10166,
        sha256: '6e0c6fc2cb23de4e5b6c25897047c12402da201b5a8717fa5ee9f3108b1cb702',
      },
      {
        path: 'openai_whisper-large-v3_947MB/MelSpectrogram.mlmodelc/weights/weight.bin',
        size: 373376,
        sha256: '81275398516781f9755514a5ab85db4687374dd611013625f3d4493588783968',
      },
      {
        path: 'openai_whisper-large-v3_947MB/TextDecoder.mlmodelc/analytics/coremldata.bin',
        size: 243,
        sha256: '1a999e3332b206c426f9252001a3593702d3542aa4a00242f99e9baaeda4a063',
      },
      {
        path: 'openai_whisper-large-v3_947MB/TextDecoder.mlmodelc/coremldata.bin',
        size: 637,
        sha256: '9b3e5707277d8c7297ea5e6075801c6d56a054e7ed1ab5dfec5692292c62e145',
      },
      {
        path: 'openai_whisper-large-v3_947MB/TextDecoder.mlmodelc/metadata.json',
        size: 4959,
        sha256: '6ee6819dc8ad4990c626c52c711cc65c5c19536577bc5b590a7d1afaecda68c5',
      },
      {
        path: 'openai_whisper-large-v3_947MB/TextDecoder.mlmodelc/model.mil',
        size: 1943315,
        sha256: '939d1919af974fee08186a36131c617ff004d63ccf9ebbb4a6314274e88960ec',
      },
      {
        path: 'openai_whisper-large-v3_947MB/TextDecoder.mlmodelc/weights/weight.bin',
        size: 590719924,
        sha256: 'e53c8476c43310ad9fd2f4be996b7d803208428b0b137848972932406a30ef2f',
      },
      {
        path: 'openai_whisper-large-v3_947MB/config.json',
        size: 1163,
        sha256: '798b69c08cf93b2b03d94bea6eb3eb25fd4712259712d8a62ed2483fdf818a9e',
      },
      {
        path: 'openai_whisper-large-v3_947MB/generation_config.json',
        size: 2810,
        sha256: 'd24f9cca0f448609a71ae044b736023706382f45e9700e0dffb2559d10cf1fea',
      },
    ],
    estimatedBytes: 948108786,
    provenance: ASR_PINNED_LOCAL,
  },
  {
    repo: 'aufklarer/Whisper-Large-v3-Turbo-CoreML',
    revision: 'a8e93b2084b3d0a09765b2e3a5602a3d2b8f8d25',
    files: [
      {
        path: 'AudioEncoder.mlmodelc/analytics/coremldata.bin',
        size: 243,
        sha256: 'b58d36a7f4a729570b46b424ed8d847baefa07580e6cb9d47773ae738f8b845a',
      },
      {
        path: 'AudioEncoder.mlmodelc/coremldata.bin',
        size: 348,
        sha256: 'ffa9eb76e8e9d9be75a4d527e5249e61d67fd43081c5aa110fd24efa6c8c5ea3',
      },
      {
        path: 'AudioEncoder.mlmodelc/metadata.json',
        size: 1824,
        sha256: '3f8920fecd553c40dfc978e1b2664cefbac80d97937c2c160e079b37cfa95e13',
      },
      {
        path: 'AudioEncoder.mlmodelc/model.mil',
        size: 7175750,
        sha256: '9aac7799f12bc5fc414cb0bd6b60536d4fb7723d8bb0d879e3c0ceb220b224aa',
      },
      {
        path: 'AudioEncoder.mlmodelc/model.mlmodel',
        size: 441653,
        sha256: 'c5eb570c19871d7b0c59e0a84718cc9c8cde77a94273886de87e866961262e2c',
      },
      {
        path: 'AudioEncoder.mlmodelc/weights/weight.bin',
        size: 1273974400,
        sha256: '98daf651a919978e28fe185daf55ce2f70085a8e59fa07fe8a4d08c87d368ae4',
      },
      {
        path: 'MelSpectrogram.mlmodelc/analytics/coremldata.bin',
        size: 243,
        sha256: 'c5be419f8622083ac7046306400643539f0e7577c843448c36defc090d41e7ce',
      },
      {
        path: 'MelSpectrogram.mlmodelc/coremldata.bin',
        size: 329,
        sha256: '98efa1e351b759e078c4044668926d32bee886caf7596ae897e08e21da45565a',
      },
      {
        path: 'MelSpectrogram.mlmodelc/metadata.json',
        size: 1850,
        sha256: '2bc552e09a6f124d9e6c178dd1a6979e010206acb26308b2224887c9dcbeb35f',
      },
      {
        path: 'MelSpectrogram.mlmodelc/model.mil',
        size: 10143,
        sha256: 'c270b95b5f81d7f7d0b8a3e8f991d4e5812a37cad29349868a35b91f3a6a4463',
      },
      {
        path: 'MelSpectrogram.mlmodelc/weights/weight.bin',
        size: 373376,
        sha256: '009d9fb8f6b589accfa08cebf1c712ef07c3405229ce3cfb3a57ee033c9d8a49',
      },
      {
        path: 'TextDecoder.mlmodelc/analytics/coremldata.bin',
        size: 243,
        sha256: '47703aed03fbfa5128e118cfe6519024006f953a53e921d66003f1412c27996c',
      },
      {
        path: 'TextDecoder.mlmodelc/coremldata.bin',
        size: 633,
        sha256: '605dad4099a82cf2c7afe93e6d8e322f1c16d4160ab27bd017ec2517b81c1bdd',
      },
      {
        path: 'TextDecoder.mlmodelc/metadata.json',
        size: 4756,
        sha256: 'de6afb1e8fa1d01568b8d96283ca17af19f6124f151d0fdbdbd5917edc7b4836',
      },
      { path: 'TextDecoder.mlmodelc/model.mil', size: 132680, sha256: '1a1c2ec962fc7c9d2de9e2e4cf2d3827c8671f86a918b5698c00bf62c322ed3f' },
      {
        path: 'TextDecoder.mlmodelc/model.mlmodel',
        size: 113164,
        sha256: '03b79e4355e814c56239ea809e5d8f6432d70d74256bc9d70c27184fe9fcec48',
      },
      {
        path: 'TextDecoder.mlmodelc/weights/weight.bin',
        size: 343933748,
        sha256: '47b2703aa37448e09cf2f06e45984fabd5ded4c34ba3400cec38a5294af39dc1',
      },
      {
        path: 'TextDecoderContextPrefill.mlmodelc/analytics/coremldata.bin',
        size: 243,
        sha256: '97639d36c7b137ea51c3c39b175911788f4d4a601ab03cd67a4b14164c3145e1',
      },
      {
        path: 'TextDecoderContextPrefill.mlmodelc/coremldata.bin',
        size: 380,
        sha256: '2c159f5c862ec187092ea58e755d8c0b298952e22f3d75da023d7693c1c7389e',
      },
      {
        path: 'TextDecoderContextPrefill.mlmodelc/metadata.json',
        size: 2240,
        sha256: 'eb88dc350fa6748a8bc3fa5fb10958152c138752ebbbac1824d2f99b4c9fc068',
      },
      {
        path: 'TextDecoderContextPrefill.mlmodelc/model.mil',
        size: 4092,
        sha256: '990ff5052fd817e28ba7c34d9d06d324c69c7c0630b6eaac9cfdf08329dbcb34',
      },
      {
        path: 'TextDecoderContextPrefill.mlmodelc/weights/weight.bin',
        size: 12288192,
        sha256: '1310070082639173e9d81508c5f220692d489e85655aa6883cc1c7506da7fcfd',
      },
      { path: 'config.json', size: 1149, sha256: 'f01d83dd891791d6f12421c05d3ed8ebbe70866f10d6c9a7a7e80b558ce5a0f1' },
      { path: 'generation_config.json', size: 2767, sha256: '7fbb053a023be11fbeccd8421811610308143daa93d9617c52aab4a0fa1491c6' },
    ],
    estimatedBytes: 1638464446,
    provenance: ASR_PINNED_LOCAL,
  },
  {
    repo: 'openai/whisper-large-v3',
    revision: '06f233fe06e710322aca913c1bc4249a0d71fce1',
    files: [
      { path: 'added_tokens.json', size: 34648, sha256: '3c51f66c4c21f9e126970078f11ae77a78c74aee8df606ee9daba86e467108e0' },
      // MLX 包的解码配置（语言 token 表、抑制表）：mlx-community 的仓库没有它，按这个版本下载后计算。早先装好的分词器组件因此缺这一个
      // 文件，「只下载缺的组件」会补上。
      { path: 'generation_config.json', size: 3903, sha256: 'fbdfa70135de9b1d31553393f14e80aaeb1936ea36576b2ba864055943c09d23' },
      { path: 'merges.txt', size: 493869, sha256: '2df2990a395e35e8dfbc7511e08c12d56018d8d04691e0133e5d63b21e154dc6' },
      { path: 'normalizer.json', size: 52666, sha256: 'bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd' },
      { path: 'preprocessor_config.json', size: 340, sha256: '7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711' },
      { path: 'special_tokens_map.json', size: 2072, sha256: '1c70773c078cb2ca96e0fcff113102f1d3e2b1504272c3bb63b035d4a6700d87' },
      { path: 'tokenizer.json', size: 2480617, sha256: '6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca' },
      { path: 'tokenizer_config.json', size: 282843, sha256: '844b642c73a91359722f47b35705f7174686df33d252695d8572cf9ac03a6389' },
      { path: 'vocab.json', size: 1036558, sha256: 'e2aa043ef015641d363d8288e7c241c85e36a5c761fb303598e0710233344387' },
    ],
    estimatedBytes: 4387516,
    provenance: `${ASR_PINNED_LOCAL}; generation_config.json computed after downloading at this revision`,
  },
  // Whisper 的 MLX 权重（mlx-community 的 fp16 转换）：分词器与 generation_config.json 在 openai/whisper-large-v3。
  {
    repo: 'mlx-community/whisper-large-v3-fp16',
    revision: '5467ef1f82cf0e110f521092acb434d9c82b5d5a',
    files: [
      { path: 'config.json', size: 269, sha256: '34982ce6ae286095000f82ae9583b3431639e8b092bf60c961f203745e6500e3' },
      { path: 'model.safetensors', size: 3083275629, sha256: '8c41a4ff9596c44de223d104845c98bc222995f34717f3f4214898d53e95a1c0' },
    ],
    estimatedBytes: 3083275898,
    provenance: MLX_WHISPER_HUB,
  },
  {
    repo: 'mlx-community/whisper-large-v3-turbo-fp16',
    revision: '258e98b1f53da60a0a51c1e45e480ffa3ec71e23',
    files: [
      { path: 'config.json', size: 268, sha256: 'b34fc29e4e11e0a25e812775dd67f4dd16fc2c8eb43d28ae25ff7d660ecb6379' },
      { path: 'model.safetensors', size: 1613977612, sha256: '951ed3fc1203e6a62467abb2144a96ce7eafca8fa77e3704fdb8635ff3e7f8a6' },
    ],
    estimatedBytes: 1613977880,
    provenance: MLX_WHISPER_HUB,
  },
  // whisper.cpp 的 GGML 权重：上游同一仓库、同一版本；large-v3 登记在兄弟目录名下，两个模型包各装各删。
  {
    repo: 'ggerganov/whisper.cpp-large-v3',
    sourceRepo: 'ggerganov/whisper.cpp',
    revision: '5359861c739e955e79d9a303bcbc70fb988958b1',
    files: [{ path: 'ggml-large-v3-q5_0.bin', size: null, sha256: 'd75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1' }],
    estimatedBytes: 1031 * 1024 * 1024,
    provenance: LEGACY_PINNED,
  },
  {
    repo: 'ggerganov/whisper.cpp',
    revision: '5359861c739e955e79d9a303bcbc70fb988958b1',
    files: [
      { path: 'ggml-large-v3-turbo-q8_0.bin', size: null, sha256: '317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1' },
    ],
    estimatedBytes: 834 * 1024 * 1024,
    provenance: LEGACY_PINNED,
  },
  {
    repo: 'OpenMOSS-Team/MOSS-Transcribe-Diarize',
    revision: 'e5118b411bf5a77d7a90c4941066bec93c967312',
    files: [
      { path: 'added_tokens.json', size: 707, sha256: 'c0284b582e14987fbd3d5a2cb2bd139084371ed9acbae488829a1c900833c680' },
      { path: 'config.json', size: 2335, sha256: '2b2b7a6e61334152bdd7ecf8a4da3073b4940a097e193d1d2b22093e77535234' },
      { path: 'generation_config.json', size: 107, sha256: 'e53a4b3ce4f944230cf1ca8fed0c42f4ff0d8c1443eaf98b5315d987334dd9e4' },
      { path: 'merges.txt', size: 1671853, sha256: '8831e4f1a044471340f7c0a83d7bd71306a5b867e95fd870f74d0c5308a904d5' },
      {
        path: 'model-00000-of-00001.safetensors',
        size: 1817113576,
        sha256: '9a0ceb4ab7330357db3ff583dba8d83625d5b733b00e1d55d6970e11b07026c4',
      },
      { path: 'model.safetensors.index.json', size: 65401, sha256: '0345ac5d8f360abe4e9adadb5fecd38e7730052b75f64bb58182818b1544cc36' },
      { path: 'preprocessor_config.json', size: 315, sha256: 'ba2e601484abc80f4cded977f9a4fd4a53175b7d35c2f2511f0cfc3a32ad2499' },
      { path: 'processor_config.json', size: 292, sha256: 'a978c2dd54a65b576c3dae4b654fe9bcbac1184c6db2df0afb2c90fcdc872ae7' },
      { path: 'special_tokens_map.json', size: 613, sha256: '76862e765266b85aa9459767e33cbaf13970f327a0e88d1c65846c2ddd3a1ecd' },
      { path: 'tokenizer.json', size: 11423222, sha256: 'bcf03774334462d6e34b5005cb11120a62275f146ee2953e68731ecdbce84fbb' },
      { path: 'tokenizer_config.json', size: 503, sha256: '61d04c96104177240688396655ae3f7cf38ce2ea036db867a1d2b6883e27c3d5' },
      { path: 'vocab.json', size: 2776833, sha256: 'ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910' },
    ],
    estimatedBytes: 1833055757,
    provenance: ASR_PINNED_LOCAL,
  },
  // ---- 本地语音合成（speech-bundles.ts）：上游同一仓库、同一版本，每个模型包登记在兄弟目录名下，只下载自己的 GGUF ----
  {
    repo: 'audio-cpp/audio.cpp-gguf-qwen3-tts-0.6b-base',
    sourceRepo: 'audio-cpp/audio.cpp-gguf',
    revision: 'f861648c0c1f4da9f18e9a0ce5e217b0679bb2f5',
    files: [{ path: 'Qwen3-TTS-12Hz-0.6B-Base-GGUF/qwen3-tts-12hz-0.6b-base-q8_0.gguf', size: 1991211136, sha256: '771420bd20ff5f35407b4fa9cf9c5461e153800d3d772ef51c9febc0a520855d' }],
    estimatedBytes: 1991211136,
    provenance: TTS_GGUF_HUB,
  },
  {
    repo: 'audio-cpp/audio.cpp-gguf-qwen3-tts-1.7b-base',
    sourceRepo: 'audio-cpp/audio.cpp-gguf',
    revision: 'f861648c0c1f4da9f18e9a0ce5e217b0679bb2f5',
    files: [{ path: 'Qwen3-TTS-12Hz-1.7B-Base-GGUF/qwen3-tts-12hz-1.7b-base-q8_0_v2.gguf', size: 2695175104, sha256: 'b55e06c7890d43c208d15aed8b4ed3f18215f295e47d5960e061b15bff338ab0' }],
    estimatedBytes: 2695175104,
    provenance: TTS_GGUF_HUB,
  },
  {
    repo: 'audio-cpp/audio.cpp-gguf-qwen3-tts-1.7b-customvoice',
    sourceRepo: 'audio-cpp/audio.cpp-gguf',
    revision: 'f861648c0c1f4da9f18e9a0ce5e217b0679bb2f5',
    files: [{ path: 'Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF/qwen3-tts-12hz-1.7b-customvoice-q8_0.gguf', size: 2817044064, sha256: '3cfaac8e9f13554f6daea3c5e0c53fede71ef5500cbaae7445e5fc3a5bb12e72' }],
    estimatedBytes: 2817044064,
    provenance: TTS_GGUF_HUB,
  },
  {
    repo: 'audio-cpp/audio.cpp-gguf-qwen3-tts-1.7b-voicedesign',
    sourceRepo: 'audio-cpp/audio.cpp-gguf',
    revision: 'f861648c0c1f4da9f18e9a0ce5e217b0679bb2f5',
    files: [{ path: 'Qwen3-TTS-12Hz-1.7B-VoiceDesign-GGUF/qwen3-tts-12hz-1.7b-voicedesign-q8_0.gguf', size: 2816988960, sha256: '1bcef9a8c021072fca40e00498e00af9091fbe6d3ae4f87567cfee885d6c7554' }],
    estimatedBytes: 2816988960,
    provenance: TTS_GGUF_HUB,
  },
  {
    repo: 'audio-cpp/audio.cpp-gguf-indextts2',
    sourceRepo: 'audio-cpp/audio.cpp-gguf',
    revision: 'f861648c0c1f4da9f18e9a0ce5e217b0679bb2f5',
    files: [{ path: 'IndexTTS2-GGUF/index-tts2-q8_0.gguf', size: 3633888608, sha256: 'f9be73ac5b6cbdc5f603f04dcb6c9fe37b3a301a365a1ea8d580d3ef7ba22e8e' }],
    estimatedBytes: 3633888608,
    provenance: TTS_GGUF_HUB,
  },
  {
    repo: 'audio-cpp/audio.cpp-gguf-indextts2.5',
    sourceRepo: 'audio-cpp/audio.cpp-gguf',
    revision: 'f861648c0c1f4da9f18e9a0ce5e217b0679bb2f5',
    files: [{ path: 'IndexTTS2.5-GGUF/index-tts2_5-q8_0.gguf', size: 3502955328, sha256: '5e827b2072042e4a1b21ccf24a5cb4f71cb1011403067a0a9b039311d8b38628' }],
    estimatedBytes: 3502955328,
    provenance: TTS_GGUF_HUB,
  },
  {
    repo: 'audio-cpp/audio.cpp-gguf-voxcpm2',
    sourceRepo: 'audio-cpp/audio.cpp-gguf',
    revision: 'f861648c0c1f4da9f18e9a0ce5e217b0679bb2f5',
    files: [{ path: 'VoxCPM2-GGUF/voxcpm2-q8_0.gguf', size: 2955000480, sha256: 'c8e01ab4416011e12a28f24ede298a1aa5ce64b43f8e8aaad53b1e2fe7c96432' }],
    estimatedBytes: 2955000480,
    provenance: TTS_GGUF_HUB,
  },
  {
    repo: 'audio-cpp/audio.cpp-gguf-omnivoice',
    sourceRepo: 'audio-cpp/audio.cpp-gguf',
    revision: 'f861648c0c1f4da9f18e9a0ce5e217b0679bb2f5',
    files: [{ path: 'OmniVoice-GGUF/omnivoice-q8_0.gguf', size: 1350288416, sha256: '2f4be637278043c6842de5b85d681532030e9eb6ffe0f8b0e320f68238e3da8b' }],
    estimatedBytes: 1350288416,
    provenance: TTS_GGUF_HUB,
  },
  {
    repo: 'audio-cpp/audio.cpp-gguf-fish-s2-pro',
    sourceRepo: 'audio-cpp/audio.cpp-gguf',
    revision: 'f861648c0c1f4da9f18e9a0ce5e217b0679bb2f5',
    files: [{ path: 'Fish-Audio-S2-Pro-GGUF/fish-audio-s2-pro-q8_0.gguf', size: 6317911232, sha256: '4ffc169447b7a26df8bf49e8637adb4000bfa763a22c018b6c03968564259d0b' }],
    estimatedBytes: 6317911232,
    provenance: TTS_GGUF_HUB,
  },
  // ---- 本地人声分离（bundle-registry.ts 的 htdemucs-ft@mlx）----
  {
    repo: 'aufklarer/HTDemucs-FT-MLX',
    revision: '39820e356306479d81dacb9f1042e5de86d49e29',
    files: [
      { path: 'config.json', size: 33, sha256: '4997035fb7c64d57b368f0f093527fd67bc1dcf24a061706e7a1b18fb6c14581' },
      { path: 'htdemucs_ft.safetensors', size: 336115816, sha256: '22a001e2badf2605e17dd92d9c7f9cbaeaa4030952126bc5f50079473b00d98e' },
      { path: 'htdemucs_ft_config.json', size: 2158, sha256: 'c9a8ae47435ab2f76d6ce0b4dafe8230026c025205955d3b06489225670b5a71' },
    ],
    estimatedBytes: 336118007,
    provenance: SEP_PINNED_LOCAL,
  },
  // ---- 本地文生图（image-bundles.ts）----
  {
    repo: 'mlx-community/Qwen-Image-2.1-MLX-4bit',
    revision: '4db4e8c0c0e7a1debf0320415bec8388e888494c',
    files: [
      { path: 'model_index.json', size: 447, sha256: 'cf1ecd104ea090855d60d8cec0895c1e9d6ee41b2f87e231b678beecd1cf7809' },
      { path: 'processor/added_tokens.json', size: 707, sha256: 'c0284b582e14987fbd3d5a2cb2bd139084371ed9acbae488829a1c900833c680' },
      { path: 'processor/chat_template.jinja', size: 5292, sha256: '3636d0f0bd6bef02654cdffdc447b79cb2cef8ab02cc75267345946291a489e4' },
      { path: 'processor/merges.txt', size: 1671853, sha256: '8831e4f1a044471340f7c0a83d7bd71306a5b867e95fd870f74d0c5308a904d5' },
      { path: 'processor/preprocessor_config.json', size: 782, sha256: '93585062a80db5e8ca038efc7726a3e6411d9db948472d81d63c6303993be8c5' },
      { path: 'processor/special_tokens_map.json', size: 613, sha256: '76862e765266b85aa9459767e33cbaf13970f327a0e88d1c65846c2ddd3a1ecd' },
      { path: 'processor/tokenizer.json', size: 11422654, sha256: 'aeb13307a71acd8fe81861d94ad54ab689df773318809eed3cbe794b4492dae4' },
      { path: 'processor/tokenizer_config.json', size: 5445, sha256: '81ec7bb9530159b326c0bef1d0b6c33d392090524014ea3f0123a3c1eb9c2af5' },
      {
        path: 'processor/video_preprocessor_config.json',
        size: 817,
        sha256: '59c5c9eb52182eb14c06ffb10ca9effd29adce5f238a95de23ca14a38dbd2cb1',
      },
      { path: 'processor/vocab.json', size: 2776833, sha256: 'ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910' },
      { path: 'scheduler/scheduler_config.json', size: 485, sha256: '5895f3a167c14a967fe9ac70c64924ae5acc79799e0679fd12907e594a713cd1' },
      { path: 'text_encoder/config.json', size: 1621, sha256: 'bfde5542ec2bba8fe16c611c273f711831eb35d91df7559984239fab427b523a' },
      {
        path: 'text_encoder/model.safetensors',
        size: 5127776247,
        sha256: 'd3a6131dfba2f78edc8ba84f235b08dcbf59c730b5024940b902b6a5c821b4cf',
      },
      {
        path: 'text_encoder/model.safetensors.index.json',
        size: 115988,
        sha256: 'b96dadd4af6b8f9ed79a13d907aad75171f7a2d56ee9c5248fc30c371562bef4',
      },
      { path: 'transformer/config.json', size: 474, sha256: 'bf9f97db481b7e9545b80923dae79dad5ed3de60988020e252f441b51b32dbc2' },
      {
        path: 'transformer/model.safetensors',
        size: 4002363691,
        sha256: '5b4ba8be14ca1e35cfcde20960ed2e0764ed51c7ddd74018222975c289fcbd5a',
      },
      {
        path: 'transformer/model.safetensors.index.json',
        size: 55344,
        sha256: 'ce26fb02303b39e22770e025dfc6c095c5b68dbad83df8dcd46ebcdbf550bce9',
      },
      { path: 'vae/config.json', size: 2100, sha256: '38c2429ce8251ff92f074d499b774e10779fbd217b22af553db9006069954c5b' },
      { path: 'vae/model.safetensors', size: 1350988930, sha256: '6e082a9cf22e3fb0f3d947328ea2ed67e54b11ea3901a96127389177474c3302' },
      { path: 'vae/model.safetensors.index.json', size: 17786, sha256: '2de8a0f5bd929b8c04ffee563f96649d5960482b6b87ceaae900f4cbc83bd021' },
    ],
    estimatedBytes: 10497208109,
    provenance: IMAGE_PINNED_LOCAL,
  },
  {
    repo: 'ddalcu/Qwen-Image-2.1-Turbo-MLX-Serve-8bit',
    revision: '214ca346520a59597b89bd77408afa49d526bde5',
    files: [
      { path: 'model_index.json', size: 578, sha256: '97e2febeb19d93cb41fa44807cde8bd42757950b5dffeacdb0331fb2d390cf20' },
      { path: 'processor/tokenizer.json', size: 11422650, sha256: 'be75606093db2094d7cd20f3c2f385c212750648bd6ea4fb2bf507a6a4c55506' },
      { path: 'processor/tokenizer_config.json', size: 705, sha256: 'fd42a0b35a8d13cd473e88e310b50cbf1bccaa9eb60ed0fd873af5f8f0c59307' },
      { path: 'scheduler/scheduler_config.json', size: 486, sha256: '16c948c71f9152a34cce6e3a2f309e97ad2dca32beecbe5e2fd3a7925b7eb4bb' },
      { path: 'text_encoder/config.json', size: 1542, sha256: '89050cba6b66c4f68f52305b54fc37efe28d95232246b94aa8dc0cfa36f3b734' },
      {
        path: 'text_encoder/model.safetensors',
        size: 9367829459,
        sha256: '4db3757e59b070b827e1285e506df8874527206bcbc708fdcf02b79bb9a915a2',
      },
      { path: 'transformer/config.json', size: 370, sha256: '2c567038ca190824728844b8d06d94ae02360e668707afd9734e789a7eb58ce3' },
      {
        path: 'transformer/diffusion_pytorch_model-00001-of-00002.safetensors',
        size: 5407063648,
        sha256: 'cff3e7601fa701d189ce6b013a3f7ca7a318ba49c8b4c8b820faf443adeb1ec8',
      },
      {
        path: 'transformer/diffusion_pytorch_model-00002-of-00002.safetensors',
        size: 2280158619,
        sha256: '1a4117365d8e6a13b72d71abd13f2a3c60edcb9128a44c1018d0128182bf3728',
      },
      { path: 'vae/config.json', size: 2172, sha256: '42bfdec412459bbb7bc38a0617ab70edcfc873f84ec47e0c7d01c53ba09885a5' },
      {
        path: 'vae/diffusion_pytorch_model.safetensors',
        size: 662000745,
        sha256: '3ecb67f7df44bef3a74a65fa2a90d477122e45c7214906f04222a59ca4ca8aeb',
      },
    ],
    estimatedBytes: 17728480974,
    provenance: IMAGE_TURBO_HUB,
  },
  // ---- 本地音乐生成（music-bundles.ts）：只下载 Q8 主模型、F16 VAE 与配置文件 ----
  {
    repo: 'audio-cpp/Yue2-3B-GGUF',
    revision: 'cca74d8980c00f30ab8d52248a367c01ad633ec2',
    files: [
      { path: 'yue2-3b-q8_0.gguf', size: 4264195616, sha256: '52be345b5155bf9ef0b2411e7df8d1d2b8e13b6d977a2f70c35612ec69b1f591' },
      { path: 'yue2-vae-f16.gguf', size: 265218656, sha256: 'd4f4a05d8f291ae820cd1e43609da3fa91b56465810091a2b08c3350b751719d' },
      { path: 'sidecars/yue2-generation-config.json', size: 466, sha256: '203830cebde6e3644eb291925362990d198e66c3b6006cd11f1aaa21904bcc61' },
      { path: 'sidecars/yue2-model-config.json', size: 959, sha256: 'ad3477bbef890bf98ae196c1e4b44779494a6231c4ab66f32708eabadf265329' },
      { path: 'sidecars/yue2-qwen.tiktoken', size: 2561218, sha256: 'b2b1b8dfb5cc5f024bafc373121c6aba3f66f9a5a0269e243470a1de16a33186' },
      { path: 'sidecars/yue2-vae-config.json', size: 1378, sha256: 'f0191bb9694009956de44e0c361a6f1334760be4c8f848e599bde242a54a0970' },
    ],
    estimatedBytes: 4531978293,
    provenance: MUSIC_PINNED_HUB,
  },
  // 本机语义检索（EmbeddingGemma 2，`embedding-bundles.ts`）：只下载 `.litertlm` 单文件。
  {
    repo: 'litert-community/embeddinggemma-2-text-270m-litert-lm',
    revision: '9be6e8b90982095dc05c2bd162e4b954ee4dbac7',
    files: [{ path: 'embeddinggemma-2-text-270m.litertlm', size: 164626432, sha256: '2d079ee2f6f066b1f368e8d7c819f55214eaef1d0513b312321901f30ab286fb' }],
    estimatedBytes: 164626432,
    provenance: EMBEDDING_HUB,
  },
  {
    repo: 'litert-community/embeddinggemma-2-740m-litert-lm',
    revision: '24d962e906c7d332c6428e71c9676855024569e2',
    files: [{ path: 'embeddinggemma-2-740m.litertlm', size: 484622336, sha256: 'e7a8a2204b91e0f96e92960e84a09a89212e1633dcb7575a9bf3378b4df77f4c' }],
    estimatedBytes: 484622336,
    provenance: EMBEDDING_HUB,
  },
];

/** 一个仓库版本的内置清单；没有登记时 null。 */
export function repoManifestFor(
  repo: string,
  revision: string,
  manifests: readonly RepoManifestSpec[] = REPO_MANIFESTS,
): RepoManifestSpec | null {
  return manifests.find((m) => m.repo === repo && m.revision === revision) ?? null;
}

/**
 * 一组组件（仓库与版本）的权重总字节数：按内置清单的文件大小加起来，大小未知的仓库用 `estimatedBytes`。有组件没有登记清单时
 * null（不知道多大）。用来估计 Model Worker 加载它们要多少内存，也是下载前显示的大小。来自发布页的组件（`release`，audio.cpp 引擎）
 * 按 `platformKey` 这个平台的压缩包大小算，这个平台没有压缩包时 null。
 */
export function weightBytes(
  sources: ReadonlyArray<{ repo: string; revision: string; release?: ComponentRelease; local?: { size: number } }>,
  manifests: readonly RepoManifestSpec[] = REPO_MANIFESTS,
  platformKey: string = hostPlatformKey(),
): number | null {
  let total = 0;
  for (const source of sources) {
    // 原地引用的本机文件：添加时记下的大小。
    if (source.local) {
      total += source.local.size;
      continue;
    }
    if (source.release) {
      const asset = releaseAsset(source.release, platformKey);
      if (!asset) return null;
      total += asset.size;
      continue;
    }
    const spec = repoManifestFor(source.repo, source.revision, manifests);
    if (!spec) return null;
    total += spec.files.every((f) => f.size !== null) ? spec.files.reduce((sum, f) => sum + (f.size ?? 0), 0) : spec.estimatedBytes;
  }
  return total;
}
