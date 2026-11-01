// BaoCut App 图标的绘制源码（矢量）：三条横向轨道拼成一个圆角播放键，一根带星芒的播放头把它切开，
// 每条轨道在切口两侧是深浅不同的两段片段。几何从 v2 原样移植；配色重做：
// 一块纯色品牌色底砖 + 白色图形 + 一档浅色片段，总共三种颜色（Spectrum 2 的「一个产品色，配深浅两档」）。
// 1024 设计单位，套 macOS 图标模板（824 主体、连续圆角、投影）。底砖颜色不随系统深浅色变化。
// 用法：import { svg, VARIANTS } from './app-icon.mjs'; svg(VARIANTS.coral)
// 设计思路见 docs/design/brand/app-icon.md。

const rad = (deg) => (deg * Math.PI) / 180;
const f = (n) => +n.toFixed(4);

// 模板：主体 824×824 落在 (100,100)，Figma 式连续圆角（半径 185.4、平滑 0.6），投影黑 30% / 模糊 20 / 下移 12。
export const BODY = { x: 100, y: 100, w: 824, h: 824, r: 185.4, smooth: 0.6 };

export const CORAL = '#FF5C4A'; // 品牌色：BaoCut 的珊瑚色
export const CORAL_DEEP = '#E8381F'; // 品牌色深档，只用在渐变变体
export const CORAL_TINT = '#FFC1B8'; // 品牌色浅档：播放头左侧「已播过」的片段，呼应 App 里播过的字幕变灰
export const INK = '#1F1F1F'; // 深底砖（备选）
export const WHITE = '#FFFFFF';

// 几何。三角左边 332、播放头 42%：图形的亮度质心正落在底砖中线（见 docs/design/brand/app-icon.md §4），
// 左段够宽才像片段，又避开上下轨道变窄的尖端。
export const GEOMETRY = {
  L: 332, // 三角左边
  W: 468, // 三角宽（左边到尖）
  H: 520, // 三角高
  yc: 576, // 尖所在的水平线
  gap: 22, // 轨道间缝
  rCorner: 48, // 左上、左下圆角
  rApex: 42, // 尖的圆角
  playhead: 0.42, // 播放头位置，占三角宽的比例；也是每条轨道左右两段的切口
  casing: 44, // 播放头两侧的缝总宽（露出底砖），同时是片段之间的缝
  line: 20, // 播放头线宽
  sparkR: 104, // 星芒半径
  sparkDy: -44, // 星芒中心相对三角顶边
};

// 配色变体。tile 是底砖（纯色或 [上, 下] 渐变）；left / right 是每条轨道切口两侧的片段色（左边是播过的，浅；右边是没播到的，实）；mark 是播放头与星芒。
export const VARIANTS = {
  // 定稿：珊瑚底砖，左侧已播片段浅珊瑚，右侧片段白；AI 元素（播放头 + 星芒）白色。
  coral: { id: 'coral', name: '珊瑚底砖', tile: CORAL, left: CORAL_TINT, right: WHITE, mark: WHITE },
  // 备选：深灰底砖，左侧已播片段白，右侧珊瑚；AI 元素白色。
  ink: { id: 'ink', name: '深色底砖', tile: INK, left: WHITE, right: CORAL, mark: WHITE },
  // 备选：单色相渐变底砖（Spectrum 2 的品牌渐变），其余同推荐。
  gradient: { id: 'gradient', name: '渐变底砖', tile: [CORAL, CORAL_DEEP], left: CORAL_TINT, right: WHITE, mark: WHITE },
};

