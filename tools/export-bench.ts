// 成片导出的基准（开发流程 §2 的可选检查）：合成一段带双语字幕的 1080p 夹具，用 Render Worker（`export-worker render`）
// 按导出同样的输入画完整段、编码成 MP4，报墙钟时间、Worker 自报的合成时间（`renderSeconds`）、帧数、每帧毫秒、输出帧率与负载。
//
// 夹具（都在系统临时目录里，结束时删掉，`--keep` 保留）：
// - 画面：ffmpeg 的 `testsrc2`，1920×1080、30 fps、H.264（每 2 秒一个关键帧），缺省 60 秒（`--seconds`）；没有声音，
//   测的是画面的解码、合成与编码，不含声音的混音与封装；
// - 字幕：每 2.5 秒一句。原文是英文，带逐词时刻的转写（`baocut.speech/1`，句子用 `words` 指向转写里的词），按逐词变色画；
//   译文中英混排，与原文共用一份样式文档（双语叠成一组）。`--mono` 只烧原文，`--no-captions` 关掉烧字幕（`burnCaptions: false`）。
// Worker 的输入用 Runtime 的 `workerInput`（`packages/runtime-core/src/exports/video-export.ts`）拼，视频与文档按引擎
// `exports.plan` 给的形状手写（取自一致性夹具 `crates/frame-render/tests/fixtures/parity.json` 的写法）。
//
// 用法：node tools/export-bench.ts [--seconds 60] [--mono | --no-captions] [--style <预设>] [--worker <export-worker>] [--runs 1]
//       [--json <输出文件>] [--keep]
// `--style` 选字幕样式预设：缺省 `studio-color`（逐词变色，画面只在句与词的边界变，约 1 ms/帧）；其余走字幕内核每帧重画的路径：
// `studio-transition`（入场姿态＋出场）、`studio-wordbox`（药丸高亮块随词缩放淡入）、`designed`（Designed Caption 配方＋逐词强调）、
// `boxed-reveal`（定位框样式＋逐字显现，原文与译文各一个框；词到了才亮出来，只在词界变）、`boxed-motion`（同样的框，词入场连续位移）。
// `--worker` 缺省是 `<target>/release/export-worker`（`cargo build --release -p export-worker`；打包的应用用 release），
// 没有时退回 debug 并警告。`--runs` 大于 1 时报中位数与最好的一次。机器忙时绝对值会飘，看输出里的负载。
// 环境：CARGO_TARGET_DIR（找 export-worker），BAOCUT_FFMPEG / BAOCUT_FFPROBE（缺省 PATH 里的 ffmpeg、ffprobe）。

import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { cpus, loadavg, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  workerInput,
  type VideoOutput,
  type VideoPlanResult,
} from "../packages/runtime-core/src/exports/video-export.ts";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const FFMPEG = process.env.BAOCUT_FFMPEG ?? "ffmpeg";
const FFPROBE = process.env.BAOCUT_FFPROBE ?? "ffprobe";
const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
/** 每句字幕的间隔与长度（秒）。 */
const CUE_EVERY = 2.5;
const CUE_LENGTH = 2.3;

type Captions = "bilingual" | "mono" | "none";

/** 字幕样式预设（`--style`）。除缺省的 `studio-color` 外，都会让字幕内核每帧重画。 */
const STYLES = [
  "studio-color",
  "studio-transition",
  "studio-wordbox",
  "designed",
  "boxed-reveal",
  "boxed-motion",
] as const;
type StyleName = (typeof STYLES)[number];

