import { describe, expect, it } from 'vitest';
import type { AssetRecord, AssetRevision, Place } from '@baocut/protocol';
import { assetLibrarySource } from './library-brand.ts';
import type { PlacedItem } from './stage-pose.ts';
import {
  BAR,
  OFF_REASON,
  TOOL_LABEL,
  barKindOf,
  brandTarget,
  captionCase,
  captionToolbar,
  itemAsset,
  nextCaptionCase,
  toolbarFor,
  toolbarPlacement,
  type MenuGroup,
  type Tool,
  type ToolbarSpec,
} from './stage-toolbar.ts';

const place: Place = { x: 50, y: 50, w: 10 };
const linear = { kind: 'linear', sourceIn: { ticks: '0', timescale: 1 }, rate: { num: 1, den: 1 } };
const text = (style: unknown = { fontSize: 40 }) => ({ id: 't', type: 'text', text: '标题', place, style }) as unknown as PlacedItem;
const video = (timeMap: unknown = linear) =>
  ({ id: 'v', type: 'video', mode: 'pip', place, assetRef: { id: 'asset_video', revision: 'r1' }, timeMap, embeddedAudio: { enabled: true, volume: 1 } }) as unknown as PlacedItem;
const image = () => ({ id: 'i', type: 'image', mode: 'pip', place }) as unknown as PlacedItem;
const shape = (value: unknown = { shape: 'rect', fill: '#3B63FB' }) =>
  ({ id: 's', type: 'shape', place, shape: value }) as unknown as PlacedItem;
const composition = (source: unknown) => ({ id: 'c', type: 'composition', place, source, timeMap: linear }) as unknown as PlacedItem;
/** 元素实例（贴纸、进度条、声波……）与带计时读数的文字。 */
const element = (type: string, more: Record<string, unknown> = {}) => ({ id: 'e', type, place, ...more }) as unknown as PlacedItem;
const sticker = () => element('sticker', { sticker: { source: 'template', templateId: 'heart' } });
const counter = () => element('text', { counter: { mode: 'countdown' }, style: {} });
/** 片段画的素材：缺省是收进视频目录的（存不进品牌库）。 */
const media = (kind: AssetRecord['kind'], patch: Partial<AssetRevision> = {}): AssetRecord => ({
  id: `asset_${kind}`,
  kind,
  name: '片头',
  currentRevision: 'r1',
  revisions: {
    r1: { revision: 'r1', contentHash: 'sha256:00', byteLength: 10, mediaType: 'image/png', storage: { mode: 'managed' }, provenance: { origin: 'import' }, ...patch },
  },
});
const linkedVideo = () => media('video', { storage: { mode: 'linked', locator: { path: '/Volumes/素材/片头.mp4' }, frozen: false } });

const ids = (groups: Tool[][]) => groups.map((g) => g.map((t) => t.id));
const menuIds = (more: MenuGroup[] | null) =>
  (more ?? []).map((g) => (g.kind === 'row' ? g.clusters.map((c) => c.map((t) => t.id)) : g.tools.map((t) => t.id)));
const allTools = (spec: ToolbarSpec): Tool[] => [...spec.visible.flat(), ...(spec.more ?? []).flatMap((g) => (g.kind === 'row' ? g.clusters.flat() : g.tools))];
const find = (spec: ToolbarSpec, id: string) => allTools(spec).find((t) => t.id === id);

const SAMPLES = [
  text(),
  video(),
  image(),
  shape(),
  sticker(),
  element('sticker', { assetRef: { id: 'lottie', revision: '1' }, sticker: { source: 'asset' } }),
  element('progress', { progress: { style: 'rounded' } }),
  element('visualizer', { visualizer: { style: 'bars' } }),
  counter(),
  element('confetti', { confetti: {} }),
  element('whiteboard', { whiteboard: {} }),
  composition({ kind: 'bundle', assetRef: { id: 'a', revision: 1 } }),
];

describe('按类型归类', () => {
  it('文字 / 视频 / 图片 / 图形 / 贴纸 / 进度 / 声波 / 计时 / 彩纸 / 白板各走自己的一条；代码包合成退回「其他」', () => {
    expect(SAMPLES.map(barKindOf)).toEqual([
      'text',
      'video',
      'image',
      'shape',
      'sticker',
      'sticker',
      'progress',
      'wave',
      'counter',
      'confetti',
      'whiteboard',
      'other',
    ]);
  });
});

