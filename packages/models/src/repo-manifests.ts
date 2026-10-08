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

const LEGACY_PINNED = 'sha256 pinned for the same revision by legacy BaoCut (baocut-app, catalog.rs in bcut-models); not re-verified offline in this repo; sizes unknown';
/** 本地语音合成：sha256 取自旧版的固定清单，大小与 sha256 和本机已装好的同一版本逐个比对一致。 */
const TTS_PINNED_LOCAL =
  'sha256 pinned for the same revision by legacy BaoCut (baocut-app, catalog.rs in bcut-models); sizes and hashes checked one by one against a local install of the same revision';
/** 本地语音合成：sha256 取自旧版的固定清单；大小与哈希（LFS 文件的 oid、其余文件按版本下载后计算）已向下载来源逐个核对。 */
const TTS_PINNED_HUB =
  'sha256 pinned for the same revision by legacy BaoCut (baocut-app, catalog.rs in bcut-models); sizes and hashes checked one by one against the download source at this revision';
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
  // ---- 本地语音合成（speech-bundles.ts）----
  {
    repo: 'Qwen/Qwen3-TTS-Tokenizer-12Hz',
    revision: '7dd38ad4e9bad454aae9cd937d0cd577604fe229',
    files: [
      { path: 'config.json', size: 2336, sha256: 'ee65bb901c876664ab8707c487157aa1a6ee57c65969b28fb5ec9dc211e68167' },
      { path: 'model.safetensors', size: 682293092, sha256: '836b7b357f5ea43e889936a3709af68dfe3751881acefe4ecf0dbd30ba571258' },
    ],
    estimatedBytes: 682295428,
    provenance: TTS_PINNED_LOCAL,
  },
  {
    repo: 'aufklarer/Qwen3-TTS-12Hz-0.6B-Base-MLX-8bit',
    revision: '2a20f4adf0436810367cea5a51aa7eb1bc50b6d8',
    files: [
      { path: 'config.json', size: 431, sha256: 'cf55a8f542f56123b253833c77cde387c8953a1b9454c11c735880edeb835e39' },
      { path: 'merges.txt', size: 1671839, sha256: '599bab54075088774b1733fde865d5bd747cbcc7a547c5bc12610e874e26f5e3' },
      { path: 'model.safetensors', size: 1304461214, sha256: '9488e7005cc0cf44f8804eb543668d0763bb1c649ce6f1eddc663519524b3182' },
      { path: 'model.safetensors.index.json', size: 77731, sha256: '7829f1cc24f5cbd7d7a3ba888bb08c7cf52d82ba79a4f0f3756d41f8bf5e52b4' },
      { path: 'tokenizer_config.json', size: 7344, sha256: 'dc3c31c3bdaedd5016382bb3cbe07323026775ad51f5a4fb564505992ae4a670' },
      { path: 'vocab.json', size: 2776833, sha256: 'ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910' },
    ],
    estimatedBytes: 1308995392,
    provenance: TTS_PINNED_LOCAL,
  },
  {
    repo: 'aufklarer/Qwen3-TTS-12Hz-0.6B-CustomVoice-MLX-bf16',
    revision: '3affbf656d9d6aa9255ec0b31cc90055605170bc',
    files: [
      { path: 'config.json', size: 4908, sha256: '81aca2b6fac304944d8acf345272d8a9a727d5fc2e2e66b222ab4729340c7455' },
      { path: 'merges.txt', size: 1671839, sha256: '599bab54075088774b1733fde865d5bd747cbcc7a547c5bc12610e874e26f5e3' },
      { path: 'model.safetensors', size: 1811626144, sha256: '465675a36380251e143cfbca8d693f375c47ba6bf0ae334966cb529ef1be34d9' },
      { path: 'model.safetensors.index.json', size: 30630, sha256: '463127e455292c8f002a9bfe67ec165235ecc107017228e3fb64e28fdb145f6f' },
      { path: 'tokenizer_config.json', size: 7344, sha256: 'dc3c31c3bdaedd5016382bb3cbe07323026775ad51f5a4fb564505992ae4a670' },
      { path: 'vocab.json', size: 2776833, sha256: 'ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910' },
    ],
    estimatedBytes: 1816117698,
    provenance: TTS_PINNED_LOCAL,
  },
  {
    repo: 'aufklarer/Qwen3-TTS-12Hz-1.7B-Base-MLX-8bit',
    revision: '87d008f1e1a20d265bee01c7ccb0a78f5b8d1132',
    files: [
      { path: 'config.json', size: 431, sha256: 'ef68522ec21a47336a565d5d2e9180b48b9e307e7eaeae5d33cb87a91c7a5ef0' },
      { path: 'merges.txt', size: 1671839, sha256: '599bab54075088774b1733fde865d5bd747cbcc7a547c5bc12610e874e26f5e3' },
      { path: 'model.safetensors', size: 2417320525, sha256: 'b965c581ccf6aa852a4124feeb7a8a111542ee7b213139368b4cc7ba7fd4728b' },
      { path: 'model.safetensors.index.json', size: 78070, sha256: '9592a7c0ac3261a6211978416ef1796d3841225ac0ff0f9d6bfb5d1a6b49e5e9' },
      { path: 'tokenizer_config.json', size: 7344, sha256: 'dc3c31c3bdaedd5016382bb3cbe07323026775ad51f5a4fb564505992ae4a670' },
      { path: 'vocab.json', size: 2776833, sha256: 'ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910' },
    ],
    estimatedBytes: 2421855042,
    provenance: TTS_PINNED_LOCAL,
  },
  {
    repo: 'mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit',
    revision: '41d3337e8b7f2843a75841595fc14e4b9a7a4b96',
    files: [
      { path: 'config.json', size: 6058, sha256: '43f29f9ab55cf387bd2ce1d07e9d95a5ca8974fa2fda4e2b45c13ae64aad3bfa' },
      { path: 'merges.txt', size: 1671839, sha256: '599bab54075088774b1733fde865d5bd747cbcc7a547c5bc12610e874e26f5e3' },
      { path: 'model.safetensors', size: 2393308931, sha256: 'b696f4bf45f54497b6de758981e76f1410bd68af05a657477dee466b0202df1a' },
      { path: 'model.safetensors.index.json', size: 71786, sha256: '2551ed02dc288b90cd6b7ec98652433f08ef2ae98fb3eda5248a4b9e5b47d08b' },
      { path: 'tokenizer_config.json', size: 7344, sha256: 'dc3c31c3bdaedd5016382bb3cbe07323026775ad51f5a4fb564505992ae4a670' },
      { path: 'vocab.json', size: 2776833, sha256: 'ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910' },
    ],
    estimatedBytes: 2397842791,
    provenance: TTS_PINNED_LOCAL,
  },
  {
    repo: 'mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit',
    revision: 'f90d617701d9f7f4ca499291e0b57f2b3c2fd2ee',
    files: [
      { path: 'config.json', size: 5437, sha256: 'b91c47798e77e259e6b86987e48d7a5eca8e703205e00afb63fe08ec5251f983' },
      { path: 'merges.txt', size: 1671839, sha256: '599bab54075088774b1733fde865d5bd747cbcc7a547c5bc12610e874e26f5e3' },
      { path: 'model.safetensors', size: 2393308931, sha256: '1a84179d87c972353ccdd9b48f3c4422509b3d1b11030d32358312fb0f3800d7' },
      { path: 'model.safetensors.index.json', size: 71786, sha256: '2551ed02dc288b90cd6b7ec98652433f08ef2ae98fb3eda5248a4b9e5b47d08b' },
      { path: 'tokenizer_config.json', size: 7344, sha256: 'dc3c31c3bdaedd5016382bb3cbe07323026775ad51f5a4fb564505992ae4a670' },
      { path: 'vocab.json', size: 2776833, sha256: 'ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910' },
    ],
    estimatedBytes: 2397842170,
    provenance: TTS_PINNED_HUB,
  },
  {
    repo: 'aufklarer/IndexTTS2-MLX-fp16',
    revision: '208b3d6ea53a119f3501b3bfd8e666b9b5e8c705',
    files: [
      {
        path: 'aux/bigvgan/bigvgan_generator.safetensors',
        size: 224558010,
        sha256: '62d63d69265fa38d2feabc35df54bfe75a5ac3257591e17abebf792911498569',
      },
      { path: 'aux/bigvgan/config.json', size: 1405, sha256: '88a1f47acf747db0b21e97a389d838566147f7a5464583ff5c8d819d870f03ee' },
      {
        path: 'aux/campplus/campplus_cn_common.safetensors',
        size: 13969120,
        sha256: 'eb29858cf9ebd1b186b33ea477629e48a0f033f243cd52844ef9c5e727e7adc4',
      },
      { path: 'aux/campplus/configuration.json', size: 581, sha256: '6f7acaf1e81ca121f4a3c71b6ddb66beec24350a3ef330e2c846f17829176a8f' },
      { path: 'aux/maskgct/config.json', size: 92, sha256: '00815c46d15b45071437665a85144aa4c3c6fb434080147e318612dd26617047' },
      {
        path: 'aux/maskgct/semantic_codec/model.safetensors',
        size: 88603840,
        sha256: 'a665396a04dead2e9c8f0994039e280b9ad5b1eec623bb9bd9f041b6a284eaaa',
      },
      { path: 'aux/w2v-bert-2.0/config.json', size: 1874, sha256: 'f5572bd5998b68182e9c328a43127ed21fed687f6910497136b91a4e3b0e3675' },
      {
        path: 'aux/w2v-bert-2.0/model.safetensors',
        size: 1161076768,
        sha256: 'e56eab7a7c9cec9e4e908bca3ec5c4b3f27a0521a7807a100e50792a2a5bb6eb',
      },
      {
        path: 'aux/w2v-bert-2.0/preprocessor_config.json',
        size: 275,
        sha256: '8e6281aad64f97e40534135a59dcc5d33571efae376f2a25adf5551951897ab4',
      },
      { path: 'bpe.model', size: 475997, sha256: 'b2a5ce8090d32da3642cc4f81fdc996376bc6dd3f4cd5e3d165f71120d9f2bc8' },
      { path: 'config.json', size: 179, sha256: 'd25c591aadbda8bf2346085f6f8f9a7c0fd68efadada4c6f05a13f122dd6b7ff' },
      { path: 'config.yaml', size: 2882, sha256: 'ea9c2815ecc3874577c7ac158b97248c027250e5b05972fbbb1216b6d6539081' },
      { path: 'feat1.safetensors', size: 28144, sha256: '8e61ced8f17b1997bfcf91b8fd916e6affeff5cf2448e4068fe6e3deba0b57f7' },
      { path: 'feat2.safetensors', size: 186992, sha256: '9f5f878b4b3f85eb24813dbf3280536efb1a34b43cc1df48c1fa63c271d8c80b' },
      { path: 'gpt.safetensors', size: 1742276006, sha256: 'a5b448aae319715abe4eb1043469ebc127dcdb1c1639620afd382f961d1c2195' },
      { path: 's2mel.safetensors', size: 601137480, sha256: '3147c9be4811e760971715055c7e96edebdd0aaf07a9d464011bc25e897ad6c1' },
      { path: 'soniqo_manifest.json', size: 7536, sha256: 'b86565f9a509487ca6c4977f1f06c51a50e56ebc15cf772008bdd68ae430e00f' },
      { path: 'wav2vec2bert_stats.safetensors', size: 4264, sha256: '2ec34a778c9df8a6c5b56eeb239e6272e277936f3c41073f26ab8cdbe3355903' },
    ],
    estimatedBytes: 3832331445,
    provenance: TTS_PINNED_LOCAL,
  },
  {
    repo: 'mlx-community/IndexTTS-2.5-fp16',
    revision: '65644cd70da15309ffeb74aa03f3686bb04e3eb1',
    files: [
      { path: 'codec.safetensors', size: 101188975, sha256: '7ba36ba12dbc6f19adaf50bb4aebee2c4092526c7f4a56479ed1e72e2562009e' },
      { path: 'config.json', size: 3464, sha256: '438e3e76610ddcc85f764cf0a06cde43df3937ac966dc2c199a52b5f9a7eee57' },
      { path: 'config.yaml', size: 2663, sha256: '65d07de92a2c26843c14c797951613ef939593ae1e842f31ad7d9f2d04b6eb52' },
      { path: 'gpt.safetensors', size: 1624627631, sha256: '9603e2d7e36751133bf96a57c91c403ba40e419b646487aa93774aed25d8c757' },
      { path: 'model_manifest.json', size: 15327, sha256: '8129939e45f444c45a00147064359b02b591b4d6f77e6ac3ef09be6091e4eba6' },
      {
        path: 'multilingual_zh_ja_yue_char_del.tiktoken',
        size: 907395,
        sha256: '747979631e813193436aabcff7c1c235d37de8097b71c563ec8b63b7a515c718',
      },
      { path: 's2mel.safetensors', size: 207320482, sha256: '26f8c0d388716f1adfa29919d4b924683329cda470464786759e2461ffd5233f' },
    ],
    estimatedBytes: 1934065937,
    provenance: TTS_PINNED_LOCAL,
  },
  {
    repo: 'PJMixers-Dev/lj1995_GPT-SoVITS-safetensors',
    revision: 'cea8b8279588e63c2fdc10e02610c11f02af5450',
    files: [
      { path: 'chinese-hubert-base/config.json', size: 1449, sha256: 'c3e5060a1277e0f078cc6be9da4528a605dba6ece93018981fe2c820e5c7b103' },
      {
        path: 'chinese-hubert-base/model.safetensors',
        size: 188767040,
        sha256: '25adc31d1889ff5d3da262189433bdc755f0ddb9f194342583dbd17e447daefe',
      },
      {
        path: 'chinese-hubert-base/preprocessor_config.json',
        size: 212,
        sha256: 'dcd684124d06722947939d41ea6ae58dbf10968c60a11a29f23ddc602c64a29b',
      },
      {
        path: 'chinese-roberta-wwm-ext-large/config.json',
        size: 963,
        sha256: '3d57de2fd7e80d0e5c8ff194f0bbb6baa10df7e43fc262a0cc71298a78b0a3e5',
      },
      {
        path: 'chinese-roberta-wwm-ext-large/model.safetensors',
        size: 651142416,
        sha256: '7eb43497cb8554f77b4fffb65932ea092e5b0e2c9e12f65bc3e1f14ced336611',
      },
      {
        path: 'chinese-roberta-wwm-ext-large/tokenizer.json',
        size: 268962,
        sha256: '173796956820ea27bd14f76bf28162607ff4254807e2948253eb5b46f5bb643b',
      },
      {
        path: 'gsv-v2final-pretrained/s1bert25hz-5kh-longer-epoch=12-step=369668.json',
        size: 674,
        sha256: '0e267ac45532fb71968559c1e66b9869c4d1a1105b04ff1170d82d41b8aa0794',
      },
      {
        path: 'gsv-v2final-pretrained/s1bert25hz-5kh-longer-epoch=12-step=369668.safetensors',
        size: 155243444,
        sha256: 'c3dc2caba3add5f7ccbd2629877ab617d1f0ffa33bb0f4cf053dc934999709c9',
      },
      {
        path: 'gsv-v2final-pretrained/s2G2333k.json',
        size: 1540,
        sha256: '714a6cc1dea4087dc6e9b529ae7a53ad3f1644415b21d04cbf8ddbd78f78e0e5',
      },
      {
        path: 'gsv-v2final-pretrained/s2G2333k.safetensors',
        size: 105849754,
        sha256: '1a8d923040aa87ac1611c9c5f2a0a52cfb7cd625baff7c5f842a89a5764034f4',
      },
    ],
    estimatedBytes: 1101276454,
    provenance: TTS_PINNED_LOCAL,
  },
  {
    repo: 'aufklarer/VoxCPM2-MLX-int8',
    revision: '471a37b830ccf5e23fdb4c822649ec7c3b7320b4',
    files: [
      { path: 'config.json', size: 6230, sha256: 'c62e64da1a0e1ac470f962bbcacac2a0297807090d28f452660b1125daa76258' },
      { path: 'model.safetensors', size: 2949710312, sha256: '0b3d82c78fda5874333f3a6ae8c9b1dc9802d44932d2f822dd8accd490e33ed3' },
      { path: 'special_tokens_map.json', size: 1632, sha256: '068594063e37662c02b21acf42ebb334ef6a74fb810e68a2368f88f08351de76' },
      { path: 'tokenizer.json', size: 3676772, sha256: 'f8984687e4a92a3503d521396d454b7d68e9fdaab2a0288eb3536c7c1aa4bc20' },
      { path: 'tokenizer_config.json', size: 5059, sha256: 'e78a3ebb48a0b9437efd1823b6b726c823da89e49dd8bcc90c02419d9baa772b' },
    ],
    estimatedBytes: 2953400005,
    provenance: TTS_PINNED_HUB,
  },
  {
    repo: 'aufklarer/OmniVoice-MLX-int8',
    revision: 'e815dfafaf9c90f995ddc9fcfe52fd0d80babe4e',
    files: [
      { path: 'audio_tokenizer/config.json', size: 2531, sha256: 'eefb20806f7104e77c9a5277c9df0f9bb8826b08eb1d4e8ab2b9829b6ef9fac1' },
      {
        path: 'audio_tokenizer/model.safetensors',
        size: 402864450,
        sha256: '2ccdf29d0f01b504075fc188705458ffa4d1502a196839492bb59a941c1e70d0',
      },
      {
        path: 'audio_tokenizer/preprocessor_config.json',
        size: 206,
        sha256: 'ae61eea88558608ee2fa86d2aec9fce8d99a5ff75d09cb7651ccce21ae1d9084',
      },
      { path: 'chat_template.jinja', size: 4168, sha256: 'a55ee1b1660128b7098723e0abcd92caa0788061051c62d51cbe87d9cf1974d8' },
      { path: 'config.json', size: 2298, sha256: '7b3f850df9e7e9c6f4019a567747f8d7c90261f3d8bd66a35b46cf7da2f61638' },
      { path: 'model.safetensors', size: 689415208, sha256: '0d701a35df4ad7ed9af47a2c7a17b50d2de7feff6b4ffc9500d5f8587c473ac7' },
      { path: 'tokenizer.json', size: 11423986, sha256: '408f669b7e2b045fdf54201d815bd364e6667dbd845115da81239c40bc6dcfd1' },
      { path: 'tokenizer_config.json', size: 533, sha256: '49f78845596a82bf15c83673794bdf9f76f812b11f60ab6a2239d9be65b00676' },
    ],
    estimatedBytes: 1103713380,
    provenance: TTS_PINNED_HUB,
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
 * null（不知道多大）。用来估计 Model Worker 加载它们要多少内存。
 */
export function weightBytes(
  sources: ReadonlyArray<{ repo: string; revision: string }>,
  manifests: readonly RepoManifestSpec[] = REPO_MANIFESTS,
): number | null {
  let total = 0;
  for (const source of sources) {
    const spec = repoManifestFor(source.repo, source.revision, manifests);
    if (!spec) return null;
    total += spec.files.every((f) => f.size !== null) ? spec.files.reduce((sum, f) => sum + (f.size ?? 0), 0) : spec.estimatedBytes;
  }
  return total;
}
