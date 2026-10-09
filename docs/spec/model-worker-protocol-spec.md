# BaoCut Model Worker 协议规范

> Runtime 与本地推理进程（Model Worker）之间的 stdio 协议，语音识别的输出合同 `baocut.asr-result/v1` 、本地语音合成的输出合同 `baocut.speech-wav/v1` 与人声分离的输出合同 `baocut.stems-wav/v1`。本规范定义消息的形状与语义；进程的粒度、启动、恢复与清理规则见[系统架构设计](../architecture/architecture-design.md) §6.5–§6.6。

合同版本：`workerContractVersion: 1`。

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
params: { contractVersion: 1 }
result: {
  workerVersion: string;            // crate 版本
  contractVersion: 1;
  pid: number;
  backends: Array<{ id: 'mlx' | 'coreml' | 'candle' | 'ggml'; available: boolean; reason?: string; devices: string[] }>;
  capabilities: Array<'transcribe' | 'align' | 'synthesize' | 'separate' | 'image' | 'diarize'>;
  transcribeFamilies: string[];     // 能加载的识别模型 family（§4.1 `asr` 组件的 family）；没有时为 []
  synthesizeFamilies: string[];     // 能加载的合成主模型 family（§4.1 `tts` 组件的 family）；没有时为 []
  separateFamilies: string[];       // 能加载的分离模型 family（§4.1 `separator` 组件的 family）；没有时为 []
  imageFamilies: string[];          // 能加载的文生图模型 family（§4.1 `image` 组件的 family）；没有时为 []
}
```

`contractVersion` 不匹配时 Worker 返回 `CONTRACT_MISMATCH`，Runtime 关闭它。`available: false` 的后端带 `reason`（如 `no-metal-device`、`not-compiled`）。

`devices` 是这个后端此刻能用的设备，首选的在前：`mlx` 为 `['metal']`，`coreml` 为 `['ane']`，`candle` 为 `['cuda', 'cpu']`（编进了 `cuda` 且 CUDA 初始化成功）或 `['cpu']`，`ggml`（whisper.cpp）为 `[<GPU>, 'cpu']` 或 `['cpu']`：`<GPU>` 是 ggml 枚举到的第一个 GPU 设备所属后端，CUDA 为 `'cuda'`（编进了 `whisper-ggml-cuda` 且找到了 NVIDIA GPU）、Vulkan 为 `'vulkan'`（编进了 `whisper-ggml-vulkan` 且找到了 Vulkan GPU），两个都编进来时 CUDA 先于 Vulkan（ggml 的登记顺序），所以至多一个 GPU。设备名只取 `metal`、`ane`、`cuda`、`vulkan` 与 `cpu`（BaoCut 的构建只编 ggml 的 CUDA 与 Vulkan 两种 GPU 后端；别的 ggml GPU 后端会报它小写的注册名，不在本合同内）。环境变量 `BAOCUT_GPU` 设为 `off`、`0`、`false`、`cpu` 或 `no`（不分大小写）时 Worker 不初始化 GPU，`candle` 与 `ggml` 只报 `cpu`；CUDA 或 Vulkan 初始化失败时同样只报 `cpu`，并在 stderr 说明一次。没编进的后端（例如没开 `whisper-ggml` 的构建里的 `ggml`）报 `available: false`、`reason: 'not-compiled'`。Runtime 交给 `model.load` 的 `candle` 与 `ggml` 模型包用这里的首选设备；candle 的合成引擎把张量固定在进程的首选设备上，所以合成模型包的 `device` 不是首选设备时（例如有 CUDA 却交来 `cpu`）`model.load` 返回 `MODEL_UNSUPPORTED`（`details: { backend: 'candle', device, reason: 'unsupported-device' }`）；后端 `available: false` 时不发 `model.load`，任务以 `MODEL_LOAD_FAILED`（`details.reason: 'unsupported'`、`detail: 'backend-unavailable'`）失败，模型包不停用。

`capabilities` 只列出这个 Worker 真正能执行的能力。识别同样按模型族声明：`transcribeFamilies` 列出这个构建能加载的 `asr` family（带 MLX 或 candle 的构建是 `qwen3-asr` 与 `moss-transcribe-diarize`，带 MLX 的 Apple Silicon 构建加上 `whisper-mlx`，带 Core ML 的构建加上 `whisper-coreml`，带 `whisper-ggml` 的构建加上 `whisper-ggml`），至少有一个时 `capabilities` 才含 `transcribe`。构建能加载强制对齐器（`qwen3-forced-aligner`，带 MLX 或 candle 的构建）时 `capabilities` 含 `align`；真正执行还要求加载的模型包带了 `aligner` 组件（§2.5.1）。构建接上了说话人区分（Pyannote 分段 + WeSpeaker 声纹，带 MLX 或 candle 的构建；MLX 与 Core ML 的 Whisper 用 MLX 的，GGML 的 Whisper 借 candle 的）时 `capabilities` 含 `diarize`：识别时要说话人还要求识别的模型包带了 `segmentation` 组件（§2.5.1）；单独加载「说话人区分」模型包时它也是一个 `job.run` 能力，给已有转写的词区分说话人（§2.5.5）。识别模型包要求 `transcribe`，且它的 `asr` family 在 `transcribeFamilies` 里：不满足时 Runtime 不发 `model.load`，任务以 `MODEL_LOAD_FAILED`（`details.reason: 'unsupported'`、`detail: 'capability-missing'`，带 `family`、`capabilities` 与 `transcribeFamilies`）失败，模型包不停用。合成按模型族声明：`synthesizeFamilies` 列出这个构建能加载的 `tts` family（带 MLX 的 Apple Silicon 构建与带 candle 的构建都是 `qwen3-tts`、`indextts2`、`indextts2.5`、`gpt-sovits`、`voxcpm2`、`omnivoice`），至少有一个时 `capabilities` 才含 `synthesize`。Apple Silicon 上同时编进 MLX 与 candle 时合成走 MLX：`candle` 的合成模型包在 `model.load` 返回 `MODEL_UNSUPPORTED`（`details: { backend: 'candle', reason: 'engine-unavailable' }`），Runtime 在这个平台也不登记它们。带合成组件（§4.1 的 `tts`、`codec`、`aux`）的模型包要求 `synthesize`，且它的 `tts` family 在 `synthesizeFamilies` 里：不满足时 Runtime 不发 `model.load`，任务以 `MODEL_LOAD_FAILED`（`details.reason: 'unsupported'`、`detail: 'capability-missing'`，带 `family` 与 `synthesizeFamilies`）失败，模型包不停用——换一个声明了它的 Worker 就能用。文生图同理：`imageFamilies` 列出这个构建能加载的 `image` family（带 MLX 或 candle 的构建是 `qwen-image`），至少有一个时 `capabilities` 才含 `image`；带 `image` 组件的模型包要求 `image`，且它的 family 在 `imageFamilies` 里，不满足时同样以 `capability-missing`（带 `family` 与 `imageFamilies`）失败，模型包不停用。分离也一样：`separateFamilies` 列出这个构建能加载的 `separator` family（带 MLX 或 candle 的构建是 `htdemucs-ft`），至少有一个时 `capabilities` 才含 `separate`；带 `separator` 组件的模型包要求两者都满足，否则同样以 `MODEL_LOAD_FAILED`（`detail: 'capability-missing'`，带 `family`、`capabilities` 与 `separateFamilies`）失败，模型包不停用。

### 2.2 `model.load`

一个 Worker 进程只加载一个模型包（§4）。重复调用返回 `ALREADY_LOADED`。

```ts
params: { bundle: ModelBundle }
result: { loaded: true; residentBytes: number | null; warmupMs: number }
```

加载期间 Worker 推送 `model.phase` 事件。失败时的 `ErrorBody.code` 只取 `MODEL_NOT_INSTALLED`（文件缺失或 hash 不符）、`MODEL_UNSUPPORTED`（后端、设备或模型族不支持）、`MODEL_RESOURCE`（内存不足）三者之一，`details` 给出具体文件或资源。组件的组合不成立时（例如有 `codec` 却没有 `tts`）是 `MODEL_UNSUPPORTED`，`details: { component, reason: 'missing-component' }`。不在 `synthesizeFamilies` 里的合成模型族（这个构建没有它的引擎）在文件校验之后返回 `MODEL_UNSUPPORTED`，`details: { capability: 'synthesize', reason: 'not-wired', family }`，不留加载状态；识别同理，不在 `transcribeFamilies` 里的 `asr` family 在组件检查之后返回 `details: { capability: 'transcribe', reason: 'not-wired', family }`；不在 `imageFamilies` 里的 `image` family 同样返回 `details: { capability: 'image', reason: 'not-wired', family }`；分离是 `details: { capability: 'separate', reason: 'not-wired', family }`；Runtime 按 §2.1 不会发出这样的请求，这只是兜底。合成、分离与文生图的模型包加载后常驻在推理线程上，与识别相同。

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

Worker 一次只执行一个任务；`state !== 'ready'`（包括还没有加载模型包）时返回 `WORKER_BUSY`，`details.state` 给出当前状态。响应在任务终止时才返回。`params.capability` 决定参数与结果的形状：`transcribe` 与 `align` 见 §2.5.1，`synthesize` 见 §2.5.2，`image` 见 §2.5.3，`separate` 见 §2.5.4，`diarize` 见 §2.5.5。参数先按形状检查（`INVALID_PARAMS`），再检查状态。

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
  stats: { decodeMs: number; vadMs: number; asrMs: number; alignMs: number; speechSeconds: number };
}
```