interface Options {
  seconds: number;
  captions: Captions;
  style: StyleName;
  worker: string | null;
  runs: number;
  json: string | null;
  keep: boolean;
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    seconds: 60,
    captions: "bilingual",
    style: "studio-color",
    worker: null,
    runs: 1,
    json: null,
    keep: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--seconds") options.seconds = Number(argv[++i]);
    else if (arg === "--mono") options.captions = "mono";
    else if (arg === "--no-captions") options.captions = "none";
    else if (arg === "--style") {
      const name = argv[++i] as StyleName;
      if (!STYLES.includes(name))
        throw new Error(`--style 要是 ${STYLES.join(" / ")} 之一`);
      options.style = name;
    } else if (arg === "--worker") options.worker = resolve(argv[++i]!);
    else if (arg === "--runs") options.runs = Number(argv[++i]);
    else if (arg === "--json") options.json = resolve(argv[++i]!);
    else if (arg === "--keep") options.keep = true;
    else throw new Error(`不认识的参数 ${arg}`);
  }
  if (!Number.isInteger(options.seconds) || options.seconds < 1)
    throw new Error("--seconds 要是正整数");
  if (!Number.isInteger(options.runs) || options.runs < 1)
    throw new Error("--runs 要是正整数");
  return options;
}

/** Worker：给了就用给的；否则 release，没有时退回 debug。 */
function findWorker(given: string | null): { path: string; profile: string } {
  if (given) {
    if (!existsSync(given)) throw new Error(`没有 ${given}`);
    return {
      path: given,
      profile: given.includes("/release/")
        ? "release"
        : given.includes("/debug/")
          ? "debug"
          : "custom",
    };
  }
  const target = process.env.CARGO_TARGET_DIR ?? join(ROOT, "target");
  const release = join(target, "release/export-worker");
  if (existsSync(release)) return { path: release, profile: "release" };
  const debug = join(target, "debug/export-worker");
  if (existsSync(debug)) {
    console.warn(
      `警告：没有 ${release}，改用 debug 版（比打包的应用慢得多）；先 cargo build --release -p export-worker`,
    );
    return { path: debug, profile: "debug" };
  }
  throw new Error(
    `没有 export-worker：先 cargo build --release -p export-worker`,
  );
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    stdio: ["ignore", "ignore", "pipe"],
    encoding: "utf8",
  });
  if (result.error)
    throw new Error(`${command} 启动失败：${result.error.message}`);
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(" ")} 失败：${result.stderr}`);
}

// ---------- 夹具 ----------

const ORIGINAL = [
  "Today we are going to look at how the export pipeline works",
  "Every frame is planned decoded composited and then encoded",
  "Subtitles are drawn on top of the picture in both languages",
  "The original line follows the speaker word by word",
  "While the translation sits right above it on screen",
  "Long sentences wrap onto a second line when they get too wide for the frame",
  "Short ones stay on a single line",
  "We measure how many frames per second the worker can sustain",
];
const TRANSLATION = [
  "今天我们来看一下 export pipeline 是怎么工作的",
  "每一帧都要先 plan、再解码、合成，最后交给 encoder",
  "字幕用两种语言画在画面上方",
  "原文跟着说话人 word by word 变色",
  "译文就叠在它上面",
  "句子太长、超过画面宽度的时候会自动折到第二行，比如这一句就比较长",
  "短句只占一行",
  "我们量 worker 每秒能稳定画多少帧（FPS）",
];

/** 译文行的样式文档 id；Studio 样式两行共用 `doc_style`，定位框样式各有一个框。 */
const ORIG_STYLE = "doc_style";
const TRANS_STYLE = "doc_style_trans";

const motion = (preset: string, durationSeconds: number, easing: string) => ({
  preset,
  unit: "cue",
  durationSeconds,
  staggerSeconds: 0,
  intensity: 1,
  easing,
});

const studioDocument = (documentId: string, style: unknown) => ({
  documentId,
  kind: "caption-style",
  schema: "baocut.legacy-studio-style/0.1",
  body: { schema: "baocut.legacy-studio-style/0.1", style },
});

/** 定位框样式：画布与输出同大，原文框在下、译文框叠在它上面；`animationPresetId: reveal` 逐字显现。 */
const boxedDocument = (documentId: string, y: number, preset: string) => ({
  documentId,
  kind: "caption-style",
  schema: "baocut.boxed-caption-style/18",
  body: {
    schema: "baocut.boxed-caption-style/18",
    canvas: { width: WIDTH, height: HEIGHT },
    box: { x: 0, y, width: 1700, height: 160 },
    style: {
      fontSize: 64,
      color: "#FFFFFF",
      verticalAlign: "center",
      animationPresetId: preset,
    },
  },
});

/** 预设的样式文档：`orig` 给原文，`trans` 给译文（缺省与原文共用）。 */
function styleDocuments(style: StyleName): { orig: unknown; trans: unknown } {
  const studio = (extra: Record<string, unknown>) => {
    const doc = studioDocument(ORIG_STYLE, { order: "trans", ...extra });
    return { orig: doc, trans: doc };
  };
  switch (style) {
    case "studio-color":
      // 逐词变色：画面只在句子与词的边界变。
      return studio({ anim: { name: "Color" } });
    case "studio-transition":
      // 入场姿态（淡入＋缩放）与出场（textMotion.out）：句首句尾每帧重画。
      return studio({
        anim: { name: "Color" },
        transition: { transitionId: "magic-pop", transitionSpeed: 0 },
        textMotion: {
          version: 1,
          in: motion("fade-up", 0.5, "easeOutQuad"),
          out: motion("blur-out", 0.4, "easeInQuad"),
        },
      });
    case "studio-wordbox":
      // 药丸高亮：高亮块随词的相位缩放、淡入。
      return studio({
        wordAnimation: {
          animationName: "Highlight",
          active: {
            boxScale: [
              [0, 0.7],
              [0.4, 1.08],
              [1, 1],
            ],
            boxOpacity: [
              [0, 0],
              [0.3, 1],
              [1, 1],
            ],
            boxEasing: "expoOut",
          },
        },
      });
    case "designed": {
      // Designed Caption：配方每帧解析；第 3 个词标成 hero（词 id 取自转写）。
      const doc = studioDocument(ORIG_STYLE, {
        order: "trans",
        captionEmphasis: {
          w0_2: { role: "hero", color: "#00E5FF", emoji: "✨" },
          w1_1: { role: "emphasis", color: "#FFD43B" },
        },
        wordAnimation: {
          animationName: "None",
          caption: {
            schema: 1,
            style: { id: "caption-weight-shift", version: 1 },
            content: "orig",
            palette: { primary: "#FFFFFF", accent: "#FF4D6D" },
            intensity: 72,
            speed: 1.1,
            seed: 31415,
            options: [],
          },
        },
      });
      return { orig: doc, trans: doc };
    }
    case "boxed-reveal":
    case "boxed-motion": {
      // 逐字显现是离散的（词到了才亮出来）；`floatInTop` 让每个词入场时连续位移淡入。
      const preset = style === "boxed-reveal" ? "reveal" : "floatInTop";
      return {
        orig: boxedDocument(ORIG_STYLE, 440, preset),
        trans: boxedDocument(TRANS_STYLE, 270, preset),
      };
    }
  }
}

const MS = (seconds: number) => Math.round(seconds * 1000);
const time = (seconds: number) => ({
  ticks: String(MS(seconds)),
  timescale: 1000,
});

/** 转写、原文与译文字幕（源素材时钟，毫秒）。 */
function captionDocuments(seconds: number, assetId: string, style: StyleName) {
  const words: { id: string; text: string; start: number; end: number }[] = [];
  const original: unknown[] = [];
  const translation: unknown[] = [];
  for (let i = 0; i * CUE_EVERY + 0.5 < seconds; i++) {
    const start = i * CUE_EVERY;
    const end = Math.min(start + CUE_LENGTH, seconds);
    const text = ORIGINAL[i % ORIGINAL.length]!;
    const parts = text.split(" ");
    const step = (end - start) / parts.length;
    const ids = parts.map((word, j) => {
      const id = `w${i}_${j}`;
      words.push({
        id,
        text: word,
        start: MS(start + j * step),
        end: MS(start + (j + 1) * step),
      });
      return id;
    });
    original.push({
      id: `o${i}`,
      start: MS(start),
      end: MS(end),
      text,
      words: { first: ids[0], last: ids.at(-1) },
    });
    translation.push({
      id: `t${i}`,
      start: MS(start),
      end: MS(end),
      text: TRANSLATION[i % TRANSLATION.length],
    });
  }
  const caption = (cues: unknown[]) => ({
    schema: "baocut.caption/1",
    clock: "source-asset",
    timescale: 1000,
    cues,
  });
  return {
    speech: {
      documentId: "doc_speech",
      kind: "speech",
      schema: "baocut.speech/1",
      sourceAssetId: assetId,
      body: {
        schema: "baocut.speech/1",
        clock: "source-asset",
        timescale: 1000,
        words,
      },
    },
    original: {
      documentId: "doc_orig",
      kind: "caption",
      schema: "baocut.caption/1",
      lineKind: "original",
      sourceAssetId: assetId,
      sourceDocumentId: "doc_speech",
      body: caption(original),
    },
    translation: {
      documentId: "doc_trans",
      kind: "caption",
      schema: "baocut.caption/1",
      lineKind: "translation",
      sourceAssetId: assetId,
      body: caption(translation),
    },
    styles: styleDocuments(style),
  };
}

const base = {
  enabled: true,
  locked: false,
  paintOrder: 0,
  followPolicy: { kind: "sequence-fixed" },
};

function captionItem(
  id: string,
  documentId: string,
  styleDocumentId: string,
  frames: number,
) {
  return {
    ...base,
    id,
    type: "caption",
    trackId: "trk_s1",
    documentId,
    styleDocumentId,
    scopeItemIds: ["clip"],
    span: { fromFrame: 0, durationFrames: frames },
  };
}

/** 引擎 `exports.plan` 的 `video` 计划：一条序列，一段铺满画布的视频，字幕按 `captions` 叠上。 */
function plan(
  seconds: number,
  captions: Captions,
  style: StyleName,
  bytes: number,
): VideoPlanResult {
  const frames = seconds * FPS;
  const assetId = "a_clip";
  const docs = captionDocuments(seconds, assetId, style);
  const items: unknown[] = [
    {
      ...base,
      id: "clip",
      type: "video",
      trackId: "trk_v1",
      assetRef: { id: assetId, revision: "rev_1" },
      embeddedAudio: { enabled: false, volume: 1 },
      fit: "cover",
      mode: "fullscreen",
      place: {},
      span: { fromFrame: 0, durationFrames: frames },
      timeMap: {
        kind: "linear",
        rate: { num: 1, den: 1 },
        sourceIn: { ticks: "0", timescale: 1 },
      },
    },
  ];
  const documents: unknown[] = [];
  if (captions !== "none") {
    items.push(captionItem("cap_orig", "doc_orig", ORIG_STYLE, frames));
    documents.push(docs.speech, docs.original, docs.styles.orig);
  }
  if (captions === "bilingual") {
    const own = docs.styles.trans !== docs.styles.orig;
    items.push(
      captionItem(
        "cap_trans",
        "doc_trans",
        own ? TRANS_STYLE : ORIG_STYLE,
        frames,
      ),
    );
    documents.push(docs.translation);
    if (own) documents.push(docs.styles.trans);
  }
  const track = (id: string, kind: string, order: number) => ({
    id,
    kind,
    order,
    locked: false,
    muted: false,
    visible: true,
    solo: { enabled: false, group: "visual" },
  });
  const sequence = {
    id: "seq",
    name: "bench",
    revision: "1",
    canvas: {
      width: WIDTH,
      height: HEIGHT,
      background: "#000000",
      workingSpace: "srgb",
    },
    fps: { num: FPS, den: 1 },
    durationPolicy: { kind: "derived" },
    tracks: [track("trk_v1", "visual", 0), track("trk_s1", "subtitle", 1)],
    items,
    transitions: [],
    markers: [],
    ducking: [],
    animationBindings: [],
  };
  const asset = {
    id: assetId,
    kind: "video",
    name: "clip.mp4",
    currentRevision: "rev_1",
    revisions: {
      rev_1: {
        revision: "rev_1",
        byteLength: bytes,
        contentHash: `sha256:${assetId}`,
        mediaType: "video/mp4",
        provenance: { origin: "import" },
        storage: { mode: "managed" },
        video: {
          displayWidth: WIDTH,
          displayHeight: HEIGHT,
          frameRate: { kind: "cfr", rate: { num: FPS, den: 1 } },
          hasAlpha: false,
          pixelAspectRatio: { num: 1, den: 1 },
          ptsOrigin: { ticks: "0", timescale: 1 },
          rotation: 0,
        },
      },
    },
  };
  return {
    sequenceId: "seq",
    document: {
      rootSequenceId: "seq",
      sequences: { seq: sequence },
      assets: { [assetId]: asset },
    },
    documents,
    parts: [{ video: { range: { start: time(0), end: time(seconds) } } }],
  } as unknown as VideoPlanResult;
}

interface Fixture {
  dir: string;
  inputFile: string;
  outputFile: string;
  cues: number;
}

function makeFixture(
  seconds: number,
  captions: Captions,
  style: StyleName,
): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "baocut-export-bench-"));
  const clip = join(dir, "clip.mp4");
  run(FFMPEG, [
    '-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${WIDTH}x${HEIGHT}:rate=${FPS}`, '-t', String(seconds),
    '-c:v', 'libx264', '-preset', 'veryfast', '-g', String(FPS * 2), '-pix_fmt', 'yuv420p', '-y', clip,
  ]); // prettier-ignore
  const outputFile = join(dir, "out.mp4");
  const output: VideoOutput = {
    format: "mp4",
    codec: "h264",
    width: WIDTH,
    height: HEIGHT,
    picture: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
    fps: { num: FPS, den: 1 },
    crf: null,
    bitrateKbps: null,
    audioBitrateKbps: 192,
  };
  const assets = new Map([
    [
      "a_clip",
      {
        assetId: "a_clip",
        revision: "rev_1",
        path: clip,
        mediaType: "video/mp4",
      },
    ],
  ]);
  const input = workerInput({
    plan: plan(seconds, captions, style, statSync(clip).size),
    part: 0,
    assets: assets as never,
    output,
    outputPath: outputFile,
    audioPath: null,
    burnCaptions: captions !== "none",
    onUnsupported: "fail",
    ffmpeg: which(FFMPEG),
    ffprobe: which(FFPROBE),
  });
  const inputFile = join(dir, "1.input.json");
  writeFileSync(inputFile, JSON.stringify(input));
  return {
    dir,
    inputFile,
    outputFile,
    cues: Math.ceil((seconds - 0.5) / CUE_EVERY),
  };
}

