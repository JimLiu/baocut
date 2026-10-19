/**
 * BaoCut: 随包的图标字体（slides-runtime 的 anthropicons-fizzy-lake.woff2）是 215 个码位的子集，名字表的 369 个名字里
 * 缺 170 个，这些图标原本是空的。这里只兜底独立页面上用户看得到的 13 个：有原版画法的照画 SVG，画法抄自编辑器
 * iframe 运行时（`prose-editor/runtime.tsx`）里同名的路径对象；其余换成字体里有的近似字形。换字体时要重新核对这张表。
 */
import type * as ReactComponentTypes from "react";

type GlyphPrimitive =
  | { d: string }
  | { x1: number; y1: number; x2: number; y2: number }
  | { cx: number; cy: number; r: number };

export interface GlyphDrawing {
  master16: readonly GlyphPrimitive[];
  master20: readonly GlyphPrimitive[];
}

/** 缺字形的名字 → 字体里有的近似字形。 */
export const MISSING_GLYPH_ALIASES: Readonly<Record<string, string>> = {
  ArrowSplitRight: `SideRight`,
  CloudSlash: `WarningCircle`,
  Disconnect: `X`,
  History: `Clock`,
  Pin: `MapPin`,
  Plugin: `Connectors`,
};

const headingBars16: readonly GlyphPrimitive[] = [
  { x1: 2.5, y1: 3.5, x2: 2.5, y2: 12.5 },
  { x1: 8.5, y1: 3.5, x2: 8.5, y2: 12.5 },
  { x1: 2.5, y1: 8, x2: 8.5, y2: 8 },
];

const headingBars20: readonly GlyphPrimitive[] = [
  { x1: 3.5, y1: 4.5, x2: 3.5, y2: 15.5 },
  { x1: 10.5, y1: 4.5, x2: 10.5, y2: 15.5 },
  { x1: 10.5, y1: 10, x2: 3.5, y2: 10 },
];

// runtime.tsx 的 DocumentInteractionsMaster1610。
const smiley: GlyphDrawing = {
  master16: [
    { d: `M5.5 9C5.864 10.02 6.846 10.75 8 10.75C9.154 10.75 10.136 10.02 10.5 9` },
    { cx: 8, cy: 8, r: 5.5 },
    { cx: 6, cy: 6.5, r: 0.25 },
    { cx: 10, cy: 6.5, r: 0.25 },
  ],
  master20: [
    { d: `M7.171 11.5C7.583 12.665 8.694 13.5 10 13.5C11.306 13.5 12.418 12.665 12.829 11.5` },
    { cx: 10, cy: 10, r: 7 },
    { cx: 7.5, cy: 8.625, r: 0.275 },
    { cx: 12.5, cy: 8.625, r: 0.275 },
  ],
};

