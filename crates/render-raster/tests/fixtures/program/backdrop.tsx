import { useCurrentFrame } from "@baocut/program";

/** 1 px 黑白竖条纹铺满 64×32。 */
function Stripes() {
  return (
    <svg width={64} height={32} style={{ position: "absolute", left: 0, top: 0 }}>
      <rect width={64} height={32} fill="#000" />
      {Array.from({ length: 32 }, (_, i) => (
        <rect x={i * 2} width={1} height={32} fill="#fff" />
      ))}
    </svg>
  );
}

/**
 * 左半：flex 居中 → `transform: scale(0.5)` → `overflow: hidden` → `backdropFilter`，盒子落在
 * (8..24, 8..24)，里面的条纹被抹成灰。右半：同样的盒子，但父级 `opacity < 1` 是 backdrop root，
 * 父级里在它之前什么都没画，所以盒子里仍是清晰的条纹。
 */
export function Backdrop() {
  const glass = { position: "absolute", left: 0, top: 0, width: 32, height: 32, backdropFilter: "blur(4px)" };
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: 64, height: 32 }}>
      <Stripes />
      <div style={{ position: "absolute", left: 0, top: 0, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 32, height: 32, transform: "scale(0.5)", overflow: "hidden" }}>
          <div style={glass} />
        </div>
      </div>
      <div style={{ position: "absolute", left: 32, top: 0, width: 32, height: 32, opacity: 0.999 }}>
        <div style={{ position: "absolute", left: 8, top: 8, width: 16, height: 16, backdropFilter: "blur(4px)" }} />
      </div>
    </div>
  );
}

/** flex 居中一个只写了 width / height 属性的 <svg>：50×50 落在 88×88 的正中（19..69）。 */
export function FlexIcon() {
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: 88, height: 88, background: "#203040", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg width={50} height={50}>
        <rect width={50} height={50} fill="#e02020" />
      </svg>
    </div>
  );
}

/** 第 5 帧起才用到画不出来的 CSS，并写一个任何字体都没有的字符（U+10FFFD）。 */
export function Late() {
  const frame = useCurrentFrame();
  if (frame < 5) return <rect width={16} height={16} fill="#102030" />;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: 16, height: 16, background: "#102030", textShadow: "0 0 2px #000" }}>
      <svg width={16} height={16}>
        <text x={2} y={12} fontFamily="Arimo" fontSize={10} fill="#fff">{"\u{10FFFD}"}</text>
      </svg>
    </div>
  );
}
