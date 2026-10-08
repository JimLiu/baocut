/**
 * BaoCut 发布短片 —— BCF 编写层示例（React → JSON）。
 * 与 prototype/index.html 内嵌的参考文档逐值一致（build.ts 会做深度对比验证）。
 */
import { Box, Text, Svg, Path, Use, defineComponent, defineDoc, clip } from "./bcf.tsx";

/* ── 组件：符号 props 编译为 "$props.*" 绑定 ─────────────────────── */
const PainCard = defineComponent("PainCard", {
  doc: "痛点卡片：百分比 + 描述",
  props: { label: { type: "string" }, value: { type: "number" } },
  render: (p) => (
    <Box
      id="card"
      style={{
        width: 440, height: 300, layout: "column",
        align: "center", justify: "center", gap: 16,
        background: "$theme.color.panel", borderRadius: 24,
      }}
    >
      <Text
        id="value"
        text="0%"
        style={{ fontSize: 96, fontWeight: 700, color: "$theme.color.accent" }}
        animate={{ enter: { preset: "countUp", dur: 1.0, params: { to: p.value, suffix: "%" } } }}
      />
      <Text id="label" text={p.label} style={{ fontSize: 30, color: "$theme.color.inkSoft" }} />
    </Box>
  ),
});

const Bar = defineComponent("Bar", {
  doc: "柱状图单柱",
  props: { label: { type: "string" }, ratio: { type: "number" } },
  render: (p) => (
    <Box
      id="slot"
      style={{
        width: 200, height: 560, layout: "column",
        align: "center", justify: "end", gap: 14,
      }}
    >
      <Box
        id="bar"
        style={{
          width: 120, height: 480, borderRadius: 12,
          background: "$theme.color.accent",
          anchor: "bottom", scaleY: 0,
        }}
        animate={{ enter: { preset: "barFill", dur: 1.2, params: { to: p.ratio } } }}
      />
      <Text id="label" text={p.label} style={{ fontSize: 26, color: "$theme.color.inkSoft" }} />
    </Box>
  ),
});

/* ── Logo（两个 clip 复用同一 JSX 结构，参数化尺寸/时长） ────────── */
const LOGO_RING = "M60 8 A52 52 0 1 1 59.9 8";
const LOGO_B =
  "M46 38 V84 M46 38 H63 A11 11 0 0 1 63 60 H46 M46 60 H66 A12 12 0 0 1 66 84 H46";

function Logo({
  size, ringId, bId, ringDur, bDur, bDelay,
}: {
  size: number; ringId: string; bId: string; ringDur: number; bDur: number; bDelay: number;
}) {
  return (
    <Svg id="logo" viewBox="0 0 120 120" style={{ width: size, height: size }}>
      <Path
        id={ringId} d={LOGO_RING}
        stroke="$theme.color.accent" strokeWidth={6} fill="none"
        animate={{ enter: { preset: "draw", dur: ringDur } }}
      />
      <Path
        id={bId} d={LOGO_B}
        stroke="$theme.color.ink" strokeWidth={5} fill="none"
        animate={{ enter: { preset: "draw", dur: bDur, delay: bDelay } }}
      />
    </Svg>
  );
}

