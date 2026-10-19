import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hostPanelTab, PANEL_WIDTH_DEFAULT, PANEL_WIDTH_MAX, useEditor, ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN } from './editor-store.ts';

// Node 里没有可用的 localStorage：给持久化一个内存版本，先于 store 模块加载。
vi.hoisted(() => {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
  });
});

describe('编辑器右侧面板', () => {
  beforeEach(() => useEditor.setState({ panelTab: 'video', panelWidth: PANEL_WIDTH_DEFAULT, panelHidden: false }));

  it('点工具栏换页并展开；传 null 收起，页留着', () => {
    useEditor.getState().showPanel(null);
    expect(useEditor.getState()).toMatchObject({ panelTab: 'video', panelHidden: true });
    useEditor.getState().showPanel('props');
    expect(useEditor.getState()).toMatchObject({ panelTab: 'props', panelHidden: false });
  });

  it('换到另一个视频时落到给的页；同一个视频重开不动用户切过的页', () => {
    useEditor.setState({ videoId: null });
    useEditor.getState().attach('v1', 'transcript');
    expect(useEditor.getState()).toMatchObject({ videoId: 'v1', panelTab: 'transcript' });
    useEditor.getState().showPanel('audio');
    useEditor.getState().attach('v1', 'transcript');
    expect(useEditor.getState().panelTab).toBe('audio');
    useEditor.getState().attach('v2');
    expect(useEditor.getState()).toMatchObject({ videoId: 'v2', panelTab: 'audio' });
  });

  it('舞台工具条的观看态（倍速、字幕隐藏、安全区）换视频时复位，同一个视频重开不动', () => {
    useEditor.setState({ videoId: null });
    useEditor.getState().attach('v1');
    useEditor.getState().setRate(1.5);
    useEditor.getState().setCaptionsHidden(true);
    useEditor.getState().setSafeArea(true);
    useEditor.getState().attach('v1');
    expect(useEditor.getState()).toMatchObject({ rate: 1.5, captionsHidden: true, safeArea: true });
    useEditor.getState().attach('v2');
    expect(useEditor.getState()).toMatchObject({ rate: 1, captionsHidden: false, safeArea: false });
  });

  it('轻量视图的图层开关：按种类藏字幕与 captionsHidden 双向对齐，配乐单独记；换视频时复位', () => {
    const both = ['original', 'translation'] as const;
    useEditor.setState({ videoId: null });
    useEditor.getState().attach('v1');
    const { setCaptionLayerHidden, setCaptionsHidden, setMusicHidden } = useEditor.getState();
    setCaptionLayerHidden('translation', true, both);
    expect(useEditor.getState()).toMatchObject({ captionsHidden: false, captionLayersHidden: { original: false, translation: true } });
    setCaptionLayerHidden('original', true, both);
    expect(useEditor.getState()).toMatchObject({ captionsHidden: true, captionLayersHidden: { original: true, translation: true } });
    // 从全藏里打开一种：只露这一种。
    setCaptionLayerHidden('translation', false, both);
    expect(useEditor.getState()).toMatchObject({ captionsHidden: false, captionLayersHidden: { original: true, translation: false } });
    // 时间线视图的字幕钮（与舞台字幕条的「隐藏」）全开全关，按种类的跟着走。
    setCaptionsHidden(false);
    expect(useEditor.getState().captionLayersHidden).toEqual({ original: false, translation: false });
    setCaptionsHidden(true);
    expect(useEditor.getState().captionLayersHidden).toEqual({ original: true, translation: true });
    setCaptionsHidden(false);
    // 只有原文的视频：关掉原文就是全藏。
    setCaptionLayerHidden('original', true, ['original']);
    expect(useEditor.getState().captionsHidden).toBe(true);
    setMusicHidden(true);
    useEditor.getState().attach('v1');
    expect(useEditor.getState()).toMatchObject({ captionsHidden: true, musicHidden: true });
    useEditor.getState().attach('v2');
    expect(useEditor.getState()).toMatchObject({
      captionsHidden: false,
      captionLayersHidden: { original: false, translation: false },
      musicHidden: false,
    });
  });

  it('拖缝：宽度钳在上限内；拖到收起线以下就收起，记住的宽度不变', () => {
    useEditor.getState().dragPanel(420.4);
    expect(useEditor.getState().panelWidth).toBe(420);
    useEditor.getState().dragPanel(900);
    expect(useEditor.getState().panelWidth).toBe(PANEL_WIDTH_MAX);
    useEditor.getState().dragPanel(320);
    expect(useEditor.getState()).toMatchObject({ panelWidth: PANEL_WIDTH_MAX, panelHidden: true });
    useEditor.getState().showPanel('audio');
    expect(useEditor.getState()).toMatchObject({ panelTab: 'audio', panelWidth: PANEL_WIDTH_MAX, panelHidden: false });
  });
});

describe('网页宿主上的面板页', () => {
  it('记着的是 AI 工具时落回文稿；桌面端照旧', () => {
    expect(hostPanelTab('aitools', true)).toBe('transcript');
    expect(hostPanelTab('aitools', false)).toBe('aitools');
    expect(hostPanelTab('subtitle', true)).toBe('subtitle');
  });
});