`runGeneration` 原样回填到结果的 `provenance.runGeneration`，Worker 不做别的解释。`capability: 'align'` 在没有加载对齐器的模型包上返回 `MODEL_UNSUPPORTED`（`details.reason: 'aligner-not-loaded'`），语言不是断言或 `text` 为空是 `INVALID_PARAMS`；断言的语言不被模型支持时同样返回 `MODEL_UNSUPPORTED`（`details.reason: 'unsupported-language'`）。支持哪些语言按 `asr` 的 family 查各自的表（`qwen3-asr` 30 种、`whisper-mlx` 与 `whisper-coreml` 100 种、`moss-transcribe-diarize` 101 种），Runtime 的 `local` Provider 报告同一张表。

`hint` 超过 1200 字符是 `INVALID_PARAMS`；在这之内 Worker 不改写调用方的文字，交给模型的方式按 `asr` 的 family 不同（与 v2 相同）：`qwen3-asr` 整段放进系统上下文；`whisper-coreml` 按 BPE 编码后接在 `<|startofprev|>` 之后作前置提示，最多占解码器 KV 缓存的一半（减去任务前缀），超出时从前面截、留最靠近音频的那一截——large-v3 约 220 个 token，large-v3-turbo 约 108 个；`whisper-mlx` 同样作前置提示，预算按每个 30 秒窗「提示 + 生成」共 224 个 token 的一半算，两个模型都约 108 个；`whisper-ggml` 作 whisper.cpp 的 initial prompt（去掉内嵌的 NUL），每个语音段解码前都重新放入（同一段内的后续 30 秒窗把它与已解出的文字一起滚动作前文），超出文本上下文的一半（224 个 token）时由 whisper.cpp 留最靠近音频的那一截；`moss-transcribe-diarize` 不交给模型，报 `hint-ignored`。流水线自动识别语言（`prefer`）时，在第一段识别出文字的段上定下任务的语言（`job.language` 与结果的 `language`）：优先用模型自报的语言名，其次按累计的文本推断；识别结果为空的段不算，模型在这样的段上自报的语言不采信。只有断言的语言交给模型；定下的语言不强加给之后的段，每段都由模型自己判断，对齐器与词时间估计用模型在这一段上自报的语言，报不出时用任务的语言（架构设计 §6.6 第 4 步）。本地模型都不给语言的置信度，`job.language` 与结果里的 `confidence` 为 null。