export function squircleD(x, y, w, h, R, s) {
  const p = Math.min((1 + s) * R, Math.min(w, h) / 2);
  const arcMeasure = 90 * (1 - s);
  const L = Math.sin(rad(arcMeasure / 2)) * R * Math.SQRT2;
  const alpha = (90 - arcMeasure) / 2;
  const p34 = R * Math.tan(rad(alpha / 2));
  const beta = 45 * s;
  const c = p34 * Math.cos(rad(beta));
  const d = c * Math.tan(rad(beta));
  const b = (p - L - c - d) / 3;
  const a = 2 * b;
  return [
    `M ${f(x + w - p)} ${f(y)}`,
    `c ${f(a)} 0 ${f(a + b)} 0 ${f(a + b + c)} ${f(d)}`,
    `a ${f(R)} ${f(R)} 0 0 1 ${f(L)} ${f(L)}`,
    `c ${f(d)} ${f(c)} ${f(d)} ${f(b + c)} ${f(d)} ${f(a + b + c)}`,
    `L ${f(x + w)} ${f(y + h - p)}`,
    `c 0 ${f(a)} 0 ${f(a + b)} ${f(-d)} ${f(a + b + c)}`,
    `a ${f(R)} ${f(R)} 0 0 1 ${f(-L)} ${f(L)}`,
    `c ${f(-c)} ${f(d)} ${f(-(b + c))} ${f(d)} ${f(-(a + b + c))} ${f(d)}`,
    `L ${f(x + p)} ${f(y + h)}`,
    `c ${f(-a)} 0 ${f(-(a + b))} 0 ${f(-(a + b + c))} ${f(-d)}`,
    `a ${f(R)} ${f(R)} 0 0 1 ${f(-L)} ${f(-L)}`,
    `c ${f(-d)} ${f(-c)} ${f(-d)} ${f(-(b + c))} ${f(-d)} ${f(-(a + b + c))}`,
    `L ${f(x)} ${f(y + p)}`,
    `c 0 ${f(-a)} 0 ${f(-(a + b))} ${f(d)} ${f(-(a + b + c))}`,
    `a ${f(R)} ${f(R)} 0 0 1 ${f(L)} ${f(-L)}`,
    `c ${f(c)} ${f(-d)} ${f(b + c)} ${f(-d)} ${f(a + b + c)} ${f(-d)}`,
    'Z',
  ].join(' ');
}

// 多边形，每个顶点单独给圆角；相邻圆角的切线长加起来超过边长时按比例收小。
export function roundPolyD(pts, radii) {
  const n = pts.length;
  const geo = pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    const ax = a[0] - p[0],
      ay = a[1] - p[1],
      bx = b[0] - p[0],
      by = b[1] - p[1];
    const la = Math.hypot(ax, ay),
      lb = Math.hypot(bx, by);
    const th = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb))));
    return { ax: ax / la, ay: ay / la, bx: bx / lb, by: by / lb, lb, tan: Math.tan(th / 2) };
  });
  const t = geo.map((g, i) => radii[i] / g.tan);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const len = geo[i].lb;
    if (t[i] + t[j] > len) {
      const s = len / (t[i] + t[j]);
      t[i] *= s;
      t[j] *= s;
    }
  }
  const d = pts.map(([x, y], i) => {
    const g = geo[i];
    const sx = x + g.ax * t[i],
      sy = y + g.ay * t[i];
    const ex = x + g.bx * t[i],
      ey = y + g.by * t[i];
    const sweep = (x - sx) * (ey - y) - (y - sy) * (ex - x) > 0 ? 1 : 0;
    const r = f(t[i] * g.tan);
    return `${i === 0 ? 'M' : 'L'} ${f(sx)} ${f(sy)} A ${r} ${r} 0 0 ${sweep} ${f(ex)} ${f(ey)}`;
  });
  return `${d.join(' ')} Z`;
}

// 与 App 的 ai-sparkle 图标同一种四角星（控制点 ≈ 0.17r）。
export function sparkleD(cx, cy, r, k = 0.17) {
  const q = r * k;
  return [
    `M ${f(cx)} ${f(cy - r)}`,
    `Q ${f(cx + q)} ${f(cy - q)} ${f(cx + r)} ${f(cy)}`,
    `Q ${f(cx + q)} ${f(cy + q)} ${f(cx)} ${f(cy + r)}`,
    `Q ${f(cx - q)} ${f(cy + q)} ${f(cx - r)} ${f(cy)}`,
    `Q ${f(cx - q)} ${f(cy - q)} ${f(cx)} ${f(cy - r)}`,
    'Z',
  ].join(' ');
}