/** Worker 要的是工具的路径：PATH 里的名字换成绝对路径。 */
function which(tool: string): string {
  if (tool.includes("/")) return resolve(tool);
  const found = spawnSync("/usr/bin/env", ["which", tool], {
    encoding: "utf8",
  });
  const path = found.stdout?.trim();
  if (found.status !== 0 || !path) throw new Error(`找不到 ${tool}`);
  return path;
}

// ---------- 运行 ----------

interface Result {
  captions: Captions;
  style: StyleName;
  worker: string;
  profile: string;
  seconds: number;
  frames: number;
  wallSeconds: number;
  renderSeconds: number;
  /** 墙钟减去 Worker 自报的合成时间：读输入、预检、起解码与编码、收尾封装。 */
  overheadSeconds: number;
  msPerFrame: number;
  fps: number;
  decoderRestarts: number;
  outputBytes: number;
  loadBefore: number;
  loadAfter: number;
}

/** 跑一次 `export-worker render`。stdin 保持开着：Worker 把 stdin 关闭当作取消。 */
function render(
  worker: string,
  fixture: Fixture,
): Promise<{ done: any; wallSeconds: number }> {
  rmSync(fixture.outputFile, { force: true });
  return new Promise((resolvePromise, reject) => {
    const started = process.hrtime.bigint();
    const child = spawn(worker, ["render", fixture.inputFile], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.on("error", () => {});
    let buffer = "";
    let stderr = "";
    let final: any = null;
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      buffer += chunk;
      for (
        let newline = buffer.indexOf("\n");
        newline >= 0;
        newline = buffer.indexOf("\n")
      ) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try {
          const event = JSON.parse(line);
          if (event.event !== "progress") final = event;
        } catch {
          // 不是 JSON 的行忽略。
        }
      }
    });
    child.stderr
      .setEncoding("utf8")
      .on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const wallSeconds = Number(process.hrtime.bigint() - started) / 1e9;
      child.stdin.destroy();
      if (final?.event === "done") resolvePromise({ done: final, wallSeconds });
      else
        reject(
          new Error(
            `Worker 退出码 ${code}：${JSON.stringify(final)}\n${stderr.slice(-2000)}`,
          ),
        );
    });
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const round = (value: number, digits = 2) =>
  Math.round(value * 10 ** digits) / 10 ** digits;