识别有两种执行方式，由 `asr` 的 family 决定。**流水线**（`qwen3-asr`、`whisper-mlx`、`whisper-coreml`、`whisper-ggml`）：先用 VAD 切出语音段，再逐段识别。三种 Whisper 把 `hint` 作为前置提示交给解码器；它们只出句级文本。模型包带了对齐器（几个模型族共用同一只 `qwen3-forced-aligner`）时，每段识别出的文本在这段的音频上强制对齐，词时间标 `aligned`（provenance 的 `models.aligner` 点名它），词的起点展开为严格递增，起止塌成一点的词补到一个对齐格（0.08 秒，至多到下一个词的起点或段尾）；对齐出错或对不出词时这一段退回按字符长度估计（`estimated`），并带 `alignment-failed` 警告（`segmentId` 指向这一段），任务不失败。没有对齐器时词时间一律按字符长度估计。`diarize: true` 时，模型包带了 `segmentation` 组件（`pyannote-segmentation`，与 `speaker` 的 `wespeaker` 一起来自「说话人区分」模型包，架构设计 §6.3）就在识别与对齐完成之后进 `diarizing` 阶段（`job.progress` 的 `unit` 是 `steps`）：Pyannote 分段按 10 秒窗、5 秒步长在整段音频上判断每个窗里最多 3 个本地说话人，WeSpeaker 给每个本地说话人提取声纹，带约束的凝聚聚类（合并阈值 0.715）合成全局说话人，再把说话人区间投影到词上（架构设计 §6.6 第 7 步）。词的 `speakerId` 是投影到它的说话人，段的 `speakerId` 是段内词的说话时长最多的那个；说话人按时间上第一次出现记为 `spk-1`、`spk-2`……（`label` 为 null），没分到词的说话人排在后面。provenance 的 `models.segmentation` 与 `models.speaker` 点名两个模型。没有 `speaker` 时按窗的重叠串联本地说话人（退化的路径，区分得差）。两个模型在第一次要说话人时才加载、任务结束即卸下，识别模型留着（与 v2 相同）；耗时计入 `stats.asrMs`。模型包没有 `segmentation`、两个模型加载不了或推理出错时不区分，报 `diarization-unavailable`（`detail` 说明是哪种），转写照常完成。`job.segment` 与 `segmentsFile` 在区分之前写出：段的 `speakerId` 为 null，词不带 `speakerId`，说话人只在结果里。`diarize: false` 时不输出说话人。**自分段**（`moss-transcribe-diarize`）：整段音频一次交给模型，模型自己分块生成、切段并给出块内的说话人，没有 VAD 阶段，`stats.vadMs` 为 0；阶段依次是 `decoding`、`transcribing`，要说话人时 `diarizing`，有要对齐的行时 `aligning`，最后 `finalizing`。语言只在断言时交给模型；没断言时识别完按全文猜一次，猜出来就推送一次 `job.language` 并以 `detected` 作为结果的语言（`confidence` 为 null），猜不出是 `unknown`。模型没有提示通道，`hint` 非空时不交给模型并报 `hint-ignored`。某一块生成到上限或陷入重复、又切不开时保留已识别的部分，报 `segment-incomplete`（`detail` 说明是哪一块）。`diarize: true` 时，模型包带了说话人模型（`wespeaker`）就用各块说话人的声纹嵌入把块内标签合并成全局说话人（provenance 的 `models.speaker` 点名它）；没有说话人模型或行与说话人区间对不上、而模型分了不止一块时保留块内标签，报 `diarization-unavailable`（同名标签在不同块里可能不是同一个人）。说话人按出现顺序记为 `spk-1`、`spk-2`……（`label` 为 null）；`diarize: false` 时不输出说话人。模型包带了对齐器时，长于 5 秒且没有词时间的行在行的音频窗口内强制对齐（语言取断言的或按全文猜出的语言，都没有时按 `en`），词标 `aligned`；对不出时这一行退回估计并带 `alignment-failed`（`segmentId` 指向它），对齐器加载不了时报一条不带 `segmentId` 的 `alignment-failed`。provenance 的 `models.aligner` 只在这个任务真用到对齐器时填写。其余行的词时间按字符长度估计（`estimated`）。分段按时间排序、截到输入范围内、去掉重叠。对齐器与说话人模型用到时才加载、任务结束即卸下，两者不同时常驻；系统内存吃紧时先卸下 MOSS 再加载它们，下一个任务重新加载 MOSS。MOSS 没有预热，`model.load` 的 `warmupMs` 为 0；`capability: 'align'` 在带对齐器的 MOSS 模型包上同样可用（对齐器按需加载）。

**对齐**（`capability: 'align'`）：解码选定音轨（与范围），不跑 VAD 与识别，把 `text` 整段强制对齐到音频上（长音频由对齐器自己分块）。词按停顿（> 0.8 秒）、句末标点与段长（> 30 秒）分段，与在线 Provider 只给词时同一规则；段的文本由词重新拼出（不带空格书写的文字之间不加空格），零时长的段补到一个对齐格（0.08 秒），起点越过音频末尾的词丢弃。阶段依次是 `decoding`、`aligning`、`finalizing`；`stats.vadMs` 与 `asrMs` 为 0，耗时记在 `alignMs`。对齐出错是 `INFERENCE_FAILED`——这里没有可退回的估计。结果的语言来源是 `asserted`，词时间都是 `aligned`。

#### 2.5.2 合成

本地语音合成（架构设计 §6.1、§6.5）。参数是 Runtime 在提交时冻结的（`JobRecord.generation`），Worker 照做，不换声音、不改参数；做不到就失败。

