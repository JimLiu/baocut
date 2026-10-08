import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TEMPLATE_CATEGORIES, type TemplateManifest, type TemplateSummary } from '@baocut/protocol';
import {
  SHELF_DEFAULT,
  SHELF_MAX,
  TEMPLATES_PER_PAGE,
  categoryLabel,
  findTemplates,
  homeTemplateOf,
  pageOf,
  shelfAfterPick,
  templateAssets,
  templateByline,
  templateCatalogOf,
  templateCategories,
  templateLength,
  templateMeta,
  templateOf,
  templateShelf,
  templateSlotFields,
  templateSources,
  templateSpecLine,
} from './home-templates.ts';

/** 仓库顶层 templates/ 里的内置模板，按 `templates.list` 的样子包一层。 */
const TEMPLATES_DIR = path.resolve(import.meta.dirname, '../../../../templates');
const BUILTIN: TemplateSummary[] = fs
  .readdirSync(TEMPLATES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
  .map((d) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, d.name, 'template.json'), 'utf8')) as TemplateManifest;
    return { manifest, origin: 'builtin', files: { cover: false, preview: false, assets: manifest.assets?.length ?? 0 } };
  });

function summary(patch: Partial<TemplateManifest>, extra: Partial<Omit<TemplateSummary, 'manifest'>> = {}): TemplateSummary {
  const manifest: TemplateManifest = {
    schema: 1,
    id: 'my-template',
    version: '1.0.0',
    kind: 'scene',
    title: '我的模板',
    summary: '一句话',
    description: '一小段',
    language: 'zh-CN',
    category: 'explainer',
    ratio: '1:1',
    durationSeconds: 45,
    brief: '讲讲{{宠物}}，给{{受众}}看',
    fields: [{ label: '宠物', hint: '讲谁', example: '我的猫' }, { label: '受众' }],
    skills: ['video-production'],
    author: '某人',
    source: 'official',
    license: 'CC-BY-4.0',
    tags: ['猫'],
    cover: { tone: 'green', figure: 'cards', kicker: 'MINE' },
    preview: { beats: ['一', '二', '三'] },
    ...patch,
  };
  return { manifest, origin: 'user', files: { cover: false, preview: false, assets: manifest.assets?.length ?? 0 }, ...extra };
}

const catalog = templateCatalogOf(BUILTIN);

describe('目录换成界面用的形状', () => {
  it('内置的 24 个：12 个场景模板、12 个作品示例，按 id 排', () => {
    expect(catalog).toHaveLength(24);
    expect(findTemplates(catalog, '', { kind: 'scene' })).toHaveLength(12);
    expect(findTemplates(catalog, '', { kind: 'example' })).toHaveLength(12);
    const ids = catalog.map((t) => t.id);
    expect(ids).toEqual([...ids].sort());
    expect(catalog.every((t) => t.source === 'builtin')).toBe(true);
  });

  it('时长按秒；没写的画幅、时长、示例输入是自动 / 空', () => {
    const promo = templateOf(catalog, 'promo-ad')!;
    expect(promo).toMatchObject({ kind: 'scene', ratio: '9:16', length: 30, tone: 'magenta', figure: 'ring', kicker: 'AD' });
    expect(promo.sample).not.toBe('');
    const launch = templateOf(catalog, 'white-ui-launch')!;
    expect(launch).toMatchObject({ kind: 'example', ratio: null, length: null, sample: '', brief: '' });
    expect(launch.fields.length).toBeGreaterThan(0);
    expect(templateLength(90)).toBe(90);
    expect(templateLength(undefined)).toBeNull();
  });

  it('示例句由 brief 与 fields 拼出：占位符换成示例，没有示例的用 label；brief、fields、skills 原样带上', () => {
    const mine = homeTemplateOf(summary({}));
    expect(mine.sample).toBe('讲讲我的猫，给受众看');
    expect(mine.brief).toBe('讲讲{{宠物}}，给{{受众}}看');
    expect(mine.fields.map((f) => f.label)).toEqual(['宠物', '受众']);
    expect(mine.skills).toEqual(['video-production']);
    expect(templateOf(catalog, 'promo-ad')!.sample).not.toContain('{{');
  });

  it('封面图与预览视频：清单写了、Runtime 也说文件在才用；没有分幕时用标题顶一幕', () => {
    const withFiles = homeTemplateOf(
      summary(
        { cover: { file: 'cover.png', tone: 'blue' }, preview: { file: 'preview.mp4' } },
        { files: { cover: true, preview: true, assets: 0 } },
      ),
    );
    expect(withFiles).toMatchObject({ cover: 'cover.png', preview: 'preview.mp4', beats: ['我的模板'], figure: 'bars' });
    const missing = homeTemplateOf(summary({ cover: { file: 'cover.png', tone: 'blue', figure: 'ring' } }));
    expect(missing.cover).toBeNull();
  });

  it('用户目录的排在内置之后；清单写了社区的算社区', () => {
    const mixed = templateCatalogOf([
      summary({ id: 'zz-mine' }),
      summary({ id: 'aa-shared', source: 'community' }),
      ...BUILTIN.slice(0, 2),
    ]);
    expect(mixed.map((t) => t.source)).toEqual(['builtin', 'builtin', 'user', 'community']);
  });
});