/* ── 文档 ────────────────────────────────────────────────────────── */
export default defineDoc({
  bcut: "0.2",
  meta: {
    id: "product-launch", title: "BaoCut 发布短片",
    width: 1920, height: 1080, fps: 30, background: "$theme.color.bg",
  },
  playback: { mode: "loop" },

  variables: [
    { id: "productName", type: "string", label: "产品名", default: "BaoCut" },
    { id: "accent", type: "color", label: "强调色", default: "#e8906a" },
    { id: "pains", type: "json", label: "痛点卡片", default: [
      { label: "剪一版要 3 天", value: 72 },
      { label: "改一稿要重渲", value: 45 },
      { label: "模板千篇一律", value: 89 } ] },
    { id: "growthBars", type: "json", label: "增长数据", default: [
      { label: "4月", ratio: 0.14 },
      { label: "5月", ratio: 0.43 },
      { label: "6月", ratio: 1.0 } ] },
  ],

  theme: {
    color: { bg: "#0b0b0e", ink: "#f6f4ef", inkSoft: "#a8a49c",
             panel: "#17171c", accent: "$vars.accent" },
    caption: {
      layout: { anchor: "bottom", offset: "7%", maxWidth: "84%", gap: 12 },
      lane: { fontSize: 30, color: "#f6f4ef", lineGap: 6, textAlign: "center" },
      fade: 0.18,
    },
  },

  presets: {
    rise: {
      doc: "入场：下方浮起+淡入",
      params: { distance: { type: "number", default: 28 } },
      keyframes: [
        { prop: "opacity", frames: [ { t: "0%", v: 0 }, { t: "100%", v: 1 } ] },
        { prop: "y", frames: [
          { t: "0%", v: "{distance}" },
          { t: "100%", v: 0, ease: "easeOutCubic" } ] } ],
    },
    draw: {
      doc: "绘制：描边生长",
      keyframes: [
        { prop: "pathDraw", frames: [
          { t: "0%", v: 0 }, { t: "100%", v: 1, ease: "easeInOutSine" } ] } ],
    },
    pop: {
      doc: "强调：弹性放大",
      params: { scale: { type: "number", default: 1.06 } },
      keyframes: [
        { prop: "scale", frames: [
          { t: "0%", v: 1 },
          { t: "55%", v: "{scale}", ease: "easeOutBack" },
          { t: "100%", v: 1, ease: "easeInOutQuad" } ] } ],
    },
  },

  scenes: [
    { id: "opening", name: "开场", dur: 3, desc: "Logo 描边生长，产品名浮起落定" },
    { id: "problem", name: "问题", dur: 5, desc: "三张痛点卡片错峰立起，数字滚动到位" },
    { id: "growth",  name: "增长", dur: 8, desc: "三根柱子依次生长，镜头推近，8× 弹出" },
    { id: "outro",   name: "收尾", dur: 4, desc: "回到 Logo 与口号，画面缓缓回正" },
  ],

  tracks: [
    {
      id: "main", kind: "visual",
      clips: [
        clip({
          id: "opening-shot",
          start: "@opening", end: "@opening.end",
          transitionOut: { preset: "crossfade", dur: 0.5 },
          element: (
            <Box
              id="stage"
              style={{ width: 1920, height: 1080, layout: "column",
                       align: "center", justify: "center", gap: 36 }}
            >
              <Logo size={170} ringId="logo-ring" bId="logo-b" ringDur={1.1} bDur={0.9} bDelay={0.5} />
              <Text
                id="title" text="$vars.productName"
                style={{ fontSize: 110, fontWeight: 700, color: "$theme.color.ink" }}
                animate={{ enter: { preset: "rise", dur: 0.6, delay: 0.9 } }}
              />
            </Box>
          ),
        }),
        clip({
          id: "problem-shot",
          start: "#opening-shot.end", end: "@problem.end",
          transitionIn: { preset: "crossfade", dur: 0.5 },
          transitionOut: { preset: "slideLeft", dur: 0.6 },
          element: (
            <Box id="stage" style={{ width: 1920, height: 1080 }}>
              <Text
                id="heading" text="做视频的三个瓶颈"
                style={{ x: 180, y: 150, fontSize: 64, fontWeight: 600, color: "$theme.color.ink" }}
                animate={{ enter: { preset: "rise", dur: 0.5, delay: 0.3 } }}
              />
              <Use
                id="pain-cards" component={PainCard} each="$vars.pains"
                layout={{ mode: "row", gap: 48, x: 180, y: 380 }}
                stagger={{ delay: 0.22 }}
                animate={{ enter: { preset: "rise", dur: 0.55, delay: 0.5, params: { distance: 48 } } }}
              />
            </Box>
          ),
        }),
        clip({
          id: "growth-shot",
          start: "@growth", end: "@growth.end",
          transitionIn: { preset: "slideLeft", dur: 0.6 },
          element: (
            <Box id="stage" style={{ width: 1920, height: 1080 }}>
              <Text
                id="heading" text="上线 90 天"
                style={{ x: 180, y: 140, fontSize: 64, fontWeight: 600, color: "$theme.color.ink" }}
                animate={{ keyframes: [
                  { prop: "x", frames: [
                    { t: "@growth-0.4", v: 60 },
                    { t: "@growth+0.6", v: 0, ease: "easeInOutCubic" } ] },
                  { prop: "opacity", frames: [
                    { t: "@growth-0.4", v: 0 },
                    { t: "@growth+0.4", v: 1 } ] } ] }}
              />
              <Use
                id="bars" component={Bar} each="$vars.growthBars"
                layout={{ mode: "row", gap: 90, x: 500, y: 300 }}
                stagger={{ delay: 0.35 }}
                animate={{ enter: { preset: "rise", dur: 0.4, delay: 0.4 } }}
              />
              <Text
                id="callout" text="8×"
                style={{ x: 1360, y: 300, fontSize: 150, fontWeight: 800,
                         color: "$theme.color.accent", opacity: 0 }}
                animate={{
                  keyframes: [
                    { prop: "opacity", frames: [
                      { t: "@growth.55%", v: 0 },
                      { t: "@growth.62%", v: 1, ease: "easeOutQuad" } ] } ],
                  emphasis: [
                    { preset: "pop", at: "@growth.70%", dur: 0.6, params: { scale: 1.14 } } ],
                }}
              />
            </Box>
          ),
        }),
        clip({
          id: "outro-shot",
          start: "@outro", end: "@outro.end",
          transitionIn: { preset: "crossfade", dur: 0.5 },
          element: (
            <Box
              id="stage"
              style={{ width: 1920, height: 1080, layout: "column",
                       align: "center", justify: "center", gap: 30 }}
            >
              <Logo size={130} ringId="logo-ring2" bId="logo-b2" ringDur={0.8} bDur={0.7} bDelay={0.3} />
              <Text
                id="slogan" text="让每一版剪辑，都只是一次重排"
                style={{ fontSize: 56, fontWeight: 600, color: "$theme.color.ink" }}
                animate={{ enter: { preset: "rise", dur: 0.6, delay: 0.35 } }}
              />
              <Text
                id="cta" text="baocut.app"
                style={{ fontSize: 30, color: "$theme.color.inkSoft" }}
                animate={{ enter: { preset: "rise", dur: 0.5, delay: 0.7 } }}
              />
            </Box>
          ),
        }),
      ],
    },

    {
      id: "camera", kind: "camera",
      clips: [
        { id: "cam-growth", start: "@growth+1.2", end: "@growth.end",
          camera: { keyframes: [
            { t: "0%",   v: { x: 0,   y: 0,  zoom: 1.0 } },
            { t: "55%",  v: { x: 260, y: 60, zoom: 1.45 }, ease: "easeInOutCubic" },
            { t: "100%", v: { x: 260, y: 60, zoom: 1.45 } } ] } },
        { id: "cam-outro", start: "@outro", end: "@outro.end",
          camera: { preset: "kenBurns", params: { fromZoom: 1.06, toZoom: 1.0 } } },
      ],
    },

    {
      id: "captions", kind: "captions",
      clips: [
        { id: "caps", start: 0, end: "@outro.end",
          layout: { anchor: "bottom", offset: "7%", maxWidth: "84%", gap: 12 },
          lanes: [
            { id: "zh", role: "source",
              style: { fontSize: 34, fontWeight: 600, color: "$theme.color.ink", lineGap: 6 },
              background: { mode: "text", color: "rgba(0,0,0,0.55)", padding: [4, 12], radius: 8 },
              highlight: { preset: "wordHighlight",
                           params: { color: "$theme.color.accent", transition: 0.1 } } },
            { id: "en", role: "translation",
              style: { fontSize: 26, color: "$theme.color.inkSoft", lineGap: 5 },
              animate: { enter: { preset: "rise", dur: 0.25, params: { distance: 10 } } } },
          ],
          captions: [
            { at: "@opening+0.6",
              lines: {
                zh: { text: "如果重剪只是一次重排" },
                en: { text: "What if a recut were just a reflow?" } } },
            { at: "@problem+0.4", until: "@problem.end-0.6",
              lines: {
                zh: { text: "三个瓶颈，一个答案" },
                en: { text: "Three bottlenecks, one answer." } } },
            { at: "@growth+1.4", until: "@growth+5.4",
              lines: {
                zh: { text: "90 天，翻了 8 倍",
                      words: [
                        { t: 0.00, text: "90" },
                        { t: 0.45, text: "天，" },
                        { t: 1.20, text: "翻了" },
                        { t: 1.75, text: "8" },
                        { t: 2.10, text: "倍" } ] },
                en: { text: "Ninety days. Eight times the growth." } } },
            { at: "@outro+0.5",
              lines: {
                zh: { text: "BaoCut，现已开放测试" },
                en: { text: "BaoCut — now in open beta." } } },
          ] },
      ],
    },
  ],
});