```ts
params: {
  jobId: string;
  runGeneration: number;
  capability: 'synthesize';
  input: {                            // 参考录音：只在 voice.mode 为 'clone' 时给出，其余为 null
    file: string;                     // 绝对路径
    contentHash: string;              // 'sha256:<hex>'；Runtime 在发出前已按它核对过文件
    track: number;                    // 0
  } | null;                           // 不接受 range：参考录音整段使用
  options: SynthesizeOptions;
  staging: string;
  outputContract: 'baocut.speech-wav/v1';
}

interface SynthesizeOptions {
  text: string;                       // 原样；读音标注由引擎换成自己的写法
  language: string | null;            // BCP 47；null 时由引擎按文本判断
  voice:
    | { mode: 'preset'; id: string }                     // 模型自己的说话人
    | { mode: 'clone'; transcript: string | null }       // 用 input 的参考录音；transcript 是它的原文
    | { mode: 'describe'; description: string };         // 一句声音描述
  instructions: string | null;        // 语气说明；模型不接受时 Runtime 已在提交时拒绝
  speed: number | null;               // null 一律用模型的默认值
  cfg: number | null;
  steps: number | null;
  seed: number | null;
}

result: {
  outcome: 'completed' | 'cancelled';
  output: { path: string; sha256: string; byteLength: number } | null;   // staging 里的 speech.wav（§5.1），绝对路径
  audio: { sampleRate: number; channels: number; durationSec: number } | null;
  stats: { referenceMs: number; synthesisMs: number; encodeMs: number };
  readingsDropped: Array<{                                                 // 没能按注记念出来的读音；取消时为 []
    start: number; end: number;       // 去注记后的文字里的 [start, end)，Unicode 码点偏移
    reading: string;                  // 规范化的拼音读音（`yin2 hang2`，带调拼音也已换成数字）；畸形注记是原文
    origin: 'user' | 'phrase' | 'dict' | 'llm';
  }>;
}
```

`text` 里的读音标注写成 `<字|读音>`：表面含汉字，读音是拼音，多字按空格分音节，音节数等于表面字数（`<银行|yin2 hang2>`）。每个音节写声调数字（`hang2`，轻声 `5`，ü 写 `v` 或 `ü`）或带调拼音（`háng`、`lǜ`；不标调是轻声，`<了|le>`），同一个注记里可以混用（`<银行|yín hang2>`），不分大小写；Worker 解析时一律规范成小写的声调数字写法（j / q / x / y 后的 ü 写 `u`），引擎与 `readingsDropped` 里合法注记的读音只见规范写法。音节去调后须是 1–6 个字母、含元音（成音节的 `m n ng hm hng` 除外）；只认预组合的带调字母，调号与数字并存、一个音节两个调号都不合法。读音带数字或调号却不合法的是畸形注记，原样留作文字；既不带数字也不带调号又不合法的（`<中文|Chinese>`）不算注记。读音标注由 Worker 按引擎换成它能吃的写法（同音字、行内拼音、原样标注）；引擎念不了的（不认读音、词表里没有、注记畸形）按表面文字合成，并如实列进 `readingsDropped`，不静默丢弃，也不让任务失败。Runtime 把每一条转成任务的 `reading-dropped` 警告（`detail` 只说位置与读音）。

超过模型单次能稳定生成的长度时，引擎把 `text` 按句切成块逐块合成，再按原来的次序拼成一段（Qwen3-TTS 与 VoxCPM2 每块以 60 个单元为预算，一个汉字或一个空格分隔的词算一个单元，不到 8 个单元的碎尾并回前一块时可略超；段落（换行）总是块边界，一句装不下时退到分句标点，再不行按长度硬切）。块与块之间的停顿与响度由 Worker 统一定，不沿用模型在每块首尾自带的静音：块边界两侧的首尾静音（10 ms 窗的 RMS 低于 −45 dBFS）去掉，每侧至多留 50 ms；块之间插固定停顿，上一块以句末标点收尾时 0.35 秒，段落边界 0.6 秒，在句中断开时 0.2 秒，停顿从上一块最后的有声处量到下一块最初的有声处；每块有声部分的 RMS 对齐到第一块，增益限制在 ±6 dB，放大后峰值不超过 −1 dBFS。整段的开头与结尾不动；只切出一块时不做任何处理。切块与拼接只发生在引擎内部，不改变 `text` 的内容与顺序，也不放宽 Runtime 在提交时按模型上限做的长度检查。`synthesizing` 阶段的 `job.progress`（`unit: 'steps'`）按块计数，取消在块间与生成步之间生效。OmniVoice、GPT-SoVITS 与 IndexTTS2 / 2.5 照各自官方的做法切分与拼接（交叉淡化或固定静音），不经这一步。

形状之外的检查都是 `INVALID_PARAMS`：`outputContract` 必须是 `baocut.speech-wav/v1`，`staging` 与 `input.file` 是绝对路径，`text` 去掉空白后非空，`input` 当且仅当 `voice.mode === 'clone'` 时给出。内置音色（随应用分发的参考录音）在 Runtime 一侧已经换成 `clone` 加录音文件，Worker 不区分。模型做不到请求的声音方式、语言或旋钮时返回 `MODEL_UNSUPPORTED`，`details.reason` 说明是哪一项；`preset` 的说话人名不分大小写（目录写 `Uncle_Fu`，模型的说话人表里是 `uncle_fu`），内置音色的 id（`zh-male` 等）在只有自带说话人的模型上换成最像的那一位，都不算做不到。几项按引擎的检查：VoxCPM2 的 `cfg` 必须大于 0，OmniVoice 的 `describe` 只接受它的封闭词表，不满足是 `INVALID_PARAMS`（词表外的描述带 `details.reason: 'description-vocabulary'`）；GPT-SoVITS 给了 `transcript` 时参考录音须为 3–10 秒，`preparing-reference` 量出时长后、合成之前报 `MODEL_UNSUPPORTED`（`details.reason: 'reference-duration'`，带 `seconds` 与 `range`）。参考录音读不出来是 `INPUT_UNREADABLE`（`details.input: 'reference'`）。加载的是识别模型包时，参数与状态检查之后返回 `MODEL_UNSUPPORTED`（`details: { capability: 'synthesize', reason: 'capability-not-loaded' }`），反之亦然。引擎在推理中失败是 `INFERENCE_FAILED`（消息不带路径），没有产出音频同样是 `INFERENCE_FAILED`（`details.reason: 'empty-audio'`）；`speech.wav` 写不进 staging 是 `OUTPUT_WRITE_FAILED`（`details.file`）。

#### 2.5.3 文生图

本地文生图（架构设计 §6.1、§6.5）。没有输入文件，提示词就是全部输入；参数是 Runtime 在提交时冻结的（`JobRecord.generation`），Worker 照做，不改尺寸、不换 seed。