describe('输入框下的模板网格', () => {
  it('默认八个都在内置目录里：六个场景模板加两个作品示例，七个分类都有', () => {
    const shelf = templateShelf(catalog, null);
    expect(SHELF_MAX).toBe(8);
    expect(shelf.map((t) => t.id)).toEqual([...SHELF_DEFAULT]);
    expect(shelf.filter((t) => t.kind === 'example')).toHaveLength(2);
    expect(new Set(shelf.map((t) => t.category)).size).toBe(7);
  });

  it('最近用过的在前；目录里已经没有的键（旧版本存的 tips、anim）丢掉并用默认补齐', () => {
    expect(templateShelf(catalog, ['tips', 'white-ui-launch', 'anim', 'white-ui-launch']).map((t) => t.id)).toEqual([
      'white-ui-launch',
      ...SHELF_DEFAULT.slice(0, 7),
    ]);
    expect(templateShelf(catalog, [42, null, 'promo-ad'])).toHaveLength(8);
    expect(templateShelf([], ['promo-ad'])).toEqual([]);
  });

  it('从模板库挑的新面孔排到最前、挤掉最后一个；已在网格里的不挪位置；目录里没有的不收', () => {
    expect(shelfAfterPick(catalog, null, 'data-story')).toEqual([...SHELF_DEFAULT]);
    expect(shelfAfterPick(catalog, ['tips'], 'white-ui-launch')).toEqual(['white-ui-launch', ...SHELF_DEFAULT.slice(0, 7)]);
    expect(shelfAfterPick(catalog, null, 'nope')).toEqual([...SHELF_DEFAULT]);
  });
});