describe('配置表照原型摆', () => {
  it('文字：条子是「颜色 字体 字号 │ 样式 动画」，菜单逐项照原型', () => {
    const spec = toolbarFor(text());
    expect(ids(spec.visible)).toEqual([
      ['color', 'font', 'size'],
      ['text-styles', 'animation'],
    ]);
    expect(menuIds(spec.more)).toEqual([
      [
        ['bold', 'italic'],
        ['align-left', 'align-center', 'align-right'],
      ],
      ['line-height', 'letter-spacing'],
      ['opacity'],
      ['copy', 'arrange', 'save-to-brand-kit'],
      ['properties'],
      ['adjust-timing', 'disable', 'delete'],
    ]);
  });

  it('视频：条子上有转场、音量、变速；菜单最后一段从调整时间到删除', () => {
    const spec = toolbarFor(video());
    expect(ids(spec.visible)).toEqual([
      ['animation', 'transitions'],
      ['volume', 'speed'],
    ]);
    expect(menuIds(spec.more).at(-1)).toEqual(['adjust-timing', 'crop-video', 'replace-video', 'detach-audio', 'save-to-brand-kit', 'delete']);
  });

  it('翻转与适应画布在图片、视频、图形、贴纸菜单的第一段：一行两簇', () => {
    for (const item of [image(), video(), shape(), sticker()]) {
      expect(menuIds(toolbarFor(item).more)[0]).toEqual([
        ['flip-vertical', 'flip-horizontal'],
        ['fit-canvas', 'fill-canvas'],
      ]);
    }
  });

  it('每一类的菜单最后一段都以删除收尾', () => {
    for (const item of SAMPLES.filter((i) => barKindOf(i) !== 'other')) {
      expect(menuIds(toolbarFor(item).more).at(-1)?.at(-1)).toBe('delete');
    }
  });

  it('「属性」只在文字、图形、贴纸、计时、彩纸、白板的菜单里', () => {
    const withProps = Object.entries(BAR)
      .filter(([, layout]) => (layout.more ?? []).some((g) => g.flat().includes('properties')))
      .map(([kind]) => kind)
      .sort();
    expect(withProps).toEqual(['confetti', 'counter', 'shape', 'sticker', 'text', 'whiteboard']);
  });

  it('条子上都没有「存到品牌库」', () => {
    for (const layout of Object.values(BAR)) expect(layout.visible.flat()).not.toContain('save-to-brand-kit');
  });

  it('彩纸与白板：条子上一颗「动画」，菜单是不透明度、复制 / 层级、属性、时长 / 停用 / 删除', () => {
    for (const item of [element('confetti', { confetti: {} }), element('whiteboard', { whiteboard: {} })]) {
      const spec = toolbarFor(item);
      expect(ids(spec.visible)).toEqual([['animation']]);
      expect(menuIds(spec.more)).toEqual([['opacity'], ['copy', 'arrange'], ['properties'], ['adjust-timing', 'disable', 'delete']]);
    }
  });

  it('认不出的合成只有一颗「属性」，菜单是通用的不透明度、复制 / 层级、时长 / 停用 / 删除', () => {
    const spec = toolbarFor(composition({ kind: 'bundle', assetRef: { id: 'a', revision: 1 } }));
    expect(ids(spec.visible)).toEqual([['properties']]);
    expect(menuIds(spec.more)).toEqual([['opacity'], ['copy', 'arrange'], ['adjust-timing', 'disable', 'delete']]);
    expect(spec.visible[0]![0]!.action).toEqual({ kind: 'jump', section: null });
  });
});