```ts
params: {
  jobId: string;
  runGeneration: number;
  capability: 'image';
  options: {
    prompt: string;                   // 原样
    width: number;                    // 像素
    height: number;
    steps: number | null;             // 去噪步数；null 用模型的默认值（Qwen-Image 为 20）。请求给了 `steps` 或模型包检查（§4.3）时给出
    seed: number;                     // 0..2^32-1；请求没给时 Runtime 在提交时抽一个并冻结，重试与重新执行用同一个
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

阶段依次是 `encoding-prompt`（文本编码）、`denoising`（去噪；`job.progress` 的 `unit: 'steps'`，开始时报 `0/n`，每完成一步报一次）、`decoding`（VAE 解码与写 PNG）。取消在步间生效，之后 `outcome: 'cancelled'`，不写输出。同一台机器、同一个后端上同一组参数（含 seed）逐字节得到同一张图；初始噪声由 seed 决定，但 MLX 与 candle 各用自己的随机数生成器（candle 是主机上的 ChaCha20，同 v2），同一个 seed 在两个后端上得到不同的图。

形状之外的检查都是 `INVALID_PARAMS`：`outputContract` 必须是 `baocut.image-png/v1`，`staging` 是绝对路径，`prompt` 去掉空白后非空，宽高为正，`steps` 不为 0；`options` 多出字段或缺 `seed` 是形状错误。模型出不了的尺寸在开跑前返回 `MODEL_UNSUPPORTED`（`details: { family, reason: 'unsupported-size', width, height, rule }`）；Qwen-Image 要求宽高都是 32 的倍数、长边不超过 1536、长短边之比不超过 3。Runtime 在提交时已按模型描述列出的尺寸拒绝过，这里是兜底。加载的不是文生图模型包时返回 `MODEL_UNSUPPORTED`（`details: { capability: 'image', reason: 'capability-not-loaded' }`），反之亦然。引擎在推理中失败是 `INFERENCE_FAILED`（`details.reason: 'generation-failed'`，消息不带路径），出图的尺寸与请求不符是 `reason: 'size-mismatch'`，写不出文件是 `reason: 'write-failed'`。

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

### 2.6 `job.cancel`

```ts
params: { jobId: string }
result: { acknowledged: true }
```

Worker 立即响应，然后在下一个分段边界（合成是下一个生成步或下一句，生图是下一个去噪步，分离与说话人区分是下一个窗口）停止任务；`job.run` 随后以 `outcome: 'cancelled'` 返回。未知的 `jobId` 返回 `NOT_FOUND`。

## 3. 事件

| 事件 | params | 语义 |
| --- | --- | --- |
| `model.phase` | `{ phase: 'loading-weights' \| 'compiling' \| 'warming-up', detail?: string }` | 加载阶段；没有百分比 |
| `job.phase` | 识别：`{ jobId, phase: 'decoding' \| 'vad' \| 'transcribing' \| 'aligning' \| 'diarizing' \| 'finalizing' }`；合成：`{ jobId, phase: 'preparing-reference' \| 'synthesizing' \| 'encoding' }`（没有参考录音时跳过第一个）；生图：`{ jobId, phase: 'encoding-prompt' \| 'denoising' \| 'decoding' }`；分离：`{ jobId, phase: 'decoding' \| 'separating' \| 'encoding' }`；说话人区分：`{ jobId, phase: 'decoding' \| 'diarizing' \| 'finalizing' }` | 阶段切换；第一个事件之前 `worker.status` 报告 `starting` |
| `job.progress` | `{ jobId, phase, done: number, total: number \| null, unit: 'seconds' \| 'segments' \| 'steps' }` | `total` 未知时为 null，不伪造；`steps` 是合成的生成步或句子、生图的去噪步，分离的「窗口 × 子模型」，说话人区分的窗口 |
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
  backend: 'mlx' | 'coreml' | 'candle' | 'ggml';   // mlx、coreml 只在 Apple Silicon 的 macOS 上
  device: string;                     // mlx 为 'metal'，coreml 为 'ane'，candle 为 'cuda' 或 'cpu'，ggml 为 'cuda'、'vulkan' 或 'cpu'（§2.1）
  components: {
    asr?: ModelFiles;
    vad?: ModelFiles;
    tokenizer?: ModelFiles;           // 识别模型单独仓库的分词器（Whisper）
    aligner?: ModelFiles;
    speaker?: ModelFiles;
    segmentation?: ModelFiles;        // 说话人分段（Pyannote，与 `speaker` 一起来自「说话人区分」模型包，§2.5.1）
    tts?: ModelFiles;                 // 合成的主模型
    codec?: ModelFiles;               // 语音编解码器（Qwen3-TTS 的 12 Hz tokenizer）
    aux?: ModelFiles;                 // 辅助权重（IndexTTS 2.5 用 IndexTTS2 的说话人与声码器权重）
    separator?: ModelFiles;           // 人声分离模型（HTDemucs-FT）
    image?: ModelFiles;               // 文生图模型（Qwen-Image：一个仓库里的分词器、调度器配置、文本编码器、DiT 与 VAE）
  };
  threads: number;                    // CPU 线程数上限
  memoryBudgetBytes: number | null;   // 准入给出的预算；null 为不限制
}

interface ModelFiles {
  family:
    | 'qwen3-asr' | 'whisper-mlx' | 'whisper-coreml' | 'whisper-ggml' | 'moss-transcribe-diarize' | 'whisper-tokenizer'
    | 'qwen3-forced-aligner' | 'silero-vad' | 'wespeaker' | 'pyannote-segmentation'
    | 'qwen3-tts' | 'qwen3-tts-tokenizer' | 'indextts2' | 'indextts2.5' | 'indextts2-aux'
    | 'gpt-sovits' | 'voxcpm2' | 'omnivoice' | 'qwen-image'
    | 'htdemucs-ft';
  revision: string;                   // 上游仓库的 revision
  dir: string;                        // 绝对路径
  files: Array<{ path: string; sha256: string; byteLength: number }>;   // 相对 dir
}
```