describe('模板库的筛选', () => {
  it('类型、分类、搜索词可以叠加；分类按钮是全部加规范的七类，每类都有模板', () => {
    const cats = templateCategories(catalog);
    expect(cats.map((c) => c.key)).toEqual(['all', ...TEMPLATE_CATEGORIES]);
    expect(cats[1]).toEqual({ key: 'marketing', label: '营销推广' });
    for (const c of TEMPLATE_CATEGORIES) expect(findTemplates(catalog, '', { category: c }).length, c).toBeGreaterThan(0);
    const scenesInMarketing = findTemplates(catalog, '', { kind: 'scene', category: 'marketing' });
    expect(scenesInMarketing.every((t) => t.kind === 'scene' && t.category === 'marketing')).toBe(true);
    expect(findTemplates(catalog, '推广').map((t) => t.id)).toContain('promo-ad');
    // 标签也算
    expect(findTemplates(catalog, '转化').map((t) => t.id)).toEqual(['promo-ad']);
  });

  it('认不出的分类键按键名显示，并多一个分类按钮', () => {
    const odd = templateCatalogOf([summary({ id: 'odd', category: 'gaming' as never })]);
    expect(categoryLabel('gaming')).toBe('gaming');
    expect(templateCategories(odd).at(-1)).toEqual({ key: 'gaming', label: 'gaming' });
  });

  it('只有一种来源时不出来源筛选；有用户目录的模板时按内置 / 我的筛', () => {
    expect(templateSources(catalog)).toEqual([]);
    const mixed = templateCatalogOf([...BUILTIN, summary({})]);
    expect(templateSources(mixed).map((s) => s.label)).toEqual(['全部来源', '内置', '我的']);
    expect(findTemplates(mixed, '', { source: 'user' }).map((t) => t.id)).toEqual(['my-template']);
  });

  it('分页：页码越界收回有效范围，空列表也算一页', () => {
    const first = pageOf(catalog, 1);
    expect([first.items.length, first.page, first.pages, first.total]).toEqual([TEMPLATES_PER_PAGE, 1, 3, 24]);
    expect(pageOf(catalog, 99).page).toBe(3);
    expect(pageOf(catalog, 99).items).toHaveLength(24 - 2 * TEMPLATES_PER_PAGE);
    expect(pageOf([], 3)).toEqual({ items: [], page: 1, pages: 1, total: 0 });
  });
});

describe('卡片与详情的文案', () => {
  it('场景模板写默认画幅时长；作品示例没写的说交给 Agent', () => {
    const promo = templateOf(catalog, 'promo-ad')!;
    expect(templateMeta(promo)).toBe('9:16 · 约 30 秒 · 内置');
    expect(templateSpecLine(promo)).toBe('默认 9:16 · 约 30 秒，要改就在消息里说');
    expect(templateByline(promo)).toBe('内置 · 场景模板 · 营销推广');
    const launch = templateOf(catalog, 'white-ui-launch')!;
    expect(templateMeta(launch)).toBe('画幅与时长自动 · 内置');
    expect(templateSpecLine(launch)).toBe('画幅与时长自动，由 Agent 按内容决定');
    expect(templateSpecLine({ kind: 'example', ratio: '16:9', length: null })).toBe('16:9 · 时长自动');
    expect(templateByline(homeTemplateOf(summary({ kind: 'example' })))).toBe('我的 · 某人 · 作品示例 · 知识讲解');
  });

  it('「需要你补充」按 brief 里出现的顺序列待填项，带清单里的说明；作品示例不列', () => {
    const fields = [
      { label: '受众', hint: '谁会看到' },
      { label: '产品', hint: '要推广的是什么', example: '瑜伽课' },
    ];
    expect(templateSlotFields({ kind: 'scene', brief: '给{{产品}}做，面向{{受众}}，再说{{产品}}，{{没写的}}', fields })).toEqual([
      { label: '产品', hint: '要推广的是什么', example: '瑜伽课' },
      { label: '受众', hint: '谁会看到' },
      { label: '没写的' },
    ]);
    expect(templateSlotFields({ kind: 'scene', brief: '', fields })).toEqual([]);
    expect(templateSlotFields({ kind: 'example', brief: '{{产品}}', fields })).toEqual([]);
    const promo = templateOf(catalog, 'promo-ad')!;
    expect(templateSlotFields(promo).map((f) => f.label)).toEqual(promo.fields.map((f) => f.label));
  });

  it('素材按种类数，含视频；没有的种类不列', () => {
    const t = homeTemplateOf(
      summary({
        assets: [
          { path: 'assets/a.png', type: 'image', note: '图' },
          { path: 'assets/b.png', type: 'image', note: '图' },
          { path: 'assets/c.mp4', type: 'video', note: '片头' },
        ],
      }),
    );
    expect(templateAssets(t)).toEqual([
      { kind: 'image', label: '图片', count: 2 },
      { kind: 'video', label: '视频', count: 1 },
    ]);
    expect(templateAssets(templateOf(catalog, 'promo-ad')!)).toEqual([]);
  });
});
