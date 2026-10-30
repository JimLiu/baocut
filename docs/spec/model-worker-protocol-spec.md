# BaoCut Model Worker 协议规范

> Runtime 与本地推理进程（Model Worker）之间的 stdio 协议，语音识别的输出合同 `baocut.asr-result/v1` 与人声分离的输出合同 `baocut.stems-wav/v1`，以及不经 Worker、由随应用内置的 audio.cpp 引擎执行的本地音乐生成与语音合成（§4.4）。本规范定义消息的形状与语义；进程的粒度、启动、恢复与清理规则见[系统架构设计](../architecture/architecture-design.md) §6.5–§6.6。

合同版本：`workerContractVersion: 2`（版本 2 去掉了 `synthesize`：本地语音合成改由内置的 audio.cpp 引擎执行，§4.4）。

用语见[文档约定](../README.md#文档约定)，术语见[术语表](../glossary.md)。

## 目录

- [1. 传输与信封](#1-传输与信封)
- [2. 方法](#2-方法)
- [3. 事件](#3-事件)
- [4. 模型包描述](#4-模型包描述)
- [5. 任务与 staging 目录](#5-任务与-staging-目录)
- [6. 输出合同 baocut.asr-result/v1](#6-输出合同-baocutasr-resultv1)
- [7. 错误](#7-错误)
- [8. 待评审事项](#8-待评审事项)

---

## 1. 传输与信封

Worker 是 Runtime 启动的子进程。stdin 与 stdout 各是一个 UTF-8 的 JSON 行流，一行一条消息，不得含未转义的换行；stderr 只用于日志。与 Engine Host 一致：

| 方向 | 形状 |
| --- | --- |
| Runtime → Worker 请求 | `{ "id": number, "method": string, "params": object }` |
| Worker → Runtime 响应 | `{ "id": number, "result": object }` 或 `{ "id": number, "error": ErrorBody }` |
| Worker → Runtime 事件 | `{ "event": string, "params": object }` |

- `id` 由 Runtime 递增分配；每个请求恰有一个响应。
- 事件可以在任何时候出现，总是在它所属的 `job.run` 响应之前。
- Worker 在 stdin 关闭（EOF）或 stdout 写入失败时退出；另外每 2 秒检查父进程 PID 仍然存在且等于启动时传入的 `--parent-pid`，否则退出。Worker 不处理 PID 复用之外的任何「认领」。
- 一行超过 16 MiB 视为协议错误，Worker 退出。
- 未知方法返回 `UNKNOWN_METHOD`；参数不合形状返回 `INVALID_PARAMS`；Worker 内部 panic 变为该请求的 `WORKER_PANIC` 响应，Worker 之后退出。

命令行：`model-worker --parent-pid <pid>`。业务参数全部经 stdin 传入，不走环境变量。Worker 需要的外部工具（ffmpeg）从 Runtime 传入的 `PATH` 查找，`BAOCUT_FFMPEG` 可指定可执行文件；`BAOCUT_GPU` 是关掉 GPU 的运维开关（§2.1），不是业务参数。Runtime 用启动 Engine Host 的同一套环境启动 Worker。

## 2. 方法

### 2.1 `worker.hello`

Runtime 启动 Worker 后发出的第一个请求。

```ts
params: { contractVersion: 2 }
result: {
  workerVersion: string;            // crate 版本
  contractVersion: 2;
  pid: number;
  backends: Array<{ id: 'mlx' | 'coreml' | 'candle' | 'ggml' | 'litert-lm'; available: boolean; reason?: string; devices: string[] }>;
  capabilities: Array<'transcribe' | 'align' | 'separate' | 'image' | 'diarize' | 'embed'>;
  transcribeFamilies: string[];     // 能加载的识别模型 family（§4.1 `asr` 组件的 family）；没有时为 []
  separateFamilies: string[];       // 能加载的分离模型 family（§4.1 `separator` 组件的 family）；没有时为 []
  imageFamilies: string[];          // 能加载的文生图模型 family（§4.1 `image` 组件的 family）；没有时为 []
  checkpoints: Array<'transcribe'>; // 带上 `job.run` 的 `checkpoint` 时读写检查点的能力（§2.5.1、§5）；旧的 Worker 没有这个字段
  embeddingCapabilities?: {         // 只在 `capabilities` 含 `embed` 时出现（§2.5.6）
    families: string[];             // 能加载的 `embedding` family（§4.5）
    outputSizes: number[];          // `embed.run` 接受的 `outputSize`：[128, 256, 512, 768]
    maxBatch: number;               // 一次 `embed.run` 至多几条：16
    maxInputTokens: number;         // 单条文本的 token 上限：2048
    inputs: ('text' | 'image')[];   // `embed.run` 接受的输入：['text', 'image']（图像要求加载时打开图像编码器，§4.5）
    maxImageBatch: number;          // 一次 `embed.run` 至多几张图：4
  };
}
```

`contractVersion` 不匹配时 Worker 返回 `CONTRACT_MISMATCH`，Runtime 关闭它。`available: false` 的后端带 `reason`（如 `no-metal-device`、`not-compiled`）。

`devices` 是这个后端此刻能用的设备，首选的在前：`mlx` 为 `['metal']`，`coreml` 为 `['ane']`，`litert-lm` 在 macOS 上为 `['metal', 'cpu']`、别的平台为 `['cpu']`（编进了 `backend-litert` 时可用；C 库加载模型包时才打开，GPU 能不能用到加载时才知道，起不来就在加载里退回 CPU，§4.5），`candle` 为 `['cuda', 'cpu']`（编进了 `cuda` 且 CUDA 初始化成功）或 `['cpu']`，`ggml`（whisper.cpp）为 `[<GPU>, 'cpu']` 或 `['cpu']`：`<GPU>` 是 ggml 枚举到的第一个 GPU 设备所属后端，CUDA 为 `'cuda'`（编进了 `whisper-ggml-cuda` 且找到了 NVIDIA GPU）、Vulkan 为 `'vulkan'`（编进了 `whisper-ggml-vulkan` 且找到了 Vulkan GPU），Metal 为 `'metal'`（macOS 编进了 `whisper-ggml-metal` 且找到了 Metal GPU），两个 CUDA / Vulkan 后端都编进来时 CUDA 先于 Vulkan（ggml 的登记顺序），所以至多一个 GPU。这个 GPU 还必须能在 ggml 里自己算 Whisper 的核心算子：ggml 的 `supports_op` 对编码器形状的矩阵乘（Q8_0、Q5_0 与 F16 权重）、层归一化与 softmax 都回答支持。Metal 与 CUDA 上核对；Vulkan 的 `supports_op` 第一次调用就初始化逻辑设备，会把这笔开销挪进握手，不核对。算不了的 GPU 当作没有，`ggml` 只报 `['cpu']`，并在 stderr 点名那台 GPU 说明一次，也不另挑后面的 GPU；否则 whisper.cpp 仍把权重放进显存、每次计算再拷回 CPU 去算，比只用 CPU 还慢。Metal 上这些算子要 Metal 3 家族的显卡，只支持到 Metal 2 的显卡（如 Polaris 一代的 Radeon Pro 560X）不满足。设备名只取 `metal`、`ane`、`cuda`、`vulkan` 与 `cpu`（BaoCut 的构建编 ggml 的 CUDA、Vulkan 或 Metal GPU 后端；别的 ggml GPU 后端会报它小写的注册名，不在本合同内）。环境变量 `BAOCUT_GPU` 设为 `off`、`0`、`false`、`cpu` 或 `no`（不分大小写）时 Worker 不初始化 GPU，`candle`、`ggml` 与 `litert-lm` 只报 `cpu`；CUDA 或 Vulkan 初始化失败时同样只报 `cpu`，并在 stderr 说明一次。没编进的后端（例如没开 `whisper-ggml` 的构建里的 `ggml`）报 `available: false`、`reason: 'not-compiled'`。Runtime 交给 `model.load` 的 `candle`、`ggml` 与 `litert-lm` 模型包用这里的首选设备；candle 模型包的 `device` 是 `cuda` 而进程没有拿到 CUDA 设备，或不是 `cpu` / `cuda` 时，`model.load` 返回 `MODEL_UNSUPPORTED`（`details: { backend: 'candle', device, reason: 'unsupported-device' }`）；后端 `available: false` 时不发 `model.load`，任务以 `MODEL_LOAD_FAILED`（`details.reason: 'unsupported'`、`detail: 'backend-unavailable'`）失败，模型包不停用。

`capabilities` 只列出这个 Worker 真正能执行的能力。识别同样按模型族声明：`transcribeFamilies` 列出这个构建能加载的 `asr` family（带 MLX 或 candle 的构建是 `qwen3-asr` 与 `moss-transcribe-diarize`，带 MLX 的 Apple Silicon 构建加上 `whisper-mlx`，带 Core ML 的构建加上 `whisper-coreml`，带 `whisper-ggml` 的构建加上 `whisper-ggml`），至少有一个时 `capabilities` 才含 `transcribe`。构建能加载强制对齐器（`qwen3-forced-aligner`，带 MLX 或 candle 的构建）时 `capabilities` 含 `align`；真正执行还要求加载的模型包带了 `aligner` 组件（§2.5.1）。构建接上了说话人区分（Pyannote 分段 + WeSpeaker 声纹，带 MLX 或 candle 的构建；MLX 与 Core ML 的 Whisper 用 MLX 的，GGML 的 Whisper 借 candle 的）时 `capabilities` 含 `diarize`：识别时要说话人还要求识别的模型包带了 `segmentation` 组件（§2.5.1）；单独加载「说话人区分」模型包时它也是一个 `job.run` 能力，给已有转写的词区分说话人（§2.5.5）。识别模型包要求 `transcribe`，且它的 `asr` family 在 `transcribeFamilies` 里：不满足时 Runtime 不发 `model.load`，任务以 `MODEL_LOAD_FAILED`（`details.reason: 'unsupported'`、`detail: 'capability-missing'`，带 `family`、`capabilities` 与 `transcribeFamilies`）失败，模型包不停用。文生图同理：`imageFamilies` 列出这个构建能加载的 `image` family（带 MLX 或 candle 的构建是 `qwen-image`），至少有一个时 `capabilities` 才含 `image`；带 `image` 组件的模型包要求 `image`，且它的 family 在 `imageFamilies` 里，不满足时同样以 `capability-missing`（带 `family` 与 `imageFamilies`）失败，模型包不停用。分离也一样：`separateFamilies` 列出这个构建能加载的 `separator` family（带 MLX 或 candle 的构建是 `htdemucs-ft`），至少有一个时 `capabilities` 才含 `separate`；带 `separator` 组件的模型包要求两者都满足，否则同样以 `MODEL_LOAD_FAILED`（`detail: 'capability-missing'`，带 `family`、`capabilities` 与 `separateFamilies`）失败，模型包不停用。文本嵌入：编进了 LiteRT-LM 后端（`backend-litert` feature，C 库不在构建时链接；Cargo 默认开启，打包时只有 Apple Silicon 的 Mac 包用默认 feature，Windows 与 Intel Mac 包按各自的 feature 列表构建、目前不含它）时 `capabilities` 含 `embed` 并带 `embeddingCapabilities`（`families` 是 `embeddinggemma2-litert`），否则两者都没有；带 `embedding` 组件的模型包要求 `embed`，且它的 family 在 `embeddingCapabilities.families` 里，不满足时同样以 `capability-missing`（带 `family` 与 `capabilities`）失败，模型包不停用。声明了 `embed` 不代表这个平台有 C 库：C 库是模型包的组件，Runtime 在没有库包的平台上不会把模型包报成装好（§4.5）。

### 2.2 `model.load`

一个 Worker 进程只加载一个模型包（§4）。重复调用返回 `ALREADY_LOADED`。

```ts
params: { bundle: ModelBundle }
result: { loaded: true; residentBytes: number | null; warmupMs: number }
```

加载期间 Worker 推送 `model.phase` 事件。失败时的 `ErrorBody.code` 只取 `MODEL_NOT_INSTALLED`（文件缺失或 hash 不符）、`MODEL_UNSUPPORTED`（后端、设备或模型族不支持）、`MODEL_RESOURCE`（内存不足）三者之一，`details` 给出具体文件或资源。组件的组合不成立时（例如说话人区分模型包有 `segmentation` 却没有 `speaker`）是 `MODEL_UNSUPPORTED`，`details: { component, reason: 'missing-component' }`。不在 `transcribeFamilies` 里的 `asr` family 在组件检查之后返回 `MODEL_UNSUPPORTED`，`details: { capability: 'transcribe', reason: 'not-wired', family }`，不留加载状态；不在 `imageFamilies` 里的 `image` family 同样返回 `details: { capability: 'image', reason: 'not-wired', family }`；分离是 `details: { capability: 'separate', reason: 'not-wired', family }`；Runtime 按 §2.1 不会发出这样的请求，这只是兜底。分离与文生图的模型包加载后常驻在推理线程上，与识别相同。

### 2.3 `model.unload`

```ts
params: {}
result: { unloaded: true }
```

卸载后 Worker 仍然活着，等待 Runtime 关闭 stdin。

### 2.4 `worker.status`

```ts
params: {}
result: {
  state: 'empty' | 'loading' | 'ready' | 'busy' | 'unloading';
  bundleId: string | null;
  job: { jobId: string; phase: string; startedAt: string } | null;
  memory: { active: number; cache: number; peak: number } | null;   // 后端能报告时
}
```

### 2.5 `job.run`

Worker 一次只执行一个任务；`state !== 'ready'`（包括还没有加载模型包）时返回 `WORKER_BUSY`，`details.state` 给出当前状态。响应在任务终止时才返回。`params.capability` 决定参数与结果的形状：`transcribe` 与 `align` 见 §2.5.1，`image` 见 §2.5.3，`separate` 见 §2.5.4，`diarize` 见 §2.5.5。参数先按形状检查（`INVALID_PARAMS`），再检查状态。

#### 2.5.1 识别与对齐

```ts
params: {
  jobId: string;
  runGeneration: number;
  capability: 'transcribe' | 'align';
  input: {
    file: string;                     // 绝对路径；Runtime 已校验在允许的根目录内
    contentHash: string;              // 'sha256:<hex>'，Worker 不复核
    track: number;                    // 音轨序号，默认 0
    range?: { start: number; end: number; timescale: number }; // 只处理这一段
  };
  options: TranscribeOptions | AlignOptions;
  staging: string;                    // 绝对路径；Worker 只能写这个目录
  outputContract: 'baocut.asr-result/v1';
  checkpoint?: string;                // 转写检查点文件的绝对路径（§5）；只发给 `checkpoints` 含 `transcribe` 的 Worker
}

interface TranscribeOptions {
  language: { mode: 'assert'; tag: string } | { mode: 'prefer'; tag: string | null };  // BCP 47
  diarize: boolean;                   // 要说话人（§2.5.1）；做不到时照常转写并报 warning 'diarization-unavailable'
  hint?: string;                      // 术语与上下文，≤ 1200 字符
  timescale: number;                  // 输出的 tick 单位，默认 1_000_000
}

interface AlignOptions {
  language: { mode: 'assert'; tag: string };
  text: string;
  timescale: number;
}

result: {
  outcome: 'completed' | 'cancelled';
  output: { path: string; sha256: string; byteLength: number } | null;   // sha256 是小写十六进制，不带前缀；cancelled 时为 null
  segmentsFile: string | null;        // 分段结果 JSONL 的路径；任务被取消时仍然给出
  stats: { decodeMs: number; vadMs: number; asrMs: number; diarizeMs: number; alignMs: number; speechSeconds: number };
}
```

`stats` 是各阶段的耗时（毫秒）与识别出的语音总时长（秒），Runtime 记进任务记录的 `timing`（架构设计 §7.2）：`diarizeMs` 是说话人区分，含按需加载说话人模型的时间，不计入 `asrMs`；`alignMs` 含按需加载对齐器的时间。`diarizeMs` 是后来加的：更早的 Worker 没有这一项，说话人区分算在 `asrMs` 里，Runtime 不要求它。

`runGeneration` 原样回填到结果的 `provenance.runGeneration`，Worker 不做别的解释。`capability: 'align'` 在没有加载对齐器的模型包上返回 `MODEL_UNSUPPORTED`（`details.reason: 'aligner-not-loaded'`），语言不是断言或 `text` 为空是 `INVALID_PARAMS`；断言的语言不被模型支持时同样返回 `MODEL_UNSUPPORTED`（`details.reason: 'unsupported-language'`）。支持哪些语言按 `asr` 的 family 查各自的表（`qwen3-asr` 30 种、`whisper-mlx` 与 `whisper-coreml` 100 种、`moss-transcribe-diarize` 101 种），Runtime 的 `local` Provider 报告同一张表。

`hint` 超过 1200 字符是 `INVALID_PARAMS`；在这之内 Worker 不改写调用方的文字，交给模型的方式按 `asr` 的 family 不同（与 v2 相同）：`qwen3-asr` 整段放进系统上下文；`whisper-coreml` 按 BPE 编码后接在 `<|startofprev|>` 之后作前置提示，最多占解码器 KV 缓存的一半（减去任务前缀），超出时从前面截、留最靠近音频的那一截——large-v3 约 220 个 token，large-v3-turbo 约 108 个；`whisper-mlx` 同样作前置提示，预算按每个 30 秒窗「提示 + 生成」共 224 个 token 的一半算，两个模型都约 108 个；`whisper-ggml` 作 whisper.cpp 的 initial prompt（去掉内嵌的 NUL），每个语音段解码前都重新放入（同一段内的后续 30 秒窗把它与已解出的文字一起滚动作前文），超出文本上下文的一半（224 个 token）时由 whisper.cpp 留最靠近音频的那一截；`moss-transcribe-diarize` 不交给模型，报 `hint-ignored`。流水线自动识别语言（`prefer`）时，在第一段识别出文字的段上定下任务的语言（`job.language` 与结果的 `language`）：优先用模型自报的语言名，其次按累计的文本推断；识别结果为空的段不算，模型在这样的段上自报的语言不采信。只有断言的语言交给模型；定下的语言不强加给之后的段，每段都由模型自己判断，对齐器与词时间估计用模型在这一段上自报的语言，报不出时用任务的语言（架构设计 §6.6 第 4 步）。本地模型都不给语言的置信度，`job.language` 与结果里的 `confidence` 为 null。

识别有两种执行方式，由 `asr` 的 family 决定。**流水线**（`qwen3-asr`、`whisper-mlx`、`whisper-coreml`、`whisper-ggml`）：先用 VAD 切出语音段，再逐段识别。三种 Whisper 把 `hint` 作为前置提示交给解码器；它们只出句级文本。模型包带了对齐器（几个模型族共用同一只 `qwen3-forced-aligner`）时，每段识别出的文本在这段的音频上强制对齐，词时间标 `aligned`（provenance 的 `models.aligner` 点名它），词的起点展开为严格递增，起止塌成一点的词补到一个对齐格（0.08 秒，至多到下一个词的起点或段尾）；对齐出错或对不出词时这一段退回按字符长度估计（`estimated`），并带 `alignment-failed` 警告（`segmentId` 指向这一段），任务不失败。没有对齐器时词时间一律按字符长度估计。`diarize: true` 时，模型包带了 `segmentation` 组件（`pyannote-segmentation`，与 `speaker` 的 `wespeaker` 一起来自「说话人区分」模型包，架构设计 §6.3）就在识别与对齐完成之后进 `diarizing` 阶段（`job.progress` 的 `unit` 是 `steps`）：Pyannote 分段按 10 秒窗、5 秒步长在整段音频上判断每个窗里最多 3 个本地说话人，WeSpeaker 给每个本地说话人提取声纹，带约束的凝聚聚类（合并阈值 0.715）合成全局说话人，再把说话人区间投影到词上（架构设计 §6.6 第 7 步）。词的 `speakerId` 是投影到它的说话人，段的 `speakerId` 是段内词的说话时长最多的那个；说话人按时间上第一次出现记为 `spk-1`、`spk-2`……（`label` 为 null），没分到词的说话人排在后面。provenance 的 `models.segmentation` 与 `models.speaker` 点名两个模型。没有 `speaker` 时按窗的重叠串联本地说话人（退化的路径，区分得差）。两个模型在第一次要说话人时才加载、任务结束即卸下，识别模型留着（与 v2 相同）；耗时（含加载）记在 `stats.diarizeMs`。模型包没有 `segmentation`、两个模型加载不了或推理出错时不区分，报 `diarization-unavailable`（`detail` 说明是哪种），转写照常完成。`job.segment` 与 `segmentsFile` 在区分之前写出：段的 `speakerId` 为 null，词不带 `speakerId`，说话人只在结果里。`diarize: false` 时不输出说话人。**自分段**（`moss-transcribe-diarize`）：整段音频一次交给模型，模型自己分块生成、切段并给出块内的说话人，没有 VAD 阶段，`stats.vadMs` 为 0；阶段依次是 `decoding`、`transcribing`，要说话人时 `diarizing`，有要对齐的行时 `aligning`，最后 `finalizing`。语言只在断言时交给模型；没断言时识别完按全文猜一次，猜出来就推送一次 `job.language` 并以 `detected` 作为结果的语言（`confidence` 为 null），猜不出是 `unknown`。模型没有提示通道，`hint` 非空时不交给模型并报 `hint-ignored`。某一块生成到上限或陷入重复、又切不开时保留已识别的部分，报 `segment-incomplete`（`detail` 说明是哪一块）。`diarize: true` 时，模型包带了说话人模型（`wespeaker`）就用各块说话人的声纹嵌入把块内标签合并成全局说话人（provenance 的 `models.speaker` 点名它），合并的耗时（含加载说话人模型）记在 `stats.diarizeMs`——块内的说话人是模型识别时一并给出的，分不出来，算在 `asrMs` 里；没有说话人模型或行与说话人区间对不上、而模型分了不止一块时保留块内标签，报 `diarization-unavailable`（同名标签在不同块里可能不是同一个人）。说话人按出现顺序记为 `spk-1`、`spk-2`……（`label` 为 null）；`diarize: false` 时不输出说话人。模型包带了对齐器时，长于 5 秒且没有词时间的行在行的音频窗口内强制对齐（语言取断言的或按全文猜出的语言，都没有时按 `en`），词标 `aligned`；对不出时这一行退回估计并带 `alignment-failed`（`segmentId` 指向它），对齐器加载不了时报一条不带 `segmentId` 的 `alignment-failed`。provenance 的 `models.aligner` 只在这个任务真用到对齐器时填写。其余行的词时间按字符长度估计（`estimated`）。分段按时间排序、截到输入范围内、去掉重叠：与前一行部分重叠的在重叠区中点分开；整个落在前一行里的（多人同时说话时的插话）按原时长从包住它的那行的尾巴上分出来（几行插话合起来至多分走那行的一半，超出时按比例缩短），排在那行之后，词跟着平移，带 `timing-adjusted`（`segmentId` 指向它）。对齐器与说话人模型用到时才加载、任务结束即卸下，两者不同时常驻；系统内存吃紧时先卸下 MOSS 再加载它们，下一个任务重新加载 MOSS。MOSS 没有预热，`model.load` 的 `warmupMs` 为 0；`capability: 'align'` 在带对齐器的 MOSS 模型包上同样可用（对齐器按需加载）。

**检查点**（`checkpoint`）：转写用它，`align` 忽略。Worker 读回文件里与这一次相符的工作接着做，每做完一份追加一条（格式与有效性见 §5）。自分段识别：已收下的初始分块不再生成；识别已经做完时不加载、不调用识别模型，`transcribing` 的进度一次报到总长；跨块合并已经做完时不加载说话人模型；要对齐的行都对齐过时不加载对齐器。流水线模型：切过段时不跑 VAD，`vad` 的进度一次报到总长；识别过的段不再识别、对齐过的段不再对齐，照常逐段推送 `job.segment` 与进度；说话人区分做完时不加载 Pyannote 与 WeSpeaker。provenance 照样点名做那份工作的模型，`runGeneration` 相同时 `result.json` 与一次跑完的逐字节相同（流水线模型的 `segments.jsonl` 也是）。不是绝对路径是 `INVALID_PARAMS`；读写出错，或别的 Worker 正拿着这个文件（§5 的文件锁）时，Worker 在 stderr 记一句、这一次不用检查点，任务照常进行。

**对齐**（`capability: 'align'`）：解码选定音轨（与范围），不跑 VAD 与识别，把 `text` 整段强制对齐到音频上（长音频由对齐器自己分块）。词按停顿（> 0.8 秒）、句末标点与段长（> 30 秒）分段，与在线 Provider 只给词时同一规则；段的文本由词重新拼出（不带空格书写的文字之间不加空格），零时长的段补到一个对齐格（0.08 秒），起点越过音频末尾的词丢弃。阶段依次是 `decoding`、`aligning`、`finalizing`；`stats.vadMs`、`asrMs` 与 `diarizeMs` 为 0，耗时记在 `alignMs`。对齐出错是 `INFERENCE_FAILED`——这里没有可退回的估计。结果的语言来源是 `asserted`，词时间都是 `aligned`。

#### 2.5.2 合成（已移出 Worker）

合同版本 2 起 Worker 不再合成语音：没有 `synthesize` 能力，`capability: 'synthesize'` 与别的未知能力一样是 `INVALID_PARAMS`。本地语音合成由随应用内置的 audio.cpp 引擎的常驻服务执行，参数、输出与失败见 §4.4。节号保留，后面的节号不变。

#### 2.5.3 文生图

本地生图（架构设计 §6.1、§6.5）：文生图，以及带输入图的两种用法——指令改图（`imageMode: 'ref'`，第一张是要改的图，其余是参考图，按顺序作为条件）与以图为底重画（`imageMode: 'img2img'`，一张源图，`strength` 定重画的程度）。参数是 Runtime 在提交时冻结的（`JobRecord.generation`），Worker 照做，不改尺寸、不换 seed；输入图是 Runtime 冻结并核对过的文件，Worker 只读。

```ts
params: {
  jobId: string;
  runGeneration: number;
  capability: 'image';
  options: {
    prompt: string;                   // 原样
    width: number;                    // 像素
    height: number;
    steps: number | null;             // 去噪步数；null 用模型的默认值（Qwen-Image 为 20；固定 sigma 表的权重包是表长，见下）。请求给了 `steps` 或模型包检查（§4.3）时给出
    seed: number;                     // 0..2^32-1；请求没给时 Runtime 在提交时抽一个并冻结，重试与重新执行用同一个
    images?: { file: string }[];      // 输入图，绝对路径；PNG、JPEG、WebP，按文件头认。不给即文生图
    imageMode?: 'ref' | 'img2img';    // 有 images 时必给
    strength?: number;                // 0..1，只在 img2img 时给且必给：越大离源图越远
  };
  staging: string;
  outputContract: 'baocut.image-png/v1';
}

result: {
  outcome: 'completed' | 'cancelled';
  output: { path: string; sha256: string; byteLength: number } | null;   // staging 里的 image.png（§5.1），绝对路径
  image: { width: number; height: number; format: 'png'; seed: number; steps: number } | null;
  stats: { generationMs: number; encodeMs: number };
}
```

阶段依次是 `encoding-prompt`（文本编码；有输入图时也含输入图的视觉编码与 VAE 编码）、`denoising`（去噪；`job.progress` 的 `unit: 'steps'`，开始时报 `0/n`，每完成一步报一次）、`decoding`（VAE 解码与写 PNG）。

改图时每张输入图各自等比缩放到约 1024² 像素（宽高取 32 的倍数），同一份像素分别给视觉编码（透明处合成到白底）与 VAE 编码（保留 alpha）；输出尺寸仍是请求的宽高。Qwen-Image 的 MLX 后端改图至多收 3 张（底图加参考图；模型本身收 1 + 9 张，每张的条件 token 让 DiT 多缓存约 2.2 GB 的键值，上限按实测的内存定），candle 后端不收输入图（两种用法都是 `MODEL_UNSUPPORTED`）。以图为底重画用文生图的提示词，源图等比缩放到盖满输出尺寸后居中裁切、VAE 编码，从第 `steps − round(steps·strength)` 步开始去噪（至少跑一步），起点是源图 latent 与 seed 噪声按该步的 σ 混合；`denoising` 的 `n` 是实际要跑的步数，`result.image.steps` 仍是冻结的步数。取消在步间生效，之后 `outcome: 'cancelled'`，不写输出。同一台机器、同一个后端上同一组参数（含 seed）逐字节得到同一张图；初始噪声由 seed 决定，但 MLX 与 candle 各用自己的随机数生成器（candle 是主机上的 ChaCha20，同 v2），同一个 seed 在两个后端上得到不同的图。

形状之外的检查都是 `INVALID_PARAMS`：`outputContract` 必须是 `baocut.image-png/v1`，`staging` 是绝对路径，`prompt` 去掉空白后非空，宽高为正，`steps` 不为 0；权重包的 `model_index.json` 带 `sample_sigmas`（蒸馏的 Qwen-Image-2.1-Turbo，8 步）时按这张表采样、不按调度器配置现算，`steps` 必须等于表长（diffusers 同样以表为准），否则 `INVALID_PARAMS`；`options` 多出字段或缺 `seed` 是形状错误；`images[].file` 是绝对路径，`images` 与 `imageMode` 同给同不给，`img2img` 必须给 `strength`（0..1）且只有一张图，非 `img2img` 不给 `strength`。模型出不了的尺寸在开跑前返回 `MODEL_UNSUPPORTED`（`details: { family, reason: 'unsupported-size', width, height, rule }`）；Qwen-Image 要求宽高都是 32 的倍数、长边不超过 3072（2K 档里最长的 2.35:1 是 3072×1312）、长短边之比不超过 3。Runtime 在提交时已按模型描述列出的尺寸拒绝过，这里是兜底。输入图同理：模型不收这种用法或张数超过上限时开跑前返回 `MODEL_UNSUPPORTED`（`details: { family, reason: 'images-unsupported' | 'img2img-unsupported' | 'too-many-images', count, max }`），读不出或解不开是 `INPUT_UNREADABLE`（`details: { input: 'image', index }`，消息不带路径）。加载的不是文生图模型包时返回 `MODEL_UNSUPPORTED`（`details: { capability: 'image', reason: 'capability-not-loaded' }`），反之亦然。引擎在推理中失败是 `INFERENCE_FAILED`（`details.reason: 'generation-failed'`，消息不带路径），出图的尺寸与请求不符是 `reason: 'size-mismatch'`，写不出文件是 `reason: 'write-failed'`。

#### 2.5.4 分离

本地人声分离（架构设计 §6.1 `separateAudio`）：把一条音轨整段分成人声与背景声两路。

```ts
params: {
  jobId: string;
  runGeneration: number;
  capability: 'separate';
  input: { file: string; contentHash: string; track: number };   // 同 §2.5.1，不接受 range：整段处理
  options: { sampleRate: number | null };   // 输出采样率，8000–192000；null 用模型的工作采样率（HTDemucs 为 44.1 kHz）
  staging: string;
  outputContract: 'baocut.stems-wav/v1';
}

result: {
  outcome: 'completed' | 'cancelled';
  stems: {                            // staging 里的 vocals.wav 与 background.wav（§5），绝对路径；cancelled 时为 null
    vocals: { path: string; sha256: string; byteLength: number };
    background: { path: string; sha256: string; byteLength: number };
  } | null;
  audio: { sampleRate: number; channels: 2; durationSec: number } | null;   // 两路共同的事实
  stats: { decodeMs: number; separationMs: number; encodeMs: number };
}
```

阶段依次是 `decoding`、`separating`、`encoding`。输入整段解进内存：轨 0 的单声道或立体声 WAV 保留原采样率，其他格式经 ffmpeg 解成模型的工作采样率的立体声（单声道复制成两路，多声道混成两路）。`htdemucs-ft` 是四个子模型（各管一个声部）的组合，在 44.1 kHz 上按 7.8 秒的窗口、0.25 的重叠推理；`job.progress` 的 `steps` 是「窗口 × 子模型」，开始时报 `0/n`。背景声是鼓、贝斯与其他三个声部之和。`mlx` 与 `candle` 读同一份权重、算同一张图，同一段输入的两路只差浮点累加次序。两路换算到 `options.sampleRate`、对齐到输入在该采样率上的长度，写成 16 位 PCM 立体声 WAV（裁到 [−1, 1]，不做响度处理），先写临时文件再重命名。

形状之外的检查都是 `INVALID_PARAMS`：`outputContract` 必须是 `baocut.stems-wav/v1`，`staging` 是已存在的绝对目录，`input.file` 是绝对路径，`sampleRate` 在范围内。输入读不出来或没有该音轨是 `INPUT_UNREADABLE`，解码中失败是 `DECODE_FAILED`；推理失败是 `INFERENCE_FAILED`（`details.reason: 'separation-failed'`，没有产出是 `'empty-audio'`）；写不出输出是 `OUTPUT_WRITE_FAILED`（`details.file`）。加载的不是分离模型包时返回 `MODEL_UNSUPPORTED`（`details: { capability: 'separate', reason: 'capability-not-loaded' }`），反之亦然。

#### 2.5.5 已有转写的说话人区分

给一份已经有的转写区分说话人，不重新识别（界面的「识别说话人」，架构设计 §6.6）。加载的是「说话人区分」模型包本身（只有 `segmentation` 与 `speaker`，§4.1），Runtime 把转写的词时间交来，Worker 只区分、投影，不改文字。

```ts
params: {
  jobId: string;
  runGeneration: number;
  capability: 'diarize';
  input: { file: string; contentHash: string; track: number; range?: TickRange };   // 同 §2.5.1；range 是要解码的一段，不给时整条音轨
  options: {
    timescale?: number;               // words 与结果里时间的刻度，默认 1_000_000
    words: Array<[start: number, end: number]>;   // 转写的词在素材时间上的起止（tick），按转写里的次序；可以为空
  };
  staging: string;
  outputContract: 'baocut.speakers/v1';
}

result: {
  outcome: 'completed' | 'cancelled';
  output: { path: string; sha256: string; byteLength: number } | null;   // staging 里的 speakers.json；cancelled 时为 null
  speakers: number;                   // 区分出的说话人数；cancelled 时 0
  stats: { decodeMs: number; diarizeMs: number };
}
```

`speakers.json`：

```ts
{
  schema: 'baocut.speakers/v1';
  clock: 'source-asset';
  timescale: number;
  speakers: Array<{ id: string; words: number; seconds: number }>;   // id 是 'spk-1'、'spk-2'……；seconds 是区间的总时长
  ranges: Array<{ start: number; end: number; speaker: string }>;    // 说话人区间，素材时间的 tick
  words: Array<string | null>;        // 与 options.words 一一对应：投影到的说话人，拿不到证据的词为 null
  provenance: {
    provider: 'local'; bundleId: string; backend: string; device: string; workerVersion: string;
    inputHash: string; runGeneration: number;
    models: { segmentation: ModelRef; speaker: ModelRef };
    threshold: number; sampleRate: 16000;
  };
}
```

阶段依次是 `decoding`（这一段解成 16 kHz 单声道，`job.progress` 按秒）、`diarizing`（`steps`）、`finalizing`。区分与识别时的说话人区分是同一套（§2.5.1）：Pyannote 分段按 10 秒窗、5 秒步长，WeSpeaker 提取声纹，带约束的凝聚聚类（合并阈值 0.715，不限人数），再按词时间把区间投影到词上；说话人按在词上第一次出现的次序编号，没分到词的排在后面。两个模型在 `model.load` 时一起读入、常驻到卸载。取消在下一个窗口生效，`outcome: 'cancelled'`，不写输出。

形状之外的检查都是 `INVALID_PARAMS`：`outputContract` 必须是 `baocut.speakers/v1`，`staging` 是已存在的绝对目录，`input.file` 是绝对路径，`timescale` 为正，`range` 的 `end` 大于 `start`，词的 `end` 不早于 `start`，词数不超过 200 万。输入读不出来或没有该音轨是 `INPUT_UNREADABLE`，解码中失败是 `DECODE_FAILED`；模型出错是 `INFERENCE_FAILED`（`details.reason: 'diarization-failed'`），与识别时降级成警告不同——这里区分就是任务本身；写不出输出是 `OUTPUT_WRITE_FAILED`（`details.file`）。加载的不是说话人区分的模型包时返回 `MODEL_UNSUPPORTED`（`details: { capability: 'diarize', reason: 'capability-not-loaded' }`），反之亦然。

#### 2.5.6 文本嵌入 `embed.run`

文本嵌入不是任务：没有 `jobId`、staging、事件与产物，一次请求同步返回一批向量（[EmbeddingGemma 2 检索规格 v0.1](../design/embedding/embedding-retrieval-spec-v0.1.md) §4、§5）。它是单独的方法，只在加载了带 `embedding` 组件的模型包（§4.5）时可用。

```ts
params: {
  requestId: string;                // 调用方给的 id，非空；`worker.status` 的 `job.jobId` 报它，`job.phase` 是 'embedding'
  texts?: string[];                 // 1..maxBatch（16）条，已加好任务前缀（前缀只由 Runtime 加一次）；不得是空白；单条不超过 256 KiB（UTF-8）
  images?: string[];                // 与 texts 二选一：1..maxImageBatch（4）个 JPEG / PNG 文件的绝对路径（Runtime 已校验在允许的根目录内），单个不超过 16 MiB
  outputSize: 128 | 256 | 512 | 768; // 引擎输出的维度（Matryoshka 截断由引擎做，结果已归一化）
  insertSpecialTokens: boolean;     // 分词时加 BOS/EOS 等特殊 token；EmbeddingGemma 2 与参考实现一致时为 true
}
result: {
  vectors: string[];                // 每条文本一个向量：little-endian float32 的 base64，次序同 texts
  dims: number;                     // = outputSize
  device: string;                   // 实际执行的设备：文字是 'metal' 或 'cpu'（GPU 起不来时退回的 CPU），图像总是 'cpu'（§4.5）
  elapsedMs: number;
}
```

- 参数先按形状检查，再检查状态：没加载或正在跑别的是 `WORKER_BUSY`；加载的不是嵌入模型包是 `MODEL_UNSUPPORTED`（`details: { capability: 'embed', reason: 'capability-not-loaded' }`）。`texts` 为空、多于 16 条、有空白条目（`details.index`）或 `outputSize` 不在 `embeddingCapabilities.outputSizes` 里是 `INVALID_PARAMS`。
- 超长不截断：某条超过 256 KiB，或分词后超过 `maxInputTokens`，整个请求以 `INPUT_TOO_LONG` 失败，`details.index` 是这一批里第一条超长的序号（从 0 数）。批量调用报超长时 Worker 逐条重算找出是哪一条。Runtime 把它换成整个请求里的序号（从 1 数）报给调用方，不当作模型故障、不停用模型包。
- 引擎返回的条数、维度不对或有非有限值是 `INFERENCE_FAILED`；C 库报资源不足是 `MODEL_RESOURCE`。
- 图像（检索规格 §6.2 的关键帧）不加前缀：Worker 读文件，原样交给引擎解码，逐张算，向量与文字在同一个空间（text-to-visual）。加载时没带 `vision` 是 `MODEL_UNSUPPORTED`（`details: { capability: 'embed', reason: 'vision-not-loaded' }`）；`texts` 与 `images` 都给、都不给、多于 4 张或路径不是绝对路径是 `INVALID_PARAMS`；文件读不了、为空或超过 16 MiB 是 `INPUT_UNREADABLE`（`details: { index, reason: 'not-found' | 'size' | 'read-failed' }`，不带路径），引擎解不开这张图（C API 状态 3）同样是 `INPUT_UNREADABLE`（带 `index`）。都不停用模型包。
- 一批在推理线程上一次算完，不响应取消：`job.cancel` 不适用于它。Runtime 取消时不打断进行中的一批，之后的批次不再发出。Runtime 对同一个 Worker 串行发出 `embed.run`（前一批返回才发下一批），批与批之间可以穿插别的请求。

### 2.6 `job.cancel`

```ts
params: { jobId: string }
result: { acknowledged: true }
```

Worker 立即响应，然后在下一个分段边界（生图是下一个去噪步，分离与说话人区分是下一个窗口）停止任务；`job.run` 随后以 `outcome: 'cancelled'` 返回。未知的 `jobId` 返回 `NOT_FOUND`。

## 3. 事件

| 事件 | params | 语义 |
| --- | --- | --- |
| `model.phase` | `{ phase: 'loading-weights' \| 'compiling' \| 'warming-up', detail?: string }` | 加载阶段；没有百分比 |
| `job.phase` | 识别：`{ jobId, phase: 'decoding' \| 'vad' \| 'transcribing' \| 'aligning' \| 'diarizing' \| 'finalizing' }`；生图：`{ jobId, phase: 'encoding-prompt' \| 'denoising' \| 'decoding' }`；分离：`{ jobId, phase: 'decoding' \| 'separating' \| 'encoding' }`；说话人区分：`{ jobId, phase: 'decoding' \| 'diarizing' \| 'finalizing' }` | 阶段切换；第一个事件之前 `worker.status` 报告 `starting` |
| `job.progress` | `{ jobId, phase, done: number, total: number \| null, unit: 'seconds' \| 'segments' \| 'steps' }` | `total` 未知时为 null，不伪造；`steps` 是生图的去噪步，分离的「窗口 × 子模型」，说话人区分的窗口 |
| `job.segment` | `{ jobId, segment: Segment }` | 识别的一个段完成；与 `segmentsFile` 中的一行相同 |
| `job.warning` | `{ jobId, warning: Warning }` | 识别的结构化警告，最终也出现在结果的 `warnings[]` |
| `job.language` | `{ jobId, tag: string, confidence: number \| null }` | 识别自动检测到的语言 |

事件只描述事实，Runtime 据此更新 `jobs` 主题。

## 4. 模型包描述

### 4.1 模型包与文件

Runtime 把模型包的全部文件路径显式交给 Worker；Worker 不扫描目录，不联网。

```ts
interface ModelBundle {
  bundleId: string;                   // 例如 'qwen3-asr-0.6b@mlx-4bit'、'qwen3-asr-0.6b@candle'
  backend: 'mlx' | 'coreml' | 'candle' | 'ggml' | 'audio-cpp' | 'litert-lm';   // mlx、coreml 只在 Apple Silicon 的 macOS 上；audio-cpp 不交给 Worker（§4.4）；litert-lm 只用于文本嵌入（§4.5）
  device: string;                     // mlx 为 'metal'，coreml 为 'ane'，candle 为 'cuda' 或 'cpu'，ggml 为 'cuda'、'vulkan'、'metal' 或 'cpu'（§2.1）；audio-cpp 为 'auto'（引擎自选，§4.4）；litert-lm 为 'metal' 或 'cpu'（§4.5）
  components: {
    asr?: ModelFiles;
    vad?: ModelFiles;
    tokenizer?: ModelFiles;           // 识别模型单独仓库的分词器（Whisper）
    aligner?: ModelFiles;
    speaker?: ModelFiles;
    segmentation?: ModelFiles;        // 说话人分段（Pyannote，与 `speaker` 一起来自「说话人区分」模型包，§2.5.1）
    tts?: ModelFiles;                 // 语音合成模型（audio.cpp 的单个 GGUF）；不与别的组件同在一个模型包里，Worker 不加载它（§4.4）
    separator?: ModelFiles;           // 人声分离模型（HTDemucs-FT）
    image?: ModelFiles;               // 文生图模型（Qwen-Image：一个仓库里的分词器、调度器配置、文本编码器、DiT 与 VAE）
    music?: ModelFiles;               // 音乐生成模型（YuE2 的 GGUF：主模型、VAE 与分词表同在一个仓库）；不与别的组件同在一个模型包里，Worker 不加载它（§4.4）
    embedding?: ModelFiles;           // 文本嵌入模型（EmbeddingGemma 2 的单文件 `.litertlm`，§4.5）
    'litertlm-runtime'?: ModelFiles;  // LiteRT-LM 的 C 动态库（发布页组件，§4.5）；只与 `embedding` 同在
  };
  threads: number;                    // CPU 线程数上限
  memoryBudgetBytes: number | null;   // 准入给出的预算；null 为不限制
  cacheDir?: string;                  // 引擎可写的缓存目录（绝对路径，§4.5）；只有 `litert-lm` 用，没给时用系统临时目录
  vision?: { tokensPerImage?: number }; // 嵌入模型包打开图像编码器（§4.5、§2.5.6 的 `images`）；只有 `litert-lm` 用
}

interface ModelFiles {
  family:
    | 'qwen3-asr' | 'whisper-mlx' | 'whisper-coreml' | 'whisper-ggml' | 'moss-transcribe-diarize' | 'whisper-tokenizer'
    | 'qwen3-forced-aligner' | 'silero-vad' | 'wespeaker' | 'pyannote-segmentation'
    | 'qwen-image' | 'htdemucs-ft'
    | 'qwen3-tts' | 'indextts2' | 'indextts2.5' | 'voxcpm2' | 'omnivoice' | 'fish-s2-pro'   // 语音合成（§4.4），只由 audio.cpp 引擎读
    | 'embeddinggemma2-litert' | 'litertlm-runtime'   // 文本嵌入（§4.5）
    | 'yue2';                         // 音乐生成（§4.4），只由 audio.cpp 引擎读
  revision: string;                   // 上游仓库的 revision
  dir: string;                        // 绝对路径
  files: Array<{ path: string; sha256: string; byteLength: number }>;   // 相对 dir
}
```

模型目录的布局是 `<models-root>/<owner>/<repo>/`，`<models-root>` 默认为 `<runtime-home>/models`，可在设置里改（`models.dir`，经 `models.setDir`），`BAOCUT_MODELS_DIR` 优先（架构设计 §6.3）。下载时选了别的文件夹的仓库在 `<那个文件夹>/<owner>/<repo>/`，布局相同，位置记在 Runtime Home 的 `store/model-locations.json`（架构设计 §6.3「存放位置」）。Worker 只按 `load_bundle` 给的路径读文件，不关心模型目录在哪；换目录前 Runtime 先卸下所有 Worker。每个仓库目录带 `.bcut-manifest.json`（`format_version: 1`，含 `repo`、`revision`、`files[{path,size,sha256}]`，与旧版本 BaoCut 的下载器兼容）；Runtime 的模型目录以它为 `files` 的来源，缺清单或清单与磁盘不符即 `not-installed`。Worker 加载前逐个校验 `files` 的大小；sha256 的校验由 Runtime 在安装与登记时完成，Worker 只在 `files` 列出的文件之外不读任何文件。`family` 决定加载器；未知的 `family` 返回 `MODEL_UNSUPPORTED`。一个模型包要么是识别（`asr` 必有，其余组件按 `asr` 的 family），要么是文生图（只有 `image`，带别的组件是 `MODEL_UNSUPPORTED`），要么是分离（只有 `separator`，带别的组件是 `unexpected-component`），要么是说话人区分（`segmentation` 与 `speaker` 都必需，family 是 `pyannote-segmentation` 与 `wespeaker`，没有 `asr`，带别的组件是 `unexpected-component`；§2.5.5），要么是文本嵌入（`embedding` 与 `litertlm-runtime` 都必需，backend 是 `litert-lm`，带别的组件是 `unexpected-component`；§4.5），不混用。语音合成（`tts`）与音乐（`music`）的模型包由 audio.cpp 引擎执行（§4.4），Runtime 不交给 Worker。文生图不按 `memoryBudgetBytes` 检查权重大小：三段权重逐层流式读入、从不同时驻留，进程峰值远小于权重总量（candle 在 CUDA 上另把打包的 DiT 权重在一次生成里按空闲的显存留在显卡上，DiT 那段结束即放掉，所以显存用量可以高于登记的峰值，登记的是流式的下限），准入由 Runtime 按模型包登记的实测峰值做（架构设计 §6.5）。识别的组件：

| `asr` family | `vad` | `tokenizer` | `aligner`、`speaker` | `segmentation` |
| --- | --- | --- | --- | --- |
| `qwen3-asr` | 必需（`silero-vad`） | 不得有 | 可选 | 可选（`pyannote-segmentation`） |
| `whisper-mlx` | 必需（`silero-vad`） | 必需（`whisper-tokenizer`） | 可选 | 可选（`pyannote-segmentation`） |
| `whisper-coreml` | 必需（`silero-vad`） | 必需（`whisper-tokenizer`） | 可选 | 可选（`pyannote-segmentation`） |
| `whisper-ggml` | 必需（`silero-vad`） | 不得有（词表在 GGML 文件里） | 可选 | 可选（`pyannote-segmentation`） |
| `moss-transcribe-diarize` | 不得有（自分段） | 不得有 | 可选 | 不得有（自己区分说话人） |

缺必需组件是 `MODEL_UNSUPPORTED`（`details: { component, reason: 'missing-component' }`），多了不该有的是 `reason: 'unexpected-component'`，组件的 family 不对是 `reason: 'unknown-family'`。Runtime 登记的模型包可以把共用的组件（对齐器、说话人模型）标为可选：安装与修复照样下载它，缺它时模型包仍算装好，交给 Worker 的 `components` 里略去它。`segmentation` 与 `speaker` 也可以来自识别模型包登记的「说话人区分」模型包：那个模型包装好时 Runtime 把它的两个组件加进交给 Worker 的 `components`，没装好时都不加（架构设计 §6.3）。Core ML 的模型是目录（`.mlmodelc`）：清单与 `files` 必须逐个列出目录里的全部文件（大小照样逐个校验），Worker 把目录整体交给框架、不扫描它；`files` 里这个目录下一个文件都没有时是 `MODEL_NOT_INSTALLED`（`details: { component, file: '<目录>/', reason: 'not-listed' }`）。`coreml` 后端的设备是 `ane`（编码器与解码器跑在神经网络引擎上，mel 在 CPU 与 GPU 上），别的设备是 `MODEL_UNSUPPORTED`（`reason: 'unsupported-device'`）；VAD 跑在 MLX 上，没有 Metal 设备时后端不可用。`candle` 后端读与 MLX 相同的仓库（MLX 的仿射量化权重加载时反量化，CPU 上算 f32，CUDA 上算权重的半精度；`qwen-image` 逐层用到时才反量化，CUDA 上算 bf16），设备是 `cpu` 或 `cuda`；`cuda` 要求 Worker 在 §2.1 报告了它，否则与别的设备一样是 `MODEL_UNSUPPORTED`（`reason: 'unsupported-device'`）。Silero VAD 在 `candle` 上总跑在 CPU 上。`ggml` 后端用 whisper.cpp 按量化原样加载 `whisper-ggml` 的 `asr`：要有一个 `.bin`（单文件 GGML 权重），没列出是 `MODEL_NOT_INSTALLED`（`details: { component: 'asr', file: '*.bin', reason: 'not-listed' }`）；VAD 与对齐器借 `candle` 的、跑在 CPU 上，所以 `ggml` 只在同时编进 `candle` 的构建里有。设备是 `cpu`、`cuda`、`vulkan` 或 `metal`；GPU 设备要求 Worker 在 §2.1 把它报成首选设备（同时编进两个 GPU 后端、选中 CUDA 的 Worker 不收 `vulkan`），别的设备是 `MODEL_UNSUPPORTED`（`reason: 'unsupported-device'`）。`cpu` 模型包不提交 GPU 计算。Intel Mac 的 Metal Worker 启动线程前自动设置 `GGML_METAL_CONCURRENCY_DISABLE=1`（同一 PID 重新执行），规避当前 ggml 并发调度在 AMD 独显上的计算错误，不改变协议或设备标签。`whisper-coreml` 的 `asr` 要有 `MelSpectrogram.mlmodelc/`、`AudioEncoder.mlmodelc/`、`TextDecoder.mlmodelc/` 与 `generation_config.json`，有 `TextDecoderContextPrefill.mlmodelc/`（large-v3-turbo）就用它预填前缀；`tokenizer` 要有 `tokenizer.json`。`whisper-mlx`（`mlx` 后端，设备 `metal`）的 `asr` 是 mlx-community 的 fp16 转换：要有 `config.json`（OpenAI 原版的结构字段 `n_mels`、`n_audio_*`、`n_text_*`、`n_vocab`）与 `.safetensors` 权重；配置的结构对不上（例如不是 30 秒窗、文本上下文短于 224）是 `MODEL_UNSUPPORTED`（`details: { component: 'asr', file: 'config.json', reason: 'unsupported-config' }`），在读权重之前报；`tokenizer` 要有 `tokenizer.json` 与 `generation_config.json`（Core ML 的 `generation_config.json` 在 `asr` 里，MLX 的转换仓库没有它，取分词器仓库里的同一份）。`htdemucs-ft` 的 `separator` 要有 `htdemucs_ft.safetensors` 与 `htdemucs_ft_config.json`（fp16 权重加载后升成 f32，常驻约为文件的两倍；`candle` 在 CPU 与 CUDA 上都按 f32 算，不用半精度）。几个模型包用到同一个仓库版本时共用一个仓库目录，删除时按引用保留（架构设计 §6.3）。


### 4.2 内置清单与下载

架构设计 §6.3。Worker 不下载。Runtime 为每个登记的组件（上游仓库的一个固定 `revision`）带一份内置清单：要下载的文件、每个文件的 sha256 与大小（离线无法确认的大小为 null，做安装计划时向来源发 HEAD 取 `x-linked-size` 或 `Content-Length`），另有大小未知时用于确认的估计值与哈希的来源说明。规则：

- 只下载清单列出的文件，地址是 `<基址>/<owner>/<repo>/resolve/<revision>/<文件路径>`（基址见架构设计 §6.3；逐段 URL 编码，`/` 保留）。
- 先写进仓库所在根（模型目录，或下载时选的文件夹）下的暂存区 `<根>/.bcut-staging/<owner>/<repo>@<revision>/`：没下完的是 `<path>.part`，续传时带 `Range: bytes=<已有字节>-`，`206` 的 `Content-Range` 必须从这个位置开始，`200` 表示来源不支持续传，从头写。每个文件按清单核对大小与 sha256，对上了才改名为 `<path>`；暂存区里核对过的文件不再下载。
- 一个仓库的文件齐了，写 `.bcut-manifest.json`（`files` 是实际的大小与 sha256，`source_verified: true`，`source` 为下载的基址），整个暂存目录改名为仓库目录（旧目录先挪开，换上之后删掉）。暂存区与模型目录在同一个卷上，改名是原子的。
- 清单里有文件缺可信的 sha256 时整个组件拒绝安装（`MODEL_MANIFEST_INCOMPLETE`），不下载了再算。哈希的来源与核对状况记在清单的说明里；没有重新核对过的列在架构设计 §14。
- 修复读一遍仓库目录里每个文件的 sha256，好文件硬链接（不行就复制）进暂存区，只下载坏的与缺的，再按上面的方式发布。

### 4.3 检查

**识别**。随 Runtime 分发一段固定的样本（转写是英文朗读，`packages/models/assets/self-test-sample.wav`，16 kHz 单声道；打包后在 `<resources>/model-assets/`，找法见根 README 的 `BAOCUT_MODEL_ASSETS_DIR`），检查以它为输入走一遍 `model.load` → `job.run`，按 §6 校验输出，再核对识别文本（小写、去标点后，英文的个位数词与阿拉伯数字视作相同）含固定的短语。

**合成**。不经 Worker（§4.4）：用模型的默认声音（不指定声音时提交会选的那个，内置音色照常带参考录音）合成一句固定的短句：模型列出的第一种有句子的语言，接受任意语言或列出的语言都没有句子时用英文那句。句子表在 `packages/models/src/speech-self-test.ts`。输出按 §5.1 核对长度与摘要，再判定：

- 能解码：RIFF/WAVE，PCM 16/24/32 位或 32 位浮点（含 `WAVE_FORMAT_EXTENSIBLE`），1–2 声道，采样率 8–192 kHz；
- 时长在 0.3–30 秒之间；
- 不是静音：全部样本的均方根（满幅为 1）不低于 0.001（约 −60 dBFS）；
- 没有削波：到了满幅（|x| ≥ 0.999）的样本不超过全部样本的 0.1%。本地合成的输出已经限到 −1 dBFS（§5.1），超过这个比例说明那一步失效了。

检查不判断读得对不对（那要另一个识别模型），只证明整条合成链路能出声。通过时记下时长与采样率，WAV 作为产物留存；不通过记下原因。

**文生图**。用固定的提示词、256×256、4 步、seed 7 生成一张（参数在 `packages/models/src/image-self-test.ts`；固定 sigma 表的权重包只收表长的步数，用它，如 Turbo 的 8 步）。输出按 §5.1 核对长度与摘要，再判定：

- 能解码：8 位 PNG（灰度、RGB、带 alpha 的灰度或 RGBA），不隔行；
- 宽高等于请求的 256×256；
- 不是一整片纯色：不同的颜色（含 alpha）至少 16 种。

检查不判断画得好不好，只证明整条生图链路能出图。通过时记下尺寸与步数，PNG 作为产物留存；不通过记下原因。

**音乐**。不经 Worker（§4.4）：用固定的风格描述（`calm solo piano, slow tempo`）、`instrumental`、不编排（`planning: 'off'`）、上限 8 秒、seed 7、4 步起一次引擎（参数在 `packages/models/src/music-self-test.ts`），输出按 §5.1 核对长度与摘要，判定与合成相同（能解码、0.3–30 秒、不是静音、没有削波）。检查不判断好不好听，只证明引擎与权重能出声。通过时记下时长、采样率与步数，WAV 作为产物留存；不通过记下原因；找不到内置引擎时模型包是 `error` / `unsupported`（§4.4），`models.test` 同其他不可用的模型包一样以 `MODEL_UNAVAILABLE` 拒绝。

**分离**。把识别用的同一段样本（只有人声）按 §2.5.4 分离，`sampleRate` 为 null。两路按 §5 核对长度与摘要，再判定：

- 都能解码（同上），是立体声，采样率相同，时长与样本相差不超过 0.02 秒；
- 人声不是静音：均方根不低于 0.001；
- 人声与背景分开了：人声的均方根至少是背景的 2 倍（约 6 dB）。HTDemucs-FT 在这段样本上约高 40 dB。

通过时记下时长、采样率与人声比背景高多少 dB，人声 WAV 作为产物留存；不通过记下原因（`MODEL_OUTPUT_WRONG`）。

### 4.4 audio.cpp 引擎：音乐生成、人声分离与语音合成

`audio-cpp` backend 的模型包**不交给 Model Worker**，由随应用内置的 audio.cpp 引擎（上游 [0xShug0/audio.cpp](https://github.com/0xShug0/audio.cpp)）执行：音乐生成（`generateMusic`，架构设计 §6.1）与添加的人声分离模型包（`separateAudio`）每次起一个命令行进程 `audiocpp_cli`，语音合成（`synthesizeSpeech`）每个用到的模型包一个常驻服务进程 `audiocpp_server`。两者是同一份构建，直接读模型包目录里的 GGUF，没有 `model.load` 与 `job.cancel`。模型包只有权重：安装、清单与校验照 §4.1–4.2（`.bcut-manifest.json`、只下载清单列出的文件）。

**引擎**。随应用分发，不另外下载，也不是受管外部工具：上游预编译包的版本、各平台的文件名、大小与 sha256 登记在 `@baocut/models` 的 `audio-cpp-engine.ts`（目前 0.9.3），打包时取目标平台的包、核对后原样放进 `<resources>/bin/audiocpp/`（`audiocpp_cli`、`audiocpp_server`、上游 `LICENSE`，Windows 另有 MSVC 运行库 DLL）。各平台：macOS arm64 / x64 是 Metal 版（静态链接，只依赖系统框架）；Windows x64 与 Linux x64 是 Vulkan portable 版，Windows 的 `cpu` 安装包与 Linux 的 CPU 构建用 CPU portable 版。Vulkan 版启动时要系统里有 Vulkan 加载器（显卡驱动带的 `vulkan-1.dll` / `libvulkan.so.1`），没有时进程起不来。Linux arm64 与 Windows arm64 上游没有发布。开发时引擎在 cargo 产物目录的 `audiocpp/`，由 `npm run build:audiocpp` 按同一份登记下载、核对、解开（`npm run setup` 包含它）。

可执行文件每个任务重新找：环境变量 `BAOCUT_AUDIOCPP_CLI` 给了就只用它（文件不存在算找不到；服务取同目录的 `audiocpp_server`），否则是内置的目录；不找 `PATH`。找不到时，装好的 `audio-cpp` 模型包是 `error` / `unsupported`（说明是 `engineMissing` 的文案：这台主机没有引擎的构建，或安装不完整），任务以 `unavailable`（`MODEL_LOAD_FAILED`，`details.reason: 'unsupported'`，`details.bundleId`）失败。Runtime 的自检（`runtime --self-check`）报告两个可执行文件解析到哪里，`--probe` 时各跑一次 `--version`，退出码须为 0。`--version` 的第一行是 `audio.cpp <版本>`（自己构建的是 `audio.cpp dev`），另有一行 `backends: <逗号分隔>` 列出编进去的后端。

设备由引擎按构建选。命令行引擎自己挑（Metal、CUDA、Vulkan 或 CPU）；服务不给后端时默认 CUDA，没编进 CUDA 的构建会起不来，所以 Runtime 总在服务配置里写 `backend`：按 `backends:` 行依次取 `metal`、`cuda`、`vulkan`、`hip` 中第一个有的，都没有时 `cpu`。环境变量 `BAOCUT_AUDIOCPP_BACKEND`（`metal` / `cuda` / `vulkan` / `cpu`）给了时两者都用它（命令行传 `--backend`）。

许可：audio.cpp 是 Apache-2.0（Copyright 2026 ShugoAI LLC）；静态链接的第三方组件（ggml、SentencePiece、cJSON、cpp-httplib、libyaml 等）见 `THIRD_PARTY_NOTICES.md`，许可原文随应用分发（`packages/models/licenses/audio.cpp.txt`）。模型权重的许可按各模型包登记。

#### 音乐生成

音乐生成的模型包是 `music` 能力的 GGUF 权重（目前 `yue2-3b@audio-cpp-q8`：`audio-cpp/Yue2-3B-GGUF` 仓库里的 Q8 主模型 `yue2-3b-q8_0.gguf`、F16 VAE `yue2-vae-f16.gguf` 与四个配置文件，约 4.6 GB，`yue2` 族，许可 CC-BY-NC-4.0）。Runtime 的本地 Provider 为每个任务起一个 `audiocpp_cli`，引擎把 WAV 写进这次尝试的 staging，退出即结束，不常驻；取消是结束整个进程组（先 SIGTERM，宽限期 5 秒后 SIGKILL；Windows 上结束整棵进程树）。

**命令行**。冻结的参数（`JobRecord.generation`，`capability: 'generateMusic'`）换算成引擎的参数，`cwd` 是 staging，stdout 与 stderr 的尾巴（2000 字符）留给失败说明：

```text
audiocpp_cli --task gen --family yue2 --model <模型包目录> --threads <n>
  --lyrics <歌词；instrumental 时为空字符串>
  --request-option style=<style>
  --request-option cot=<planning：off | melody | full>
  --request-option seed=<seed>
  --request-option semantic_min_tokens=<min(200, semantic_max_tokens)>
  --request-option semantic_max_tokens=<round(maxDurationSec × 25)，至少 1>
  [--request-option num_inference_steps=<steps>]        # 冻结了 steps（或自检给的少步数）时才传，否则引擎用默认值
  --session-option yue2.model_gguf=yue2-3b-q8_0.gguf      # 相对于 --model 的模型根；引擎拒绝绝对路径
  --session-option yue2.vae_gguf=yue2-vae-f16.gguf
  --out-dir <staging> --out music.wav --log
  [--backend <metal | cuda | vulkan | cpu>]
```

- 时长没有直接的参数：`maxDurationSec` 按模型包登记的语义帧率（YuE2 每秒 25 个语义 token）换成 `semantic_max_tokens`，所以它是计算预算而不是承诺的时长；`targetDurationSec` 只写在任务记录里，不交给引擎。
- 语义采样下限沿用 audio.cpp 0.9.3 的 200 token 缺省值，但不超过本次换算的上限；短请求（不足 8 秒）一起降低下限，避免引擎以 `Yue2 semantic sampling options are invalid` 拒绝，不增加用户给定的时长预算。其他采样参数仍用引擎的默认值，编排模式不改变这条规则。
- 线程数默认是 `min(8, 可用并行数 − 2)`，至少 1。
- 引擎不报告步数：进入 `generating` 后只有不定进度，完成时报 1/1。

**结果**。退出码 0 且 staging 里有 `music.wav` 才算成功（引擎按自己的规则改了名时取 staging 里第一个 `.wav` 并改名为 `music.wav`）。找不到引擎（见上）或进程起不来是 `unavailable`（任务错误 `MODEL_LOAD_FAILED`），非零退出是 `crashed`（`MODEL_WORKER_CRASHED`，附 stderr 尾巴），退出了却没有 WAV 是 `protocol`（`MODEL_OUTPUT_INVALID`）；命令与协议规范 §11.3。输出合同是 `baocut.music-wav/v1`（§5.1）；WAV 的时长达到 `maxDurationSec` 的 98% 时视为撞上限，任务带 `output-truncated` 警告，照样完成。`workerVersion` 记为 `audiocpp_cli@<可执行文件名>`。

**资源**。没有常驻进程与 holder：每个任务按模型包登记的估计峰值（YuE2 Q8 加 F16 VAE 约 10 GiB，`peakEstimated`，上游在一块 32 GB 的 NVIDIA 卡上实测约 8.9 GB 后留的余量）直接计入任务，Apple Silicon 计 GPU 内存、别的平台计内存，另加 256 MiB 的 staging（五分钟 44.1 kHz 立体声 WAV 约 50 MiB 加日志）；架构设计 §7.7。

#### 人声与背景分离

用户添加的 audio.cpp 分离模型包（架构设计 §6.3「添加 audio.cpp 模型」：HTDemucs、Mel-Band RoFormer 两族，目录里的包或自己指定的一个 GGUF）是 `separate` 能力、`backend: 'audio-cpp'`，只有一个 `separator` 组件，定义带 `separation`（引擎的模型族、GGUF 相对组件目录的路径、哪几轨相加成人声与背景、估计峰值）。它与内置的 MLX 分离模型包交出同一个结果（§2.5.4 的 `separate`：staging 里的 16 位 PCM 立体声 `vocals.wav` 与 `background.wav`，结果的形状相同），翻译配音的分离一步与模型检查（§4.3）按模型包分派，不分来源。每次分离：

1. ffmpeg 把输入的第 `track` 条音轨解成 44.1 kHz 立体声 32 位浮点 WAV（引擎不重采样，别的采样率直接报错；单声道复制成两路，多声道混成两路），放在 staging 的 `audio-cpp/` 里；
2. 起一个 `audiocpp_cli`，`cwd` 是 `audio-cpp/`，取消与失败的报法同音乐生成：

   ```text
   audiocpp_cli --task sep --family <htdemucs | mel_band_roformer> --model <组件目录>/<GGUF>
     --threads <n> --audio <解出的 WAV> --out-dir <audio-cpp/stems>
     --out-format float32 --metrics
     [--backend <metal | cuda | vulkan | cpu>]
   ```

   引擎把每一轨写成 `<轨名>.wav`（32 位浮点、44.1 kHz、与输入等长）：HTDemucs 是 `vocals`、`drums`、`bass`、`other`，Mel-Band RoFormer 是 `vocals`、`instrumental`；
3. ffmpeg 把登记的几轨相加（`amix`，不归一化）：人声是 `vocals`，背景是 HTDemucs 的鼓、贝斯、其他之和或 Mel-Band RoFormer 的 `instrumental`；换算到请求的 `sampleRate`（null 时 44.1 kHz），写成 staging 的 `vocals.wav` 与 `background.wav`（换成 16 位时裁到 [−1, 1]），然后删掉 `audio-cpp/`。

**结果**。读不了输入是 `input-unreadable`，找不到引擎或进程起不来是 `unavailable`，非零退出是 `crashed`，退出码 0 却缺登记的某一轨是 `protocol`；合成两路失败是 `output-unwritable`。结果的 `audio` 取人声 WAV 的头，`stats` 是解码、分离与合成两路各自的毫秒数；`workerVersion` 记为 `audiocpp_cli@<可执行文件名>`。引擎不报告进度。

**资源**。没有常驻进程与 holder：引擎进程只在分离这一步里活着，按模型包登记的估计峰值（两族都是 3 GiB）计入这一步（Apple Silicon 计 GPU 内存，别的平台计内存），另加这一步自己的内存与 staging；架构设计 §7.7。引擎整段读入、各轨整段写出，峰值随素材时长增长：同一台 M4 Metal 上 640 秒输入实测 HTDemucs 2.7 GB、Mel-Band RoFormer 2.4 GB，10 秒输入约 0.46 GB；更长的素材会超过估计。

#### 语音合成

合成的模型包是 `synthesize` 能力的 GGUF 权重，登记在 `@baocut/models` 的 `speech-bundles.ts`：权重取自上游一个大仓库 `audio-cpp/audio.cpp-gguf`（固定 revision）的子目录，每个模型一个 Q8 GGUF（主模型、编解码器或声码器、分词器与模型规格都在里面），各模型包在模型目录里是兄弟目录 `audio-cpp/audio.cpp-gguf-<模型>`，只下载自己那个文件，各装各删。

| 模型包 | 引擎的模型族 | 采样率 | 声音与旋钮 |
| --- | --- | --- | --- |
| `qwen3-tts-0.6b-base@audio-cpp-q8`、`qwen3-tts-1.7b-base@audio-cpp-q8` | `qwen3_tts` | 24 kHz | 内置音色与克隆（参考原文可选） |
| `qwen3-tts-1.7b-customvoice@audio-cpp-q8` | `qwen3_tts` | 24 kHz | 模型自带的九个说话人（`voice_id`），语气说明（`instruct`） |
| `qwen3-tts-1.7b-voicedesign@audio-cpp-q8` | `qwen3_tts` | 24 kHz | 按描述造声（`instruct`），内置音色换成描述 |
| `indextts2@audio-cpp-q8`、`index-tts2.5@audio-cpp-q8` | `index_tts2` | 22.05 kHz | 内置音色与克隆（不读参考原文），情绪；2.5 有语速，认读音标注 |
| `voxcpm2@audio-cpp-q8` | `voxcpm2` | 48 kHz | 内置音色与克隆，风格说明，CFG 与步数 |
| `omnivoice@audio-cpp-q8` | `omnivoice` | 24 kHz | 内置音色、克隆与按封闭词表描述，语速、CFG 与步数；一次至多 60 秒 |
| `fish-s2-pro@audio-cpp-q8` | `fish_audio`（路由 `clon`） | 44.1 kHz | 内置音色与克隆；参考录音必须带原文，至多 30 秒 |

不可商用的权重（OmniVoice 的 CC-BY-NC-4.0、Fish Audio S2 Pro 的 Fish Audio Research License）在模型包的 `license.commercialUse: false` 里说明，由界面在下载与选用前提示。

**服务**。每个用到的模型包起一个 `audiocpp_server`：Runtime 在临时目录写一份配置（`host: '127.0.0.1'`、一个空闲的随机端口、`backend`（见上）、`threads`、`lazy_load: false`、`max_loaded_models: 1`，`models` 里只有这个模型包的 GGUF，带引擎的模型族、路由 `task`（默认 `tts`）与 `mode: 'offline'`），以 `--config <文件> --no-ui` 启动（不开上游的网页界面），轮询 `GET /health`（每 250 毫秒）直到回 200，至多等 5 分钟。服务启动时就加载模型；就绪后同一个模型包的请求排队，一次一个；空闲 10 分钟后退出，下次用时再起。删除、搬动模型目录之前，装好之后，以及空闲时被资源调度要求让位时，空闲的服务退出；有任务排队或正在合成时不动它。

**请求**。冻结的参数（`JobRecord.generation`，`capability: 'synthesizeSpeech'`）换成一次 `POST /v1/audio/speech`（JSON）：

- `input` 是正文，读音标注按下面「读音标注」渲染；VoxCPM2 的风格说明接在正文前（`(说明)正文`）。
- `options`：`language` 在请求的语言（BCP 47）整个或主语言子标签是引擎认得的语言 ID 时给出，否则不给、由模型自己判断；`text_chunk_size` 是长文按句切块的字符上限（Qwen3-TTS 150、IndexTTS 120、VoxCPM2 300；Fish 用引擎的默认，OmniVoice 由引擎按时长自动切），切块与拼接都在引擎里；`instruct` 是语气说明或声音描述；`voice_id` 是模型自带的说话人；语速是 `speed`，IndexTTS 2.5 换成 `duration_scale = 1 / 语速`；CFG 是 `guidance_scale`，步数是 `num_inference_steps`。
- 克隆时 `voice_ref` 是参考录音转成的 WAV，`reference_text` 是它的原文（IndexTTS 不读原文，不给）；Qwen3-TTS 没有原文时加 `x_vector_only_mode: true`（只取音色）。内置音色（随应用分发的参考录音）在提交时已换成克隆加录音文件。`seed` 给了才传。

**读音标注**。正文里的读音标注写成 `<字|读音>`：表面含汉字，读音是拼音，多字按空格分音节，音节数等于表面字数（`<银行|yin2 hang2>`）。每个音节写声调数字（`hang2`，轻声 `5`，ü 写 `v` 或 `ü`）或带调拼音（`háng`、`lǜ`；不标调是轻声，`<了|le>`），同一个注记里可以混用（`<银行|yín hang2>`），不分大小写；Runtime 解析时（`speech-readings.ts`）一律规范成小写的声调数字写法（j / q / x / y 后的 ü 写 `u`）。音节去调后须是 1–6 个字母、含元音（成音节的 `m n ng hm hng` 除外）；只认预组合的带调字母，调号与数字并存、一个音节两个调号都不合法。读音带数字或调号却不合法的是畸形注记，原样留作文字；既不带数字也不带调号又不合法的（`<中文|Chinese>`）不算注记。认读音标注的模型（IndexTTS 2.5）收到规范写法的注记，畸形注记按字面留在文字里；别的模型按表面文字合成，畸形注记只留表面的字。念不了的（模型不认、注记畸形）逐条记成任务的 `reading-dropped` 警告（`detail` 只说位置与读音，偏移按去注记后文字的 Unicode 码点算），不静默丢弃，也不让任务失败。

参考录音在执行前按提交时的摘要再核对一次，变了或读不出来时失败（内置音色的录音读不出来是安装不完整，`APP_FILE_MISSING`；请求给出的文件是 `ASSET_MISSING`），不换声音。核对过的录音经 ffmpeg 转成 staging 里的单声道 16 位 WAV（`reference.wav`，保留采样率，解封装器白名单与识别相同），引擎只读 WAV；这台机器上没有能用的 ffmpeg（找不到、不能执行）时任务失败，错误码 `MEDIA_TOOL_UNAVAILABLE`、带按平台给的安装修法：那是外部工具的问题，不是录音读不出来，也不说成安装不完整；模型对带原文的参考有时长上限时（Fish S2 Pro 30 秒）在这里检查，超出是 `rejected`（`details.reason: 'reference-duration'`，带 `seconds` 与 `range`）。

**进度与取消**。引擎不报告进度：请求发出后进入 `generating`，只有不定进度，完成时报 1/1。服务不能中途停下一次合成，取消就结束这个服务进程（整个进程组，宽限期 5 秒后强杀），下次再起。

**结果**。服务回 200 且是能解析的 WAV 才算成功：整段峰值高于 −1 dBFS 时等比缩到 −1 dBFS（§5.1），写成 staging 里的 `speech.wav`，删掉 `reference.wav`；`workerVersion` 记为 `audiocpp_server@<版本>`。失败：服务起不来、启动中退出或 5 分钟内没就绪是 `load-failed`（`MODEL_LOAD_FAILED`，附输出的尾巴）；合成中进程退出是 `crashed`（`MODEL_WORKER_CRASHED`）；服务回 HTTP 错误是 `rejected`（`PROVIDER_REJECTED`，带引擎给的原因）；回的不是 WAV 是 `protocol`（`MODEL_OUTPUT_INVALID`）。

**资源**。服务从启动起持有这个模型包在资源调度里的 holder（与 Model Worker 的同名，量只计一次），进程真的退出后才归还；Apple Silicon 计 GPU 内存、别的平台计内存（与音乐相同）。量是模型包登记的 `residentBytes`，没登记时按 GGUF 的存储字节乘 1.5：2026-10-15 在 Apple M4 的 Metal 上实测 OmniVoice Q8，GGUF 1.35 GB，服务就绪后进程常驻约 2.02 GB，合成一句 6 秒的话不再上涨（别的模型族未实测）；架构设计 §7.7。

**耗时提示**。本地 Provider 描述合成模型时问 `LocalSpeechProvider.backend()` 服务会用的后端（给了 `BAOCUT_AUDIOCPP_BACKEND` 就是它，否则与起服务时同一个、按路径缓存的 `--version` 结果；找不到引擎时不知道，null）。是 `cpu` 时每个合成模型的描述带 `notes`（与文生图同一个字段，按生成时的语言存文本）：在本机的 CPU 上合成、比用显卡慢得多，后面接这个模型包在 CPU 上的实测速度，没有实测的只说还没有实测，不按参数量推算。别的后端与不知道时不带。实测（2026-10-15，Apple M4，10 核、16 GB，服务 8 线程）：OmniVoice Q8 的耗时在 Metal 上约为音频长度的 1.35 倍，强制 `cpu` 时 8.8–9.2 倍（测时 load average 4.9–12；更忙时 10.8–14 倍），进程常驻 1.3–1.7 GB；别的模型族在 CPU 上未实测。架构设计 §6.5。

#### 添加的模型

用户从引擎的模型列表或自己指定的 GGUF 添加的模型包（架构设计 §6.3「添加 audio.cpp 模型」）走同一个引擎、同一套服务与命令行，差别只在登记：

- **来源**。组件的来源族是 `audio-cpp-gguf`：从列表或 Hugging Face 添加的，下载与核对照 §4.2，清单是添加时从上游读出的文件、大小与 sha256；本机文件原地引用：组件的仓库名是 `audio-cpp-added/<模型包 ID 中 @ 之前的部分>`（只作标识，模型目录里没有这个目录），`origin: 'local-file'`，`file` 是那个绝对路径，引擎直接读它；不下载、不修复，文件不在或大小变了时组件是 `missing`，要重新添加。
- **哪一份特性**。上游一个模型族常常包含几个变体（如 `qwen3_tts` 包含 Base、CustomVoice 与 VoiceDesign，规格里的说话人只属于 CustomVoice），所以按「哪个内置模型包」认，不按族认：列表里的包与某个内置包同一个上游仓库（`root`）时沿用那个内置包的特性，只换模型文件；Hugging Face 的文件按所在目录或仓库名（`…-GGUF`）认；本机文件读 GGUF 文件头，`general.name` 加 `-GGUF` 对上内置包的仓库时沿用它，Qwen3-TTS 再按文件里打包的 `config.json` 的 `tts_model_type`（`base`、`custom_voice`、`voice_design`）认变体，认出的变体记在添加记录里（`variant`）。文件比那个内置包大一半以上时标为慢。认不出的才用下面的通用特性。
- **合成**。认不出变体的按上游规格配一份通用的特性（`packages/models/src/audio-cpp-catalog.ts` 的 `genericSpeechProfile`）：声音方式、说话人、语言、语速按规格写的取；规格只有「auto」「50+ languages」之类说法时语言不限，不发 `language`。请求只发规格列出的参数（`engine.options`），其余（含 `reference_text`）在发出前去掉，引擎遇到不认得的参数会报错；风格说明按引擎的写法交给 `instruct` 或接在正文前（`instructionsAs: 'prefix'`）。采样率以引擎输出的 WAV 头为准。
- **音乐**。只有 `yue2` 族别的精度：请求同内置的 YuE2，主模型与 VAE 换成这个包的文件，峰值按主模型大小的差换算。
- **检查与资源**同内置的合成、音乐模型包（§4.3 与上面两节）。

### 4.5 文本嵌入模型包与 LiteRT-LM

本机语义检索（EmbeddingGemma 2 检索集成方案 v0.1）的模型包是 `embed` 能力、`litert-lm` backend，登记在 `@baocut/models` 的 `embedding-bundles.ts`。登记的设备 `cpu` 是向量的数值类别（FP32），进 `encoderProfileId`；实际设备按 §2.1 交 Worker 的首选设备（macOS 上 `metal`），见下文「加载」：

| 模型包 | `embedding` 组件 | 模型文件 |
| --- | --- | --- |
| `embeddinggemma2-text@litert-lm`（文字搜索） | `litert-community/embeddinggemma-2-text-270m-litert-lm` | `embeddinggemma-2-text-270m.litertlm`，约 157 MiB |
| `embeddinggemma2-multimodal@litert-lm`（多模态搜索；图像编码器在加载时带 `vision` 才打开） | `litert-community/embeddinggemma-2-740m-litert-lm` | `embeddinggemma-2-740m.litertlm`，约 462 MiB |

两个包的文字编码器在 LiteRT-LM 0.18.0 的 CPU 上出的向量逐位相同（实测），所以属于同一个嵌入空间（变体 `text-270m`、同一个量化兼容组）；文字的 `encoderProfileId` 共用文字包模型文件的 sha256（`textEncoderSha256`，换包不重算），画面的随多模态包的模型文件；都不带 LiteRT-LM 的版本号，也不随实际设备变：升级 C 库后由参考向量回归（检索规格 §5.3）判断旧向量还能不能比较。许可都是 Apache-2.0。

**C 库**。LiteRT-LM 的 C API 不随应用分发，是两个模型包共用的发布页组件 `litertlm-runtime`（`google-ai-edge/LiteRT-LM` 的 v0.18.0 Releases，许可 Apache-2.0），随模型包下载：按主机平台取登记的压缩包（地址遵循工具下载来源，`tools.downloadEndpoint` / `BAOCUT_TOOLS_ENDPOINT` 给了时是 `<基址>/litertlm-runtime/<版本>/<文件名>`，否则登记的官方发布地址；大小取登记值，不发 HEAD），核对大小与 sha256，暂存在 `<runtime-home>/tools/.bcut-staging/litertlm-runtime@<版本>/`（取消保留已下的部分），解开后在组件目录写一份 `.bcut-manifest.json`，检查、校验与修复以它为准，没有清单不算装好；几个模型包共用一份，最后一个使用它的模型包被删除时删掉组件目录。它是交给 Worker 的动态库（`workerLibrary`），不是 Runtime 执行的程序：不执行、不认 `PATH`；装好后它和权重一样作为 `components['litertlm-runtime']` 交给 Worker（文件列表取组件目录的清单）。上游只为 macOS 发布了 C 库：`CLiteRTLM_mac.xcframework.zip` 里 `CLiteRTLM_mac.xcframework/macos-arm64_x86_64/` 下的通用 `libCLiteRTLM_mac.dylib`（arm64 + x86_64），解开到 `<runtime-home>/tools/litertlm-runtime/0.18.0/`，同目录的 `Headers/` 不解开。Windows 与 Linux 没有库包，两个模型包在那里是 `error` / `unsupported`，说明点名 LiteRT-LM 没有这个平台的版本。

**加载**。Worker 在 `model.load` 时 `dlopen` `litertlm-runtime` 里唯一的动态库（同一路径在进程里只打开一次），找不到符号或打不开是 `MODEL_UNSUPPORTED`（`details: { component: 'litertlm-runtime', reason: 'symbol-missing' | 'library-load-failed' }`），`files` 里没有 `.litertlm` 或动态库是 `MODEL_NOT_INSTALLED`。引擎设置：线程数取 `threads`（1–64），缓存目录取 `cacheDir`（Runtime 给 `<runtime-home>/cache/litertlm/`，属于可回收的缓存；没给时用系统临时目录），单条输入上限 2048 token；`ModelBundle.vision`（`{ tokensPerImage?: number }`，1–4096，缺省用模型的默认值 140）存在时图像编码器的后端设为 `cpu`，否则与音频后端一样不设（只加载文字编码器）。设备：`device` 是 `metal`、C 库有 `litert_lm_embedding_engine_settings_set_activation_data_type` 时主干（文字编码器）用 C API 的 `gpu` 后端，激活显式设为 FP32（GPU 默认激活约等于 FP16，向量与 CPU 不在同一空间；FP32 激活与 CPU 逐条余弦 ≥ 0.998、查询第一名全部一致，[GPU 复核](../../tools/embedding-eval/reports/g0-gpu-2026-10-14.md)）；GPU 上的设置、创建或预热（第一次计算编译 GPU 程序）任何一步失败，Worker 在 stderr 说明一次后在 CPU 上重建，不报错、不停用模型包。带 `vision` 时主干照样在 GPU、图像编码器在 CPU：图像 token 经主干出向量，FP32 激活下帧向量与纯 CPU 引擎的逐张余弦 ≥ 0.9996（参考帧 0.99987），与文字一样属于同一数值类别（[GPU 复核 §7](../../tools/embedding-eval/reports/g0-gpu-2026-10-14.md#7-画面主干在-gpu图像编码器在-cpu复测)）。图像编码器不放 GPU：整张图在 GPU 上帧向量最低 0.990，不在同一空间。`embed.run` 的 `device` 报主干实际用的设备，文字与图片相同。CPU 上引擎报资源不足（C API 状态 8）是 `MODEL_RESOURCE`，别的创建失败是 `MODEL_UNSUPPORTED`。模型不出 768 维时是 `MODEL_UNSUPPORTED`（`reason: 'unexpected-output-size'`）。错误信息里的本机路径都抹掉。

**向量**。Runtime 向 Worker 要 768 维（`outputSize: 768`、`insertSpecialTokens: true`），自己截到 512 维再做 L2 归一化，FP32；任务前缀（模型卡的 `task: search result | query: ` 与 `title: none | text: `）只由 Runtime 加一次，Worker 原样嵌入。一次至多 16 条，更多的按 16 条分批。

**资源**。加载后常驻一个 Worker（与识别相同，资源 holder 计内存）：模型文件 + C 库压缩包 + 256 MiB 余量。2026-10-12 在 Apple M 系列的 CPU 上实测：空闲约 15 MB；文字包加载后约 365 MB、16 条约 500 字的批次峰值约 475 MB；多模态包加载后约 760 MB。打开图像编码器另加约 1 GB，主干在 GPU 时常驻峰值再多约 230 MB；一张关键帧在 CPU 上约 1.1 秒（2026-10-13，Apple M2；2026-10-14 在 Apple M4 上 CPU 约 0.5 秒、主干在 GPU 约 0.47 秒），向量与 G0 评测的 Python 绑定对同一张图给出的一致（余弦 1.000000，`crates/model-worker/tests/embedding.rs`）。

**检查**（`models.test`）。一条查询、一条相关文档、一条无关文档（英文查询、中文文档，覆盖跨语言；句子在 `packages/models/src/embedding-self-test.ts`）按上面的前缀走一遍 `model.load` → `embed.run`，截到 512 维后判定：

- 三条，都是 512 维，值都有限；
- 都是单位长度：|‖v‖ − 1| ≤ 0.001；
- 相关文档比无关文档更像查询：余弦至少高 0.05（两个包实测 0.8237 对 0.6329）。

检查不判断检索质量好不好，只证明整条嵌入链路能出有意义的向量。通过时记下维度、两个余弦与设备，事实作为 JSON 产物留存；不通过记下原因（`MODEL_OUTPUT_WRONG`）。

## 5. 任务与 staging 目录

- Runtime 为每个任务创建 `<runtime-home>/staging/jobs/<jobId>/` 并传入 `staging`。Worker 的所有中间文件与输出都写在这里，文件名固定：识别是 `audio.f32`（可选，解码缓存）、`segments.jsonl`、`result.json`；生图是 `image.png`；本地语音合成与音乐不经 Worker，它们的 `speech.wav` 与 `music.wav` 由 Runtime 与 audio.cpp 引擎写进同样的 staging（§4.4、§5.1）；分离是 `vocals.wav` 与 `background.wav`（§2.5.4）；说话人区分是 `speakers.json`（§2.5.5）。
- `segments.jsonl` 是 append-only，每行一个 `Segment`（§6），按 `start` 递增写入；每行写完后 flush。首行是头：`{ "header": true, "jobId", "contentHash", "bundleId", "workerVersion", "timescale" }`。每次尝试都从头写这个文件；续跑靠下面的检查点，检查点里做完的段照样按顺序重新写出、推送，不读上一次尝试的文件。
- 转写检查点不在任务目录里：Runtime 按输入 hash 给本机转写任务一个文件（`<runtime-home>/staging/checkpoints/<输入 hash 的十六进制>.jsonl`），经 `checkpoint` 传入（§2.5.1），跨尝试、跨任务与 Runtime 重启都是同一个。它是 append-only 的 JSONL，每行写完 `fsync`。Worker 用它的整个期间持有这个文件的独占锁（`flock` / `LockFileEx`），同一时间只有一个 Worker 读写它：同一份输入同时在两个模型包上识别、Runtime 被杀之后旧的 Worker 还没退出时，拿不到锁的那个不用检查点，两边的工作不会交错写进一个文件。首行是头 `{ "type": "header", "schema": "baocut.transcribe-checkpoint/1", "key", "workerVersion", "bundleId", "contentHash" }`。之后的记录按跑法分两套，一份文件只有一套（键里有模型包，一个模型包总是同一种跑法）。自分段识别依次是：`chunk`，MOSS 收下的一个初始分块（`index` 从 0 连续；连同为它重切的子块，带这一块的行、说话人区间、渲染的文本、提示与分块循环的状态）；`transcribed`，识别完成（全部的行、说话人区间与提示），之后不再读 `chunk`；`speakers`，要说话人且有区间时，跨块合并之后的行、区间与合并的结局（`outcome`）；`aligned`，一行一条（`row` 是识别或合并之后的行号，不重复；`words` 是对齐器给的词，相对行起点的秒，null 表示对齐器没给出词；对齐器报错的行不记，续跑时再试）。流水线模型是：`vad`，VAD 切出的语音区间（`spans`，`start` / `end` 相对解码起点的秒，补边之前），只有一条，在其余流水线记录之前；`recognized`，一段的识别结果（`span` 是区间的下标，严格递增；`text` 是识别器原样给出的文本，连同 `languageName` 与 `degenerate`；样本窗为空的段不识别，没有记录；空文本也记）；`span-aligned`，对齐器给一个已识别段的词（`span`；`words` 相对补过边的识别区间起点的秒，空数组表示对齐器没给出词），每段至多一条，对齐器报错的段不记、续跑时再试，所以它可以在之后的段甚至 `diarized` 之后；`diarized`，说话人区分给出的区间（`ranges`，每个 `start`、`end`、`speaker`），只有一条，出错、加载不了或被取消时不记。秒数写成十进制、读回逐位相同（f32 存成 f64）。格式版本没有因为流水线的记录而换：两套记录类型不相交，加上它们之前的 Worker 构建与之后的不同，键不符，读不到对方的文件。
- `key` 是这些的 sha256：检查点的格式版本；Worker 版本与可执行文件的大小、修改时间（VAD 的阈值与补边、说话人区分的聚类阈值这些编进代码的常量随之覆盖）；模型包 ID、后端、设备、线程数与 `asr`、`vad`、`aligner`、`speaker`、`segmentation` 的 family 与 revision；`contentHash`、`track`、`range`，以及解码出来的样本数与样本（小端 f32）的 sha256；能力、`language`、`diarize`、`hint`、`timescale`；影响结果的环境旋钮：是否关了 GPU（`BAOCUT_GPU`）、candle 的计算精度（`BAOCUT_CANDLE_DTYPE`）、MOSS 的量化位数（`BCUT_MOSS_QUANT` / `BAOCUT_MOSS_QUANT`）、分块时长（`BCUT_MOSS_CHUNK_SECONDS`）与跨块说话人合并的阈值。`jobId` 与 `runGeneration` 不在内。头不符或认不出就整份重写成只有新头的文件，从头跑；读到撕裂的末行、乱序、重复、阶段跳跃或另一种跑法的记录就停在那里，截掉之后的部分；`chunk` 的起点与样本数与这一次的分块计划逐块对不上时不用它们，从头识别。Worker 不删除检查点：Runtime 在结果收下或不合合同时删除，失败与取消的留给下一次重试，7 天没用上的在启动时删除。
- `result.json` 在任务完成时一次性写入临时文件再重命名，内容为 §6 的对象。`job.run` 的 `output.sha256` 是该文件 bytes 的摘要。
- Worker 不删除 staging 目录；清理属于 Runtime。

### 5.1 生成任务的输出

`synthesizeSpeech`、`generateImage` 与 `generateMusic` 的执行者（在线 Provider、本地 Worker、本地的 audio.cpp 引擎，以及之后的节点）遵守同一份输出约定，Runtime 按它校验后发布（架构设计 §6.4）：

- 输入是提交时冻结的参数（`JobRecord.generation`），执行者不改参数、不换模型或音色；做不到就失败。
- 每个输出写成 staging 里的 `output-<n>.<扩展名>`（`n` 从 1 开始；扩展名 `mp3`、`wav`、`flac`、`png`、`jpg`、`webp`），完成时报告相对路径、sha256（小写十六进制）、长度与媒体类型（`audio/mpeg`、`audio/wav`、`audio/flac`、`image/png`、`image/jpeg`、`image/webp`）。
- 本地语音合成（§4.4）的输出合同是 `baocut.speech-wav/v1`：一个 PCM WAV（16/24/32 位整数或 32 位浮点，单声道或立体声，采样率是模型的原生采样率），文件名固定为 `speech.wav`。整段的峰值高于 −1 dBFS（满幅为 1 时约 0.891）时，本地 Provider 在写出前把整段等比缩小到 −1 dBFS（非有限的样本先置零）；不提升安静的输出，也不做压缩。服务回的不是能解析的 WAV 时按协议错误处理。
- 本地 Worker 的生图（§2.5.3）输出合同是 `baocut.image-png/v1`：一张 8 位 RGBA PNG，宽高就是请求的宽高，文件名固定为 `image.png`，先写临时文件再重命名。第四个通道是模型（Qwen-Image 的 VAE）自己给的 alpha，原样写入。本地 Provider 同样换成相对路径，不是 `image.png` 时按协议错误处理。
- 本地音乐生成（§4.4）的输出合同是 `baocut.music-wav/v1`：一个 PCM WAV（16/24/32 位整数或 32 位浮点，单声道或立体声，采样率是模型的采样率，YuE2 为 44.1 kHz），文件名固定为 `music.wav`，由引擎直接写出（没有合成那样的 −1 dBFS 限幅）；媒体类型 `audio/wav`。本地 Provider 报告相对 staging 的路径，退出了却没有 WAV 按协议错误处理。
- 输出个数等于请求的张数（语音与音乐为 1），媒体类型等于请求的格式。
- Runtime 核对长度与摘要、文件头与声明的类型，再用 ffprobe 以该格式的解复用器完整解码：音频要有正的时长、采样率与声道数，图片要有正的宽高。不过的映射为 `MODEL_OUTPUT_INVALID`（命令与协议规范 §11.3），原始文件移到 `logs/diagnostics/<jobId>/`。

## 6. 输出合同 `baocut.asr-result/v1`

所有时间是整数 tick，`clock` 固定为 `source-asset`：tick 0 对应素材的时间 0，即使 `input.range` 只处理了一段。

```ts
interface AsrResult {
  schema: 'baocut.asr-result/v1';
  outcome: 'transcribed' | 'no-audio-track' | 'no-speech';
  timescale: number;
  clock: 'source-asset';
  duration: number;                   // 素材时钟上已处理区域的终点，tick；没有 range 时即素材时长，没有音轨时为 0
  language: { tag: string | null; source: 'asserted' | 'detected' | 'unknown'; confidence: number | null };
  segments: Segment[];
  speakers: Array<{ id: string; label: string | null }>;
  coverage: Array<{ start: number; end: number }>;      // 实际处理过的范围，tick
  warnings: Warning[];
  provenance: Provenance;
}

interface Segment {
  id: string;                         // 'seg-0001'，任务内唯一且递增
  start: number; end: number;         // tick
  text: string;
  speakerId: string | null;
  words: Word[];
}

interface Word {
  start: number; end: number;         // tick
  text: string;
  confidence: number | null;
  timingQuality: 'aligned' | 'provider' | 'estimated' | 'missing';
  speakerId?: string;                 // 说话人区分投影到这个词的说话人（§2.5.1）；没有区分时没有这一项
}

interface Warning {
  code:
    | 'alignment-failed' | 'timing-adjusted' | 'backend-degraded' | 'diarization-unavailable' | 'segment-degenerate' | 'range-clamped'
    | 'hint-ignored'                    // 模型没有提示通道，`hint` 没有交给模型（§2.5.1）；Runtime 对不接受提示的模型不送 `hint`，提交时自己记这个警告
    | 'segment-incomplete';             // 模型有一块没写完整，已保留识别出的部分，之后可能缺字
  segmentId?: string;
  detail?: string;
}

interface Provenance {
  provider: 'local' | string;         // 云端 Provider 填其 id
  bundleId: string | null;
  models: { asr?: ModelRef; vad?: ModelRef; aligner?: ModelRef; speaker?: ModelRef; segmentation?: ModelRef };
  backend: string; device: string;
  workerVersion: string;
  inputHash: string;                  // 等于 `input.contentHash`；JobSpec 的输入 hash 由 Runtime 记在应用结果里
  runGeneration: number;
  cost?: { status: 'reported' | 'unknown'; usage?: unknown };  // 只有在线 Provider 给出，本地 Worker 不写
}
interface ModelRef { family: string; revision: string }
```

校验规则（Runtime 在发布前执行，Worker 在写出前自检；自检不过时不写 `result.json`，`job.run` 返回 `OUTPUT_INVALID`，`details.problems` 是问题清单）：

- `segments` 按 `start` 递增且不重叠；每段 `0 ≤ start < end ≤ duration`；段内 `words` 单调且在段内；`word.text` 与 `segment.text` 非空（空白只允许在 `outcome !== 'transcribed'` 时整体为空）。
- `timingQuality` 为 `aligned` 的词，`provenance.models.aligner` 或 ASR 自身的词级时间能力必须存在；云端 Provider 没有对齐器时只能是 `provider`、`estimated` 或 `missing`。
- `missing` 的词 `start === end`，取所在段的 `start`。
- `language.tag` 是合法的 BCP 47；`source: 'asserted'` 时必须等于请求的断言。
- `outcome !== 'transcribed'` 时 `segments` 为空，`coverage` 仍然填实际检查过的范围。
- 段的 `speakerId` 非空时、词有 `speakerId` 时，都必须出现在 `speakers[]`。
- `provenance.cost`（架构设计 §6.4）：在线 Provider 每一次请求都报告了用量时为 `reported`，`usage` 是供应商原样报告的用量对象（切片提交时按块组成数组）；有任何一块没有报告就是 `unknown`，不拿部分用量充数，也不换算成金额。在线结果的 `bundleId` 为 null，`backend: 'online'`、`device: 'remote'`，`models.asr` 为 `{ family: providerId, revision: modelId }`。

## 7. 错误

```ts
interface ErrorBody {
  code: string;
  message: string;                    // 不含本机绝对路径
  retryable: boolean;
  details?: object;
}
```

| code | 含义 | retryable |
| --- | --- | --- |
| `CONTRACT_MISMATCH` | `contractVersion` 不匹配 | false |
| `INVALID_PARAMS` / `UNKNOWN_METHOD` | 协议错误 | false |
| `ALREADY_LOADED` / `WORKER_BUSY` / `NOT_FOUND` | 状态错误 | false |
| `MODEL_NOT_INSTALLED` / `MODEL_UNSUPPORTED` / `MODEL_RESOURCE` | 加载失败，见 §2.2 | false |
| `INPUT_UNREADABLE` | 输入文件（识别与分离的素材）不存在、不可解封装或解封装器不在白名单 | false |
| `INPUT_TOO_LONG` | `embed.run` 的某条文本超过模型的输入上限（`details.index`，§2.5.6）；不算崩溃、不停用模型包 | false |
| `OUTPUT_INVALID` | 组装好的结果没过写出前的自检（§6 的校验规则，`details.problems`）；同一输入再跑结果相同，不算崩溃、不停用模型包 | false |
| `DECODE_FAILED` | 解码中途失败 | true |
| `INFERENCE_FAILED` | 模型前向失败（非崩溃） | true |
| `WORKER_PANIC` | Rust panic | true |
| `OUTPUT_WRITE_FAILED` | 输出写不进 staging（磁盘满、目录不可写；`details.file`） | true |

Runtime 把这些映射到命令与协议规范 §11.3 的 `MODEL_LOAD_FAILED` / `MODEL_WORKER_CRASHED` / `MODEL_OUTPUT_INVALID`；`OUTPUT_WRITE_FAILED` 是 `STAGING_WRITE_FAILED`，不算崩溃、不停用模型包（`DECODE_FAILED`、`INFERENCE_FAILED`、`WORKER_PANIC` 算）；`OUTPUT_INVALID` 与 Runtime 校验不过一样是 `MODEL_OUTPUT_INVALID`（`details.problems`），不重试、不算崩溃、不停用模型包；`job.run` 返回的 `MODEL_UNSUPPORTED` 也是 `MODEL_LOAD_FAILED`（`details.reason: 'unsupported'`，Worker 的 `details` 原样放在 `details.workerDetails`），不停用模型包。

## 8. 待评审事项

| 事项 | 需要决定什么 | 当前文档的假设 |
| --- | --- | --- |
| 解码放在哪一侧 | Worker 自己解码（本文）还是 Runtime 用 ffmpeg 解码后传 PCM | Worker 解码：ffmpeg 管道为主，PCM WAV 走纯 Rust 路径；demuxer 白名单与 Runtime 的媒体分析一致 |
| `threads` 与调度优先级 | MLX 后端不使用 CPU 线程上限；推理线程的优先级如何设置 | `threads` 目前被忽略；推理线程在 macOS 上以 utility QoS 运行，其他平台不调整 |
| `align` 的文本输入形状 | 纯文本还是带句子边界的结构 | 纯文本，Worker 自己分词 |
| 说话人嵌入是否进结果 | `speakers[].embedding` 是否输出供跨任务合并 | 不输出 |
| 合成的单次文本上限 | 本地合成一次任务接受多少字符（引擎内部按句切分） | 2000 个码点，超过时在提交时拒绝、不截断；待各引擎接上后按实测的内存与时长校准 |
| 内置清单的哈希与大小 | Qwen3-ASR 0.6B 与 Silero VAD 两个仓库的 sha256 由谁、在哪里重新核对；大小是否写进清单 | sha256 沿用旧版 BaoCut 固定的值，未在本仓库重新核对（架构设计 §14）；大小在计划时经 HEAD 取得。后来登记的识别仓库（Qwen3-ASR 1.7B、对齐器、说话人模型、Whisper、MOSS）的大小与 sha256 已和本机装好的同一版本逐个核对 |
| Whisper 与 MOSS 的接入 | Core ML 后端与两个模型族的加载器何时接上；说话人与词时间怎么来 | 契约与组件形状已定（§2.1、§4.1）。Whisper 已接入：`coreml` 后端、`transcribeFamilies` 含 `whisper-coreml`，登记了 large-v3 与 large-v3-turbo 两个模型包；MLX 的 Whisper（`whisper-mlx`）也已接入，登记了 `whisper-large-v3@mlx` 与 `whisper-large-v3-turbo@mlx`，Runtime 暂不列出（替换 Core ML 与否待定，见架构设计 §6.5）；词时间由可选的对齐器给出（与 Qwen3-ASR 共用，对齐器在 MLX 上跑），没装时按字长估计。MOSS 已接入：带 MLX 的构建在 `transcribeFamilies` 里列出它，登记了 `moss-transcribe-diarize@mlx-8bit`（8 bit 量化），可选的对齐器只对齐长于 5 秒的行，可选的说话人模型合并跨块的说话人（§2.5.1）。Qwen3-ASR 与 Whisper 由「说话人区分」模型包（Pyannote 分段 + WeSpeaker）区分说话人（§2.5.1）；非 macOS 上 Qwen3-ASR 与 MOSS 走 candle，Whisper 走 `ggml`（whisper.cpp，CPU、CUDA 或 Vulkan；架构设计 §6.5），登记了 `whisper-large-v3@ggml` 与 `whisper-large-v3-turbo@ggml`，同样带可选的对齐器（在 candle 的 CPU 上跑）；Metal 已在 Intel Mac 的 Radeon Pro 5500M 上用 Whisper large-v3 Turbo q8_0 跑通中英文样本；CUDA 与 Vulkan 尚未实测 |