模型目录的布局是 `<models-root>/<owner>/<repo>/`，`<models-root>` 默认为 `<runtime-home>/models`，可在设置里改（`models.dir`，经 `models.setDir`），`BAOCUT_MODELS_DIR` 优先（架构设计 §6.3）。Worker 只按 `load_bundle` 给的路径读文件，不关心模型目录在哪；换目录前 Runtime 先卸下所有 Worker。每个仓库目录带 `.bcut-manifest.json`（`format_version: 1`，含 `repo`、`revision`、`files[{path,size,sha256}]`，与旧版本 BaoCut 的下载器兼容）；Runtime 的模型目录以它为 `files` 的来源，缺清单或清单与磁盘不符即 `not-installed`。Worker 加载前逐个校验 `files` 的大小；sha256 的校验由 Runtime 在安装与登记时完成，Worker 只在 `files` 列出的文件之外不读任何文件。`family` 决定加载器；未知的 `family` 返回 `MODEL_UNSUPPORTED`。一个模型包要么是识别（`asr` 必有，其余组件按 `asr` 的 family），要么是合成（`tts` 必有，`codec`、`aux` 按模型族），要么是文生图（只有 `image`，带别的组件是 `MODEL_UNSUPPORTED`），要么是分离（只有 `separator`，带别的组件是 `unexpected-component`），要么是说话人区分（`segmentation` 与 `speaker` 都必需，family 是 `pyannote-segmentation` 与 `wespeaker`，没有 `asr`，带别的组件是 `unexpected-component`；§2.5.5），不混用。文生图不按 `memoryBudgetBytes` 检查权重大小：三段权重逐层流式读入、从不同时驻留，进程峰值远小于权重总量，准入由 Runtime 按模型包登记的实测峰值做（架构设计 §6.5）。识别的组件：

| `asr` family | `vad` | `tokenizer` | `aligner`、`speaker` | `segmentation` |
| --- | --- | --- | --- | --- |
| `qwen3-asr` | 必需（`silero-vad`） | 不得有 | 可选 | 可选（`pyannote-segmentation`） |
| `whisper-mlx` | 必需（`silero-vad`） | 必需（`whisper-tokenizer`） | 可选 | 可选（`pyannote-segmentation`） |
| `whisper-coreml` | 必需（`silero-vad`） | 必需（`whisper-tokenizer`） | 可选 | 可选（`pyannote-segmentation`） |
| `whisper-ggml` | 必需（`silero-vad`） | 不得有（词表在 GGML 文件里） | 可选 | 可选（`pyannote-segmentation`） |
| `moss-transcribe-diarize` | 不得有（自分段） | 不得有 | 可选 | 不得有（自己区分说话人） |

缺必需组件是 `MODEL_UNSUPPORTED`（`details: { component, reason: 'missing-component' }`），多了不该有的是 `reason: 'unexpected-component'`，组件的 family 不对是 `reason: 'unknown-family'`。Runtime 登记的模型包可以把共用的组件（对齐器、说话人模型）标为可选：安装与修复照样下载它，缺它时模型包仍算装好，交给 Worker 的 `components` 里略去它。`segmentation` 与 `speaker` 也可以来自识别模型包登记的「说话人区分」模型包：那个模型包装好时 Runtime 把它的两个组件加进交给 Worker 的 `components`，没装好时都不加（架构设计 §6.3）。Core ML 的模型是目录（`.mlmodelc`）：清单与 `files` 必须逐个列出目录里的全部文件（大小照样逐个校验），Worker 把目录整体交给框架、不扫描它；`files` 里这个目录下一个文件都没有时是 `MODEL_NOT_INSTALLED`（`details: { component, file: '<目录>/', reason: 'not-listed' }`）。`coreml` 后端的设备是 `ane`（编码器与解码器跑在神经网络引擎上，mel 在 CPU 与 GPU 上），别的设备是 `MODEL_UNSUPPORTED`（`reason: 'unsupported-device'`）；VAD 跑在 MLX 上，没有 Metal 设备时后端不可用。`candle` 后端读与 MLX 相同的仓库（MLX 的仿射量化权重加载时反量化，CPU 上算 f32，CUDA 上算权重的半精度；`qwen-image` 逐层用到时才反量化，CUDA 上算 bf16），设备是 `cpu` 或 `cuda`；`cuda` 要求 Worker 在 §2.1 报告了它，否则与别的设备一样是 `MODEL_UNSUPPORTED`（`reason: 'unsupported-device'`）。Silero VAD 在 `candle` 上总跑在 CPU 上。`ggml` 后端用 whisper.cpp 按量化原样加载 `whisper-ggml` 的 `asr`：要有一个 `.bin`（单文件 GGML 权重），没列出是 `MODEL_NOT_INSTALLED`（`details: { component: 'asr', file: '*.bin', reason: 'not-listed' }`）；VAD 与对齐器借 `candle` 的、跑在 CPU 上，所以 `ggml` 只在同时编进 `candle` 的构建里有。设备是 `cpu`、`cuda` 或 `vulkan`；`cuda` 与 `vulkan` 要求 Worker 在 §2.1 把它报成首选设备（同时编进两个 GPU 后端、选中 CUDA 的 Worker 不收 `vulkan`），别的设备是 `MODEL_UNSUPPORTED`（`reason: 'unsupported-device'`）。`cpu` 模型包不碰 GPU。`whisper-coreml` 的 `asr` 要有 `MelSpectrogram.mlmodelc/`、`AudioEncoder.mlmodelc/`、`TextDecoder.mlmodelc/` 与 `generation_config.json`，有 `TextDecoderContextPrefill.mlmodelc/`（large-v3-turbo）就用它预填前缀；`tokenizer` 要有 `tokenizer.json`。`whisper-mlx`（`mlx` 后端，设备 `metal`）的 `asr` 是 mlx-community 的 fp16 转换：要有 `config.json`（OpenAI 原版的结构字段 `n_mels`、`n_audio_*`、`n_text_*`、`n_vocab`）与 `.safetensors` 权重；配置的结构对不上（例如不是 30 秒窗、文本上下文短于 224）是 `MODEL_UNSUPPORTED`（`details: { component: 'asr', file: 'config.json', reason: 'unsupported-config' }`），在读权重之前报；`tokenizer` 要有 `tokenizer.json` 与 `generation_config.json`（Core ML 的 `generation_config.json` 在 `asr` 里，MLX 的转换仓库没有它，取分词器仓库里的同一份）。`htdemucs-ft` 的 `separator` 要有 `htdemucs_ft.safetensors` 与 `htdemucs_ft_config.json`（fp16 权重加载后升成 f32，常驻约为文件的两倍；`candle` 在 CPU 与 CUDA 上都按 f32 算，不用半精度）。几个模型包用到同一个仓库版本时共用一个仓库目录，删除时按引用保留（架构设计 §6.3）。