describe('每一格做什么', () => {
  it('每一格都有显示名；不能用的每一格都写了原因', () => {
    for (const item of SAMPLES) {
      for (const tool of allTools(toolbarFor(item))) {
        expect(tool.label).toBe(TOOL_LABEL[tool.id]);
        expect(tool.label.length).toBeGreaterThan(0);
        if (tool.action.kind === 'off') expect(tool.action.reason.length).toBeGreaterThan(0);
      }
    }
  });

  it('还接不上的几格不能用：动画、圆角（预览画不出）、滤镜、智能裁剪', () => {
    const spec = toolbarFor(video());
    for (const id of ['animation', 'round-corners', 'filters', 'crop-video']) {
      expect(find(spec, id)?.action.kind, id).toBe('off');
    }
  });

  it('替换视频 / 替换图片是命令（开替换窗口，只换这一段）', () => {
    expect(find(toolbarFor(video()), 'replace-video')?.action).toEqual({ kind: 'command' });
    expect(find(toolbarFor(image()), 'replace-image')?.action).toEqual({ kind: 'command' });
  });

  it('分离音频：素材有音轨且视频自带的声音开着时是命令，否则说没有声音', () => {
    const withSound = media('video', { audio: { sampleRate: 48000, channels: 2 } });
    const clip = video();
    expect(find(toolbarFor(clip, { asset: withSound }), 'detach-audio')?.action).toEqual({ kind: 'command' });
    expect(find(toolbarFor(clip, { asset: media('video') }), 'detach-audio')?.action).toEqual({ kind: 'off', reason: OFF_REASON.sound });
    const muted = { ...clip, embeddedAudio: { enabled: false, volume: 1 } } as PlacedItem;
    expect(find(toolbarFor(muted, { asset: withSound }), 'detach-audio')?.action).toEqual({ kind: 'off', reason: OFF_REASON.sound });
  });

  // BaoCut v2 已上线的条子（stage-toolbar.logic.ts 的 MEDIA_MORE / PLAIN_MORE）：除视频外每一类的菜单都有不透明度与「隐藏」。
  it('对照 v2：除视频外每一类的菜单里都有不透明度（下钻）与停用片段（命令，删除前一格）', () => {
    for (const item of SAMPLES) {
      const spec = toolbarFor(item);
      const kind = barKindOf(item);
      const last = menuIds(spec.more).at(-1) as string[];
      if (kind === 'video') {
        expect(find(spec, 'disable'), kind).toBeUndefined();
        continue;
      }
      expect(find(spec, 'opacity')?.action, kind).toEqual({ kind: 'sub' });
      expect(find(spec, 'disable')?.action, kind).toEqual({ kind: 'command' });
      expect(last.slice(-2), kind).toEqual(['disable', 'delete']);
    }
  });

  it('「层级」在每一类画面元素的菜单里都下钻一层（四个方向）', () => {
    for (const item of SAMPLES) {
      const spec = toolbarFor(item);
      expect(find(spec, 'arrange')?.action, item.type).toEqual({ kind: 'sub' });
    }
  });

  it('文字：颜色字体字号开弹层，B / I / 对齐是开关，行高字距下钻，样式跳到属性页「样式」一节', () => {
    const spec = toolbarFor(text());
    expect(find(spec, 'color')?.action).toEqual({ kind: 'pop' });
    expect(find(spec, 'font')?.action).toEqual({ kind: 'pop' });
    expect(find(spec, 'bold')?.action).toEqual({ kind: 'toggle' });
    expect(find(spec, 'line-height')?.action).toEqual({ kind: 'sub' });
    expect(find(spec, 'text-styles')?.action).toEqual({ kind: 'jump', section: 'style' });
    expect(find(spec, 'copy')?.action).toEqual({ kind: 'command' });
    expect(find(spec, 'delete')?.action).toEqual({ kind: 'command' });
  });

  it('样式认不出的文字：改字的几格都不能用，说出样式名', () => {
    const spec = toolbarFor(text({ schema: 'baocut.text-style/v2' }));
    for (const id of ['color', 'font', 'size', 'bold', 'line-height', 'text-styles']) {
      const action = find(spec, id)?.action;
      expect(action?.kind, id).toBe('off');
      expect(action?.kind === 'off' && action.reason).toContain('baocut.text-style/v2');
    }
  });

  it('视频：转场与效果跳到属性页对应一节；时间映射不是恒速时变速不能用', () => {
    const spec = toolbarFor(video());
    expect(find(spec, 'transitions')?.action).toEqual({ kind: 'jump', section: 'transition' });
    expect(find(spec, 'effects')?.action).toEqual({ kind: 'jump', section: 'effects' });
    expect(find(spec, 'speed')?.action).toEqual({ kind: 'pop' });
    expect(find(spec, 'volume')?.action).toEqual({ kind: 'pop' });
    expect(find(toolbarFor(video({ kind: 'hold', sourceAt: { ticks: '0', timescale: 1 } })), 'speed')?.action.kind).toBe('off');
  });

  it('元素的参数格（填充色、样式、模式、计时的颜色字体）跳到属性页页首', () => {
    expect(find(toolbarFor(sticker()), 'fill-list')?.action).toEqual({ kind: 'jump', section: null });
    expect(find(toolbarFor(element('progress', { progress: { style: 'rounded' } })), 'progress-picker')?.action).toEqual({
      kind: 'jump',
      section: null,
    });
    const spec = toolbarFor(counter());
    expect(find(spec, 'counter-mode')?.action).toEqual({ kind: 'jump', section: null });
    expect(find(spec, 'color')?.action).toEqual({ kind: 'jump', section: null });
    expect(find(spec, 'bold')?.action).toEqual({ kind: 'jump', section: null });
  });

  it('存到品牌库：文字说的是品牌库还没有文字样式一栏；视频、图片取得到素材的原文件才能存', () => {
    expect(find(toolbarFor(text()), 'save-to-brand-kit')?.action).toEqual({ kind: 'off', reason: OFF_REASON.brandText });
    expect(find(toolbarFor(video()), 'save-to-brand-kit')?.action).toEqual({ kind: 'off', reason: OFF_REASON.brand });
    expect(find(toolbarFor(video(), { asset: media('audio') }), 'save-to-brand-kit')?.action).toEqual({ kind: 'off', reason: OFF_REASON.brand });
    expect(find(toolbarFor(video(), { asset: linkedVideo() }), 'save-to-brand-kit')?.action).toEqual({ kind: 'command' });
    const generated = media('image', { provenance: { origin: 'generated', source: { artifactId: 'sha256:ab' } } });
    expect(find(toolbarFor(image(), { asset: generated }), 'save-to-brand-kit')?.action).toEqual({ kind: 'command' });
    const embedded = media('image');
    const found = assetLibrarySource(embedded);
    expect(find(toolbarFor(image(), { asset: embedded }), 'save-to-brand-kit')?.action).toEqual({ kind: 'off', reason: 'reason' in found ? found.reason : '' });
  });

  it('浏览器里存不了品牌库（Web 服务不放行 library.*）：素材片段与字幕都说明在哪能用；文字仍说没有文字样式一栏', () => {
    const web = { kind: 'off', reason: OFF_REASON.brandWeb };
    expect(find(toolbarFor(video(), { asset: linkedVideo(), web: true }), 'save-to-brand-kit')?.action).toEqual(web);
    expect(find(captionToolbar({ paired: false, styled: true, web: true }), 'save-to-brand-kit')?.action).toEqual(web);
    expect(find(toolbarFor(text(), { web: true }), 'save-to-brand-kit')?.action).toEqual({ kind: 'off', reason: OFF_REASON.brandText });
  });

  it('按下去存的就是条子上判过的那一节与来源', () => {
    const asset = linkedVideo();
    const item = { ...video(), assetRef: { id: asset.id, revision: 'r1' } } as unknown as PlacedItem;
    expect(itemAsset(item, { [asset.id]: asset })).toBe(asset);
    expect(itemAsset(shape(), { [asset.id]: asset })).toBeUndefined();
    expect(brandTarget(asset)).toEqual({ kind: 'video', source: { path: '/Volumes/素材/片头.mp4' } });
    expect(brandTarget(undefined)).toEqual({ reason: OFF_REASON.brand });
  });

  it('图形：颜色与描边开弹层；图形参数是固定字段，哪种图形都能改', () => {
    expect(find(toolbarFor(shape()), 'border')?.action).toEqual({ kind: 'pop' });
    expect(find(toolbarFor(shape({ shape: 'star', fill: '#FF0000' })), 'color')?.action).toEqual({ kind: 'pop' });
  });
});