describe('时间线缩放的下限', () => {
  beforeEach(() => useEditor.setState({ pxPerSecond: ZOOM_DEFAULT, zoomFloor: ZOOM_MIN }));

  it('短视频夹在 [ZOOM_MIN, ZOOM_MAX]', () => {
    useEditor.getState().setZoom(0.5);
    expect(useEditor.getState().pxPerSecond).toBe(ZOOM_MIN);
    useEditor.getState().setZoom(1e6);
    expect(useEditor.getState().pxPerSecond).toBe(ZOOM_MAX);
  });

  it('长视频的下限低于 ZOOM_MIN：能缩到整片入镜', () => {
    useEditor.getState().setZoomFloor(0.2);
    useEditor.getState().setZoom(0.01);
    expect(useEditor.getState().pxPerSecond).toBe(0.2);
  });

  it('换成短视频时把记着的极小缩放夹回 ZOOM_MIN', () => {
    useEditor.setState({ pxPerSecond: 0.2, zoomFloor: 0.2 });
    useEditor.getState().setZoomFloor(ZOOM_MIN);
    expect(useEditor.getState().pxPerSecond).toBe(ZOOM_MIN);
  });
});

describe('片段选区与文稿词选区互斥（产品设计 §5.7）', () => {
  const words = { assetId: 'a1', anchor: 2, focus: 5, extra: [] as Array<[number, number]> };
  beforeEach(() => useEditor.setState({ selection: [], wordSelection: null, draft: null, documentDraft: null }));

  it('选出词时清掉片段选区与草稿；清掉词选区不动片段选区', () => {
    useEditor.getState().select(['i1']);
    useEditor.setState({ documentDraft: { documentId: 'd1', baseRevision: 'r1', body: {} } });
    useEditor.getState().setWordSelection(words);
    expect(useEditor.getState()).toMatchObject({ selection: [], wordSelection: words, documentDraft: null });
    useEditor.setState({ selection: ['i2'], wordSelection: null });
    useEditor.getState().setWordSelection(null);
    expect(useEditor.getState().selection).toEqual(['i2']);
  });

  it('拖选扩词（更新函数）也走同一条规则；没有片段选区时不换掉 selection', () => {
    useEditor.getState().setWordSelection(words);
    const before = useEditor.getState().selection;
    useEditor.getState().setWordSelection((s) => (s ? { ...s, focus: 9 } : s));
    expect(useEditor.getState().wordSelection).toMatchObject({ anchor: 2, focus: 9 });
    expect(useEditor.getState().selection).toBe(before);
  });

  it('选中片段（点选或 ⌘ 加选）清掉词选区；清空片段选区不动词选区', () => {
    useEditor.getState().setWordSelection(words);
    useEditor.getState().select([]);
    expect(useEditor.getState().wordSelection).toEqual(words);
    useEditor.getState().select(['i1']);
    expect(useEditor.getState()).toMatchObject({ selection: ['i1'], wordSelection: null });
    useEditor.getState().setWordSelection(words);
    useEditor.getState().toggleSelect('i3');
    expect(useEditor.getState()).toMatchObject({ selection: ['i3'], wordSelection: null });
  });

  it('⌘ 点掉最后一件片段时词选区不受影响；换视频两边都清', () => {
    useEditor.setState({ selection: ['i1'], wordSelection: words });
    useEditor.getState().toggleSelect('i1');
    expect(useEditor.getState()).toMatchObject({ selection: [], wordSelection: words });
    useEditor.setState({ videoId: 'v1' });
    useEditor.getState().attach('v2');
    expect(useEditor.getState().wordSelection).toBeNull();
  });
});

describe('轻量 / 时间线视图', () => {
  beforeEach(() =>
    useEditor.setState({ videoId: null, view: 'timeline', viewResolvedFor: null, viewByVideo: {}, viewDefault: 'auto', liteZoom: 1 }),
  );

  it('打开视频按「路由 > 这部视频上次的选择 > 全局默认 > 按种类」定一次', () => {
    useEditor.getState().resolveView('v1', { route: null, byKind: 'timeline' });
    expect(useEditor.getState()).toMatchObject({ view: 'timeline', viewResolvedFor: 'v1' });
    useEditor.setState({ viewDefault: 'lite' });
    useEditor.getState().resolveView('v2', { route: null, byKind: 'timeline' });
    expect(useEditor.getState().view).toBe('lite');
    useEditor.getState().resolveView('v3', { route: 'timeline', byKind: 'lite' });
    expect(useEditor.getState().view).toBe('timeline');
  });

  it('顶栏切换按视频记住，下次打开沿用；切到轻量清掉时间线的选区', () => {
    useEditor.setState({ videoId: 'v1', selection: ['i1'] });
    useEditor.getState().setView('lite');
    expect(useEditor.getState()).toMatchObject({ view: 'lite', viewByVideo: { v1: 'lite' }, selection: [] });
    useEditor.getState().resolveView('v1', { route: null, byKind: 'timeline' });
    expect(useEditor.getState().view).toBe('lite');
  });

  it('已经定过的视频再收到带 view 的链接，照路由重定，按视频的记忆不动', () => {
    useEditor.setState({ videoId: 'v1' });
    useEditor.getState().setView('lite');
    useEditor.getState().resolveView('v1', { route: 'timeline', byKind: 'lite' });
    expect(useEditor.getState()).toMatchObject({ view: 'timeline', viewResolvedFor: 'v1', viewByVideo: { v1: 'lite' } });
  });

  it('片条缩放夹在 1–8 倍，换视频回到 1', () => {
    useEditor.getState().setLiteZoom(3);
    expect(useEditor.getState().liteZoom).toBe(3);
    useEditor.getState().setLiteZoom(99);
    expect(useEditor.getState().liteZoom).toBe(8);
    useEditor.setState({ videoId: 'v1' });
    useEditor.getState().attach('v2');
    expect(useEditor.getState().liteZoom).toBe(1);
  });
});