### 4.2 内置清单与下载

架构设计 §6.3。Worker 不下载。Runtime 为每个登记的组件（上游仓库的一个固定 `revision`）带一份内置清单：要下载的文件、每个文件的 sha256 与大小（离线无法确认的大小为 null，做安装计划时向来源发 HEAD 取 `x-linked-size` 或 `Content-Length`），另有大小未知时用于确认的估计值与哈希的来源说明。规则：

- 只下载清单列出的文件，地址是 `<基址>/<owner>/<repo>/resolve/<revision>/<文件路径>`（基址见架构设计 §6.3；逐段 URL 编码，`/` 保留）。
- 先写进 `<models-root>/.bcut-staging/<owner>/<repo>@<revision>/`：没下完的是 `<path>.part`，续传时带 `Range: bytes=<已有字节>-`，`206` 的 `Content-Range` 必须从这个位置开始，`200` 表示来源不支持续传，从头写。每个文件按清单核对大小与 sha256，对上了才改名为 `<path>`；暂存区里核对过的文件不再下载。
- 一个仓库的文件齐了，写 `.bcut-manifest.json`（`files` 是实际的大小与 sha256，`source_verified: true`，`source` 为下载的基址），整个暂存目录改名为仓库目录（旧目录先挪开，换上之后删掉）。暂存区与模型目录在同一个卷上，改名是原子的。
- 清单里有文件缺可信的 sha256 时整个组件拒绝安装（`MODEL_MANIFEST_INCOMPLETE`），不下载了再算。哈希的来源与核对状况记在清单的说明里；没有重新核对过的列在架构设计 §14。
- 修复读一遍仓库目录里每个文件的 sha256，好文件硬链接（不行就复制）进暂存区，只下载坏的与缺的，再按上面的方式发布。

### 4.3 检查

**识别**。随 Runtime 分发一段固定的样本（转写是英文朗读，`packages/models/assets/self-test-sample.wav`，16 kHz 单声道；打包后在 `<resources>/model-assets/`，找法见根 README 的 `BAOCUT_MODEL_ASSETS_DIR`），检查以它为输入走一遍 `model.load` → `job.run`，按 §6 校验输出，再核对识别文本（小写、去标点后，英文的个位数词与阿拉伯数字视作相同）含固定的短语。

**合成**。用模型的默认声音（不指定声音时提交会选的那个，内置音色照常带参考录音）合成一句固定的短句：模型列出的第一种有句子的语言，接受任意语言或列出的语言都没有句子时用英文那句。句子表在 `packages/models/src/speech-self-test.ts`。输出按 §5.1 核对长度与摘要，再判定：

- 能解码：RIFF/WAVE，PCM 16/24/32 位或 32 位浮点（含 `WAVE_FORMAT_EXTENSIBLE`），1–2 声道，采样率 8–192 kHz；
- 时长在 0.3–30 秒之间；
- 不是静音：全部样本的均方根（满幅为 1）不低于 0.001（约 −60 dBFS）；
- 没有削波：到了满幅（|x| ≥ 0.999）的样本不超过全部样本的 0.1%。本地引擎的输出已经限到 −1 dBFS（§5.1），超过这个比例说明那一步失效了。

检查不判断读得对不对（那要另一个识别模型），只证明整条合成链路能出声。通过时记下时长与采样率，WAV 作为产物留存；不通过记下原因。

**文生图**。用固定的提示词、256×256、4 步、seed 7 生成一张（参数在 `packages/models/src/image-self-test.ts`）。输出按 §5.1 核对长度与摘要，再判定：

- 能解码：8 位 PNG（灰度、RGB、带 alpha 的灰度或 RGBA），不隔行；
- 宽高等于请求的 256×256；
- 不是一整片纯色：不同的颜色（含 alpha）至少 16 种。

检查不判断画得好不好，只证明整条生图链路能出图。通过时记下尺寸与步数，PNG 作为产物留存；不通过记下原因。

**分离**。把识别用的同一段样本（只有人声）按 §2.5.4 分离，`sampleRate` 为 null。两路按 §5 核对长度与摘要，再判定：

- 都能解码（同上），是立体声，采样率相同，时长与样本相差不超过 0.02 秒；
- 人声不是静音：均方根不低于 0.001；
- 人声与背景分开了：人声的均方根至少是背景的 2 倍（约 6 dB）。HTDemucs-FT 在这段样本上约高 40 dB。

通过时记下时长、采样率与人声比背景高多少 dB，人声 WAV 作为产物留存；不通过记下原因（`MODEL_OUTPUT_WRONG`）。

## 5. 任务与 staging 目录

- Runtime 为每个任务创建 `<runtime-home>/staging/jobs/<jobId>/` 并传入 `staging`。Worker 的所有中间文件与输出都写在这里，文件名固定：识别是 `audio.f32`（可选，解码缓存）、`segments.jsonl`、`result.json`；合成是 `speech.wav`，生图是 `image.png`（§5.1）；分离是 `vocals.wav` 与 `background.wav`（§2.5.4）；说话人区分是 `speakers.json`（§2.5.5）。
- `segments.jsonl` 是 append-only，每行一个 `Segment`（§6），按 `start` 递增写入；每行写完后 flush。首行是头：`{ "header": true, "jobId", "contentHash", "bundleId", "workerVersion", "timescale" }`。Runtime 续跑（P1）时校验头与已有行再决定从哪一段开始。
- `result.json` 在任务完成时一次性写入临时文件再重命名，内容为 §6 的对象。`job.run` 的 `output.sha256` 是该文件 bytes 的摘要。
- Worker 不删除 staging 目录；清理属于 Runtime。

### 5.1 生成任务的输出

`synthesizeSpeech` 与 `generateImage` 的执行者（在线 Provider、本地 Worker，以及之后的节点）遵守同一份输出约定，Runtime 按它校验后发布（架构设计 §6.4）：

