import { useCurrentFrame } from "@baocut/program";

// 加载期试渲能抓到的两类作者错误（`program_element.rs`）。

let calls = 0;

/** 组件改写模块顶层的 `let`：同一帧求值两次画出的宽度不同。 */
export function Stateful() {
  calls += 1;
  return <rect width={calls} height={4} fill="#fff" />;
}

/** 顶层只读常量表：同一帧求值多少次都一样。 */
const WIDTHS = [2, 4, 6, 8];
export function Pure() {
  const frame = useCurrentFrame();
  return <rect width={WIDTHS[frame % WIDTHS.length]} height={4} fill="#fff" />;
}

/** 字体库里没有的字族（名字里带数字的词，不加引号是非法的 CSS 标识符）：落到缺省无衬线字体。 */
export function UnknownFamily() {
  return (
    <svg width={48} height={24}>
      <rect width={48} height={24} fill="#000" />
      <text x={2} y={20} fontFamily="Nope 24pt" fontSize={22} fontWeight={700} fill="#fff">
        WW
      </text>
    </svg>
  );
}