describe('字幕的工具条', () => {
  it('双语：条子是「原文 | 译文 │ 颜色 字体 字号 │ 编辑 样式 动画」，菜单照原型', () => {
    const spec = captionToolbar({ paired: true, styled: true });
    expect(spec.kind).toBe('subtitle');
    expect(ids(spec.visible)).toEqual([['sub-scope'], ['color', 'font', 'size'], ['sub-edit', 'sub-style', 'sub-animation']]);
    expect(menuIds(spec.more)).toEqual([
      [
        ['bold', 'italic'],
        ['align-left', 'align-center', 'align-right', 'case'],
      ],
      ['line-height', 'letter-spacing'],
      ['save-to-brand-kit', 'hide-subs'],
    ]);
  });

  it('只有一种行时没有「原文 | 译文」那一段', () => {
    expect(ids(captionToolbar({ paired: false, styled: true }).visible)).toEqual([
      ['color', 'font', 'size'],
      ['sub-edit', 'sub-style', 'sub-animation'],
    ]);
  });

  it('没有删除，也没有格式里不存在的「这一句 / 全部」与「套用到全局」', () => {
    const tools = allTools(captionToolbar({ paired: true, styled: true })).map((t) => t.id as string);
    for (const id of ['delete', 'sub-cue-scope', 'apply-style-to-global']) expect(tools).not.toContain(id);
  });

  it('颜色字体字号开弹层，B / I / 对齐是开关，行高字距下钻，动画打开属性页的「当前词」', () => {
    const spec = captionToolbar({ paired: true, styled: true });
    expect(find(spec, 'color')?.action).toEqual({ kind: 'pop' });
    expect(find(spec, 'size')?.action).toEqual({ kind: 'pop' });
    expect(find(spec, 'italic')?.action).toEqual({ kind: 'toggle' });
    expect(find(spec, 'align-right')?.action).toEqual({ kind: 'toggle' });
    expect(find(spec, 'letter-spacing')?.action).toEqual({ kind: 'sub' });
    expect(find(spec, 'sub-edit')?.action).toEqual({ kind: 'command' });
    expect(find(spec, 'hide-subs')?.action).toEqual({ kind: 'command' });
    expect(find(spec, 'sub-animation')?.action).toEqual({ kind: 'command' });
    for (const tool of allTools(spec)) {
      expect(tool.label).toBe(TOOL_LABEL[tool.id]);
      expect(tool.label.length).toBeGreaterThan(0);
    }
  });

  it('还在用缺省样式时存不了品牌库；有样式文档就能存', () => {
    expect(find(captionToolbar({ paired: false, styled: false }), 'save-to-brand-kit')?.action).toEqual({
      kind: 'off',
      reason: OFF_REASON.captionDefaultStyle,
    });
    expect(find(captionToolbar({ paired: false, styled: true }), 'save-to-brand-kit')?.action).toEqual({ kind: 'command' });
  });

  it('大小写按「原样 → 全大写 → 首字母大写 → 全小写」轮换；capitalize 算首字母大写', () => {
    expect(captionCase(undefined)).toBe('none');
    expect(captionCase('capitalize')).toBe('title');
    expect(nextCaptionCase(undefined)).toBe('uppercase');
    expect(nextCaptionCase('uppercase')).toBe('title');
    expect(nextCaptionCase('capitalize')).toBe('lowercase');
    expect(nextCaptionCase('lowercase')).toBe('none');
  });
});