- 输入是提交时冻结的参数（`JobRecord.generation`），执行者不改参数、不换模型或音色；做不到就失败。
- 每个输出写成 staging 里的 `output-<n>.<扩展名>`（`n` 从 1 开始；扩展名 `mp3`、`wav`、`flac`、`png`、`jpg`、`webp`），完成时报告相对路径、sha256（小写十六进制）、长度与媒体类型（`audio/mpeg`、`audio/wav`、`audio/flac`、`image/png`、`image/jpeg`、`image/webp`）。
- 本地 Worker 的合成（§2.5.2）输出合同是 `baocut.speech-wav/v1`：一个 PCM WAV（16/24/32 位整数或 32 位浮点，单声道或立体声，采样率是模型的原生采样率），文件名固定为 `speech.wav`，先写临时文件再重命名。整段的峰值高于 −1 dBFS（满幅为 1 时约 0.891）时，Worker 在写出前把整段等比缩小到 −1 dBFS（非有限的样本先置零）；不提升安静的输出，也不做压缩。Worker 报告绝对路径；本地 Provider 换成相对 staging 的路径，不是 `speech.wav` 时按协议错误处理。
- 本地 Worker 的生图（§2.5.3）输出合同是 `baocut.image-png/v1`：一张 8 位 RGBA PNG，宽高就是请求的宽高，文件名固定为 `image.png`，先写临时文件再重命名。第四个通道是模型（Qwen-Image 的 VAE）自己给的 alpha，原样写入。本地 Provider 同样换成相对路径，不是 `image.png` 时按协议错误处理。
- 输出个数等于请求的张数（语音为 1），媒体类型等于请求的格式。
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

校验规则（Runtime 在发布前执行，Worker 在写出前自检）：

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
| `INPUT_UNREADABLE` | 输入文件（识别的素材、合成的参考录音）不存在、不可解封装或解封装器不在白名单 | false |
| `DECODE_FAILED` | 解码中途失败 | true |
| `INFERENCE_FAILED` | 模型前向失败（非崩溃） | true |
| `WORKER_PANIC` | Rust panic | true |
| `OUTPUT_WRITE_FAILED` | 输出写不进 staging（磁盘满、目录不可写；`details.file`） | true |

Runtime 把这些映射到命令与协议规范 §11.3 的 `MODEL_LOAD_FAILED` / `MODEL_WORKER_CRASHED` / `MODEL_OUTPUT_INVALID`；`OUTPUT_WRITE_FAILED` 是 `STAGING_WRITE_FAILED`，不算崩溃、不停用模型包（`DECODE_FAILED`、`INFERENCE_FAILED`、`WORKER_PANIC` 算）；`job.run` 返回的 `MODEL_UNSUPPORTED` 也是 `MODEL_LOAD_FAILED`（`details.reason: 'unsupported'`，Worker 的 `details` 原样放在 `details.workerDetails`），不停用模型包。合成的参考录音在执行前与提交时的摘要不符或读不出来时，Runtime 不发 `job.run`，任务以 `ASSET_MISSING` 失败。

## 8. 待评审事项

| 事项 | 需要决定什么 | 当前文档的假设 |
| --- | --- | --- |
| 解码放在哪一侧 | Worker 自己解码（本文）还是 Runtime 用 ffmpeg 解码后传 PCM | Worker 解码：ffmpeg 管道为主，PCM WAV 走纯 Rust 路径；demuxer 白名单与 Runtime 的媒体分析一致 |
| `threads` 与调度优先级 | MLX 后端不使用 CPU 线程上限；推理线程的优先级如何设置 | `threads` 目前被忽略；推理线程在 macOS 上以 utility QoS 运行，其他平台不调整 |
| `align` 的文本输入形状 | 纯文本还是带句子边界的结构 | 纯文本，Worker 自己分词 |
| 说话人嵌入是否进结果 | `speakers[].embedding` 是否输出供跨任务合并 | 不输出 |
| 合成的单次文本上限 | 本地合成一次任务接受多少字符（引擎内部按句切分） | 2000 个码点，超过时在提交时拒绝、不截断；待各引擎接上后按实测的内存与时长校准 |
| 内置清单的哈希与大小 | Qwen3-ASR 0.6B 与 Silero VAD 两个仓库的 sha256 由谁、在哪里重新核对；大小是否写进清单 | sha256 沿用旧版 BaoCut 固定的值，未在本仓库重新核对（架构设计 §14）；大小在计划时经 HEAD 取得。后来登记的识别仓库（Qwen3-ASR 1.7B、对齐器、说话人模型、Whisper、MOSS）的大小与 sha256 已和本机装好的同一版本逐个核对 |
| Whisper 与 MOSS 的接入 | Core ML 后端与两个模型族的加载器何时接上；说话人与词时间怎么来 | 契约与组件形状已定（§2.1、§4.1）。Whisper 已接入：`coreml` 后端、`transcribeFamilies` 含 `whisper-coreml`，登记了 large-v3 与 large-v3-turbo 两个模型包；MLX 的 Whisper（`whisper-mlx`）也已接入，登记了 `whisper-large-v3@mlx` 与 `whisper-large-v3-turbo@mlx`，Runtime 暂不列出（替换 Core ML 与否待定，见架构设计 §6.5）；词时间由可选的对齐器给出（与 Qwen3-ASR 共用，对齐器在 MLX 上跑），没装时按字长估计。MOSS 已接入：带 MLX 的构建在 `transcribeFamilies` 里列出它，登记了 `moss-transcribe-diarize@mlx-8bit`（8 bit 量化），可选的对齐器只对齐长于 5 秒的行，可选的说话人模型合并跨块的说话人（§2.5.1）。Qwen3-ASR 与 Whisper 由「说话人区分」模型包（Pyannote 分段 + WeSpeaker）区分说话人（§2.5.1）；非 macOS 上 Qwen3-ASR 与 MOSS 走 candle，Whisper 走 `ggml`（whisper.cpp，CPU、CUDA 或 Vulkan；架构设计 §6.5），登记了 `whisper-large-v3@ggml` 与 `whisper-large-v3-turbo@ggml`，同样带可选的对齐器（在 candle 的 CPU 上跑）；还没有用真实权重跑过，CUDA 与 Vulkan 尚未实测 |