// 开发版标记：底砖下沿一条深色胶囊，里面「DEV」三个字母。字母用线段与圆弧画，不用 <text>，不依赖渲染机器的字体。
// 胶囊盖住三角下沿是有意的：开发版图标只要一眼和正式版区分开，Dock 里 64 px 也要能读出字。
export const BADGE = {
  y: 700, // 胶囊顶
  h: 200, // 胶囊高（两端全圆）
  w: 560, // 胶囊宽
  letterH: 116, // 字母高
  letterW: 88, // 字母宽
  letterGap: 52, // 字母间距
  stroke: 30, // 字母线宽
  fill: INK,
  ink: WHITE,
};

function badgeMarkup(o = BADGE) {
  const cx = 512;
  const x0 = cx - o.w / 2;
  const top = o.y + (o.h - o.letterH) / 2;
  const bottom = top + o.letterH;
  const mid = (top + bottom) / 2;
  const total = 3 * o.letterW + 2 * o.letterGap;
  let x = cx - total / 2;
  const step = o.letterW + o.letterGap;
  const r = o.letterH / 2;
  const w = o.letterW;
  const D = `M ${f(x)} ${f(top)} L ${f(x)} ${f(bottom)} L ${f(x + w - r)} ${f(bottom)} A ${f(r)} ${f(r)} 0 0 0 ${f(x + w - r)} ${f(top)} Z`;
  x += step;
  const E = `M ${f(x + w)} ${f(top)} L ${f(x)} ${f(top)} L ${f(x)} ${f(bottom)} L ${f(x + w)} ${f(bottom)} M ${f(x)} ${f(mid)} L ${f(x + w * 0.82)} ${f(mid)}`;
  x += step;
  const V = `M ${f(x)} ${f(top)} L ${f(x + w / 2)} ${f(bottom)} L ${f(x + w)} ${f(top)}`;
  return [
    `<rect x="${f(x0)}" y="${o.y}" width="${o.w}" height="${o.h}" rx="${f(o.h / 2)}" fill="${o.fill}"/>`,
    `<path d="${[D, E, V].join(' ')}" stroke="${o.ink}" stroke-width="${o.stroke}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  ].join('\n');
}

// 1024 画布的 SVG。shadow=false 时不画 macOS 模板投影（给 favicon、ICO 等自带容器的场合）；badge=true 加「DEV」开发版标记。
export function svg(variant = VARIANTS.coral, { shadow = true, badge = false, geometry = {} } = {}) {
  const o = { ...GEOMETRY, ...geometry };
  const y0 = o.yc - o.H / 2;
  const y1 = o.yc + o.H / 2;
  const n = 3;
  const h = (o.H - (n - 1) * o.gap) / n;
  const px = o.L + o.W * o.playhead;
  const sy = y0 + o.sparkDy;
  const body = squircleD(BODY.x, BODY.y, BODY.w, BODY.h, BODY.r, BODY.smooth);
  const tri = roundPolyD(
    [
      [o.L, y0],
      [o.L + o.W, o.yc],
      [o.L, y1],
    ],
    [o.rCorner, o.rApex, o.rCorner],
  );
  const gradient = Array.isArray(variant.tile);
  const tileFill = gradient ? 'url(#tile)' : variant.tile;
  const casingColor = gradient ? 'url(#tile)' : variant.tile;
  const rows = Array.from({ length: n }, (_, i) => {
    const top = f(y0 + i * (h + o.gap));
    return [
      `<rect x="${o.L - 20}" y="${top}" width="${f(px - (o.L - 20))}" height="${f(h)}" fill="${variant.left}"/>`,
      `<rect x="${f(px)}" y="${top}" width="${f(o.L + o.W + 20 - px)}" height="${f(h)}" fill="${variant.right}"/>`,
    ].join('');
  });
  const playhead = [
    [o.casing, casingColor],
    [o.line, variant.mark],
  ].map(
    ([width, color]) =>
      `<path d="M ${f(px)} ${f(sy + o.sparkR * 0.4)} L ${f(px)} ${f(y1)}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" fill="none"/>`,
  );
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">',
    '<defs>',
    gradient
      ? `<linearGradient id="tile" gradientUnits="userSpaceOnUse" x1="0" y1="${BODY.y}" x2="0" y2="${BODY.y + BODY.h}"><stop offset="0" stop-color="${variant.tile[0]}"/><stop offset="1" stop-color="${variant.tile[1]}"/></linearGradient>`
      : '',
    `<clipPath id="tri"><path d="${tri}"/></clipPath>`,
    shadow
      ? '<filter id="body-shadow" filterUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024"><feDropShadow dx="0" dy="12" stdDeviation="10" flood-color="#000000" flood-opacity="0.30"/></filter>'
      : '',
    '</defs>',
    `<path d="${body}" fill="${tileFill}"${shadow ? ' filter="url(#body-shadow)"' : ''}/>`,
    `<g clip-path="url(#tri)">${rows.join('')}</g>`,
    ...playhead,
    `<path d="${sparkleD(px, sy, o.sparkR)}" fill="${variant.mark}"/>`,
    badge ? badgeMarkup() : '',
    '</svg>',
    '',
  ]
    .filter(Boolean)
    .join('\n');
}

// macOS 菜单栏的模板图（技术方案 §15.2 托盘）：同一个图形的单色版，黑色画在透明底上，系统按菜单栏深浅染色，
// 和别的菜单栏图标一样是白（或黑）的。18 pt 里三条轨道的缝不到半个像素，所以三角画成实心；播放头两侧的缝与线宽
// 按小尺寸加粗，星芒外面留一圈空，和三角分开。画布是正方形，图形高占 92%。
export const TRAY = { casing: 120, line: 48, sparkHalo: 72, fill: 0.92 };

export function traySvg(o = { ...GEOMETRY, ...TRAY }) {
  const y0 = o.yc - o.H / 2;
  const y1 = o.yc + o.H / 2;
  const px = o.L + o.W * o.playhead;
  const sy = y0 + o.sparkDy;
  const top = sy - o.sparkR;
  // 尖的圆角把右边收进去约 rApex/2。
  const right = o.L + o.W - o.rApex / 2;
  const side = (y1 - top) / o.fill;
  const vx = (o.L + right) / 2 - side / 2;
  const vy = (top + y1) / 2 - side / 2;
  const tri = roundPolyD(
    [
      [o.L, y0],
      [o.L + o.W, o.yc],
      [o.L, y1],
    ],
    [o.rCorner, o.rApex, o.rCorner],
  );
  const spark = sparkleD(px, sy, o.sparkR);
  const head = `M ${f(px)} ${f(sy + o.sparkR * 0.4)} L ${f(px)} ${f(y1)}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="${f(vx)} ${f(vy)} ${f(side)} ${f(side)}">`,
    '<defs>',
    '<mask id="cut" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">',
    '<rect width="1024" height="1024" fill="#FFFFFF"/>',
    `<rect x="${f(px - o.casing / 2)}" y="0" width="${o.casing}" height="1024" fill="#000000"/>`,
    '</mask>',
    '<mask id="halo" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">',
    '<rect width="1024" height="1024" fill="#FFFFFF"/>',
    `<path d="${spark}" fill="#000000" stroke="#000000" stroke-width="${o.sparkHalo}" stroke-linejoin="round"/>`,
    '</mask>',
    '</defs>',
    '<g mask="url(#halo)">',
    `<path d="${tri}" fill="#000000" mask="url(#cut)"/>`,
    `<path d="${head}" stroke="#000000" stroke-width="${o.line}" stroke-linecap="round" fill="none"/>`,
    '</g>',
    `<path d="${spark}" fill="#000000"/>`,
    '</svg>',
    '',
  ].join('\n');
}