/** 缺字形的名字 → 原版画法（16 格与 20 格两套）。 */
export const MISSING_GLYPH_DRAWINGS: Readonly<Record<string, GlyphDrawing>> = {
  // runtime.tsx 的 EditorSelectionAndTablesMaster163（主页面侧 selection-and-tables-3.ts 同名对象相同）。
  Calendar: {
    master16: [
      {
        d: `M10.5 1.5L10.5 3.5L12.5 3.5C13.052 3.5 13.5 3.948 13.5 4.5L13.5 11.5C13.5 12.052 13.052 12.5 12.5 12.5L3.5 12.5C2.948 12.5 2.5 12.052 2.5 11.5L2.5 4.5C2.5 3.948 2.948 3.5 3.5 3.5L5.5 3.5L10.5 3.5L10.5 4.5M5.5 1.5L5.5 3.5L5.5 4.5`,
      },
    ],
    master20: [
      { x1: 3.5, y1: 8.5, x2: 16.5, y2: 8.5 },
      { x1: 6.5, y1: 3, x2: 6.5, y2: 6 },
      { x1: 13.5, y1: 3, x2: 13.5, y2: 6 },
      {
        d: `M3.5 5.5L3.5 15.5C3.5 16.052 3.948 16.5 4.5 16.5L15.5 16.5C16.052 16.5 16.5 16.052 16.5 15.5L16.5 5.5C16.5 4.947 16.052 4.5 15.5 4.5L4.5 4.5C3.948 4.5 3.5 4.947 3.5 5.5Z`,
      },
    ],
  },
  // runtime.tsx 的 EditorSelectionAndTablesMaster1611（主页面侧 selection-and-tables-3.ts 同名对象相同）。
  Dropdown: {
    master16: [
      {
        d: `M12.75 3.5L3.25 3.5C2.836 3.5 2.5 3.836 2.5 4.25L2.5 11.75C2.5 12.164 2.836 12.5 3.25 12.5L12.75 12.5C13.164 12.5 13.5 12.164 13.5 11.75L13.5 4.25C13.5 3.836 13.164 3.5 12.75 3.5Z`,
      },
      { d: `M11 7.25L9 9.25L7 7.25` },
    ],
    master20: [
      {
        d: `M16.5 4.5L3.5 4.5C2.948 4.5 2.5 4.948 2.5 5.5L2.5 14.5C2.5 15.052 2.948 15.5 3.5 15.5L16.5 15.5C17.052 15.5 17.5 15.052 17.5 14.5L17.5 5.5C17.5 4.948 17.052 4.5 16.5 4.5Z`,
      },
      { d: `M14.5 9L12 11.5L9.5 9` },
    ],
  },
  // runtime.tsx 的 DocumentInteractionsMaster1616／1617／1618。
  Heading1: {
    master16: [...headingBars16, { d: `M10.5 12.5L13.5 12.5M12 12.5L12 6.5L10.5 7.5` }],
    master20: [...headingBars20, { d: `M15.5 15.5L15.5 7.5L13.25 9.5M13.25 15.5L17.75 15.5` }],
  },
  Heading2: {
    master16: [
      ...headingBars16,
      {
        d: `M10.5 8C10.5 7.172 11.172 6.5 12 6.5C12.828 6.5 13.5 7.172 13.5 8L13.5 8.329C13.5 9.017 13.032 9.617 12.364 9.784L11.636 9.966C10.968 10.133 10.5 10.733 10.5 11.421L10.5 12.5L13.5 12.5`,
      },
    ],
    master20: [
      ...headingBars20,
      {
        d: `M13.5 9.5C13.5 8.395 14.395 7.5 15.5 7.5C16.605 7.5 17.5 8.395 17.5 9.5L17.5 9.938C17.5 10.856 16.875 11.656 15.985 11.879L15.015 12.121C14.125 12.344 13.5 13.144 13.5 14.062L13.5 15.5L17.5 15.5`,
      },
    ],
  },
  Heading3: {
    master16: [
      ...headingBars16,
      {
        d: `M12 9.5L11.625 9.5M12 9.5C12.828 9.5 13.5 8.828 13.5 8C13.5 7.172 12.828 6.5 12 6.5C11.172 6.5 10.5 7.172 10.5 8M12 9.5C12.828 9.5 13.5 10.172 13.5 11C13.5 11.828 12.828 12.5 12 12.5C11.172 12.5 10.5 11.828 10.5 11`,
      },
    ],
    master20: [
      ...headingBars20,
      {
        d: `M15.5 11.5L15 11.5M15.5 11.5C16.605 11.5 17.5 10.605 17.5 9.5C17.5 8.395 16.605 7.5 15.5 7.5C14.395 7.5 13.5 8.395 13.5 9.5M15.5 11.5C16.605 11.5 17.5 12.395 17.5 13.5C17.5 14.605 16.605 15.5 15.5 15.5C14.395 15.5 13.5 14.605 13.5 13.5`,
      },
    ],
  },
  Smiley: smiley,
  // 原版没有随包的画法，借用 Smiley。
  SmileyAdd: smiley,
};

/**
 * 按字体图标的尺寸画兜底 SVG：`px` 不超过 18 用 16 格，否则用 20 格（同 iframe 运行时，缺一套时用另一套）；
 * `strokePx` 是该尺寸字体图标的线宽，换算成格子单位，随字号缩放。
 */
export const MissingGlyphSvg: ReactComponentTypes.FC<
  ReactComponentTypes.SVGProps<SVGSVGElement> & {
    drawing: GlyphDrawing;
    px: number;
    strokePx: number;
  }
> = ({ drawing, px, strokePx, ...svgProps }) => {
  let grid = px <= 18 ? 16 : 20;
  if ((grid === 16 ? drawing.master16 : drawing.master20).length === 0)
    grid = grid === 16 ? 20 : 16;
  const primitives = grid === 16 ? drawing.master16 : drawing.master20;
  return (
    <svg
      width={`1em`}
      height={`1em`}
      viewBox={`0 0 ${grid} ${grid}`}
      fill={`none`}
      stroke={`currentColor`}
      strokeWidth={Math.round(((strokePx * grid) / px) * 1000) / 1000}
      strokeLinecap={`round`}
      strokeLinejoin={`round`}
      xmlns={`http://www.w3.org/2000/svg`}
      {...svgProps}
    >
      {primitives.map((primitive, index) =>
        `d` in primitive ? (
          <path d={primitive.d} key={index} />
        ) : `x1` in primitive ? (
          <line
            x1={primitive.x1}
            y1={primitive.y1}
            x2={primitive.x2}
            y2={primitive.y2}
            key={index}
          />
        ) : (
          <circle cx={primitive.cx} cy={primitive.cy} r={primitive.r} key={index} />
        ),
      )}
    </svg>
  );
};