describe('落位', () => {
  const area = { w: 800, h: 450 };
  const bar = { w: 200, h: 30 };

  it('先放选框上方 12px，横向对着选框居中', () => {
    expect(toolbarPlacement({ x: 300, y: 200, w: 200, h: 100 }, area, bar, false)).toEqual({ left: 300, top: 158, below: false, maxWidth: 784 });
  });

  it('有旋转钮时抬到 50px 跨过它', () => {
    expect(toolbarPlacement({ x: 300, y: 200, w: 200, h: 100 }, area, bar, true).top).toBe(120);
  });

  it('上方贴着舞台顶就翻到下方；下方也放不下就夹在底边以内', () => {
    expect(toolbarPlacement({ x: 300, y: 20, w: 200, h: 100 }, area, bar, false)).toMatchObject({ top: 132, below: true });
    expect(toolbarPlacement({ x: 300, y: 10, w: 200, h: 430 }, area, bar, false)).toMatchObject({ top: 412, below: true });
  });

  it('横向夹在舞台里；舞台比条子窄时给出最大宽度', () => {
    expect(toolbarPlacement({ x: -50, y: 200, w: 100, h: 50 }, area, bar, false).left).toBe(8);
    expect(toolbarPlacement({ x: 760, y: 200, w: 100, h: 50 }, area, bar, false).left).toBe(592);
    expect(toolbarPlacement({ x: 10, y: 200, w: 100, h: 50 }, { w: 160, h: 450 }, bar, false)).toMatchObject({ left: 8, maxWidth: 144 });
  });
});
