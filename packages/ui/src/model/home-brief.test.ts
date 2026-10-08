import { describe, expect, it } from 'vitest';
import {
  MAX_HOME_MATERIALS,
  addMaterials,
  canStartHome,
  gateGuide,
  homeBrief,
  homeGate,
  lengthLabel,
  materialOf,
  projectNameError,
  type HomeBriefOptions,
} from './home-brief.ts';

const auto: HomeBriefOptions = { images: 0, materials: [] };

describe('模板卡片上的时长', () => {
  it('按分钟与秒写成「约 …」', () => {
    expect(lengthLabel(60)).toBe('约 1 分钟');
    expect(lengthLabel(30)).toBe('约 30 秒');
    expect(lengthLabel(90)).toBe('约 1 分钟 30 秒');
    expect(lengthLabel(600)).toBe('约 10 分钟');
    expect(lengthLabel(null)).toBeNull();
  });
});

describe('发给 Agent 的正文', () => {
  it('只有自己的话时原样发出', () => {
    expect(homeBrief('  做一条咖啡店的宣传片 ', auto)).toBe('做一条咖啡店的宣传片');
  });

  it('没写话、只附了材料时补一句（挂没挂模板都一样，text 照常必填）', () => {
    expect(homeBrief('', { ...auto, images: 2 })).toBe('根据我附上的材料制作一条视频。');
    expect(homeBrief('', auto)).toBe('');
  });

  it('没填的待填项写成 [label]，不保留 {{（模板包规范 §5.5）', () => {
    expect(homeBrief('给我们的瑜伽课做一条推广短片，受众是{{受众}}', auto)).toBe('给我们的瑜伽课做一条推广短片，受众是[受众]');
    expect(homeBrief('没闭合的 {{受众', auto)).toBe('没闭合的 {{受众');
  });

  it('本机素材按路径写在最后一行', () => {
    expect(homeBrief('', { ...auto, materials: ['/Users/me/访谈.mp4', '/Users/me/白皮书.pdf'] })).toBe(
      ['根据我附上的材料制作一条视频。', '材料：/Users/me/访谈.mp4、/Users/me/白皮书.pdf'].join('\n'),
    );
  });
});

describe('能不能开始', () => {
  const ok = { ok: true } as const;
  it('写了话就行；只选模板不行；附了图片或素材也行', () => {
    expect(canStartHome({ text: '做个片头', images: 0, materials: 0, gate: ok }).ok).toBe(true);
    expect(canStartHome({ text: '  ', images: 0, materials: 0, gate: ok })).toEqual({ ok: false, why: '先说一句要做什么，或附上材料' });
    expect(canStartHome({ text: '', images: 1, materials: 0, gate: ok }).ok).toBe(true);
    expect(canStartHome({ text: '', images: 0, materials: 2, gate: ok }).ok).toBe(true);
  });

  it('Agent 用不了时不能开始；还在检测时不拦', () => {
    expect(canStartHome({ text: '做个片头', images: 0, materials: 0, gate: { ok: false, reason: 'agent-missing' } })).toEqual({
      ok: false,
      why: '先连接 AI',
    });
    expect(canStartHome({ text: '做个片头', images: 0, materials: 0, gate: null }).ok).toBe(true);
  });
});

describe('Agent 指引', () => {
  const driver = (id: 'claude' | 'codex', state: 'ready' | 'disabled' | 'not-installed' | 'signed-out') => ({
    id,
    name: id === 'claude' ? 'Claude Code' : 'Codex',
    state,
  });

  it('还在检测时不下结论；有一个就绪就行', () => {
    expect(homeGate(null, [])).toBeNull();
    expect(homeGate([driver('claude', 'not-installed'), driver('codex', 'ready')], [])).toEqual({ ok: true });
    expect(gateGuide({ ok: true })).toBeNull();
  });

  it('还有 Driver 在首次探测、又没有就绪的：不下结论，不闪指引卡', () => {
    expect(homeGate([], ['codex'])).toBeNull();
    expect(homeGate([driver('claude', 'not-installed')], ['codex'])).toBeNull();
    // 已经有一个就绪的，就不必等检测中的那个。
    expect(homeGate([driver('claude', 'ready')], ['codex'])).toEqual({ ok: true });
  });

  it('装好了只是停用：启用那一个', () => {
    const gate = homeGate([driver('claude', 'not-installed'), driver('codex', 'disabled')], []);
    expect(gate).toEqual({ ok: false, reason: 'agent-off', enable: { id: 'codex', name: 'Codex' } });
    expect(gateGuide(gate)).toMatchObject({ title: '已安装的编码 Agent 都停用了', action: '启用 Codex', enable: { id: 'codex' } });
  });

  it('没装或没登录：去设置 › Agent 连接', () => {
    const gate = homeGate([driver('claude', 'signed-out'), driver('codex', 'not-installed')], []);
    expect(gate).toEqual({ ok: false, reason: 'agent-missing' });
    expect(gateGuide(gate)).toEqual({
      title: '这一项要交给编码 Agent',
      body: '装 Claude Code 或 Codex CLI 并用你自己的订阅登录，回到这里就能直接开始。',
      action: '连接 Agent',
      enable: null,
    });
  });
});

describe('本机素材', () => {
  it('按扩展名分成视频音频、图片、文档，名字取文件名', () => {
    expect(materialOf('/Users/me/片子/访谈.MOV')).toEqual({ path: '/Users/me/片子/访谈.MOV', name: '访谈.MOV', kind: 'media' });
    expect(materialOf('/Users/me/播客.m4a').kind).toBe('media');
    expect(materialOf('/Users/me/草图.heic').kind).toBe('image');
    expect(materialOf('C:\\docs\\白皮书.pdf')).toMatchObject({ name: '白皮书.pdf', kind: 'document' });
    expect(materialOf('/Users/me/README').kind).toBe('document');
  });

  it('同一路径只留一份，超过上限的退回', () => {
    const first = addMaterials([], ['/a.mp4', '/a.mp4', '', '/b.pdf']);
    expect(first).toEqual({ list: [materialOf('/a.mp4'), materialOf('/b.pdf')], rejected: 0 });
    const many = Array.from({ length: MAX_HOME_MATERIALS + 2 }, (_, i) => `/m${i}.mp3`);
    const capped = addMaterials(first.list, many);
    expect(capped.list).toHaveLength(MAX_HOME_MATERIALS);
    expect(capped.rejected).toBe(4);
  });
});

describe('新建项目的名称', () => {
  it('空的、点、斜杠与控制字符不收', () => {
    expect(projectNameError('新片')).toBeNull();
    expect(projectNameError('  ')).toBe('请输入项目名称');
    for (const name of ['..', '.', 'a/b', 'a\\b', 'a\u0007b']) expect(projectNameError(name)).toBe('项目名称不能包含斜杠或控制字符');
  });
});