function print(
  label: string,
  r: Pick<
    Result,
    | "wallSeconds"
    | "renderSeconds"
    | "overheadSeconds"
    | "frames"
    | "msPerFrame"
    | "fps"
  >,
  extra = "",
): void {
  console.log(
    `${label}: 墙钟 ${round(r.wallSeconds)} s · 合成 ${round(r.renderSeconds)} s · 其余 ${round(r.overheadSeconds)} s · ` +
      `${r.frames} 帧 · ${round(r.msPerFrame)} ms/帧 · ${round(r.fps, 1)} fps${extra}`,
  );
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const worker = findWorker(options.worker);
  const fixture = makeFixture(options.seconds, options.captions, options.style);
  const captionsLabel = {
    bilingual: "双语字幕",
    mono: "单语字幕",
    none: "不烧字幕",
  }[options.captions];
  console.log(
    `夹具：${WIDTH}×${HEIGHT} ${FPS} fps ${options.seconds} s，${captionsLabel}` +
      `${options.captions === "none" ? "" : `（${options.style}，${fixture.cues} 句）`}，目录 ${fixture.dir}`,
  );
  console.log(
    `Worker：${worker.path}（${worker.profile}），${cpus().length} 核 ${cpus()[0]?.model ?? ""}`,
  );
  const results: Result[] = [];
  try {
    for (let i = 0; i < options.runs; i++) {
      const loadBefore = loadavg()[0]!;
      const { done, wallSeconds } = await render(worker.path, fixture);
      const loadAfter = loadavg()[0]!;
      const frames = Number(done.frames);
      const renderSeconds = Number(done.renderSeconds);
      const result: Result = {
        captions: options.captions,
        style: options.style,
        worker: worker.path,
        profile: worker.profile,
        seconds: options.seconds,
        frames,
        wallSeconds,
        renderSeconds,
        overheadSeconds: wallSeconds - renderSeconds,
        msPerFrame: (renderSeconds * 1000) / frames,
        fps: frames / renderSeconds,
        decoderRestarts: Number(done.decoderRestarts),
        outputBytes: statSync(fixture.outputFile).size,
        loadBefore,
        loadAfter,
      };
      results.push(result);
      const skipped = (done.skipped ?? []).length;
      const warnings = (done.warnings ?? []).length + skipped;
      if (skipped)
        console.warn(
          `警告：Worker 跳过了字幕（样式没画出来）：${JSON.stringify(done.skipped)}`,
        );
      print(
        `第 ${i + 1} 次`,
        result,
        ` · 解码重开 ${result.decoderRestarts} 次 · 输出 ${round(result.outputBytes / 1e6, 1)} MB · ` +
          `负载 ${loadBefore.toFixed(1)}→${loadAfter.toFixed(1)}/${cpus().length}${warnings ? ` · 警告与跳过 ${warnings} 项` : ""}`,
      );
    }
    if (results.length > 1) {
      const pick = (key: keyof Result) => results.map((r) => r[key] as number);
      const summary = {
        wallSeconds: median(pick("wallSeconds")),
        renderSeconds: median(pick("renderSeconds")),
        overheadSeconds: median(pick("overheadSeconds")),
        frames: results[0]!.frames,
        msPerFrame: median(pick("msPerFrame")),
        fps: median(pick("fps")),
      };
      print(`中位数（${results.length} 次）`, summary);
      const best = results.reduce((a, b) =>
        b.renderSeconds < a.renderSeconds ? b : a,
      );
      print("最好的一次", best);
    }
    if (options.json)
      writeFileSync(
        options.json,
        JSON.stringify(
          { fixture: { ...options, cues: fixture.cues }, results },
          null,
          1,
        ),
      );
  } finally {
    if (options.keep) console.log(`保留夹具：${fixture.dir}`);
    else rmSync(fixture.dir, { recursive: true, force: true });
  }
}

await main();
