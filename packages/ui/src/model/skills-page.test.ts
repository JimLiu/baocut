import { describe, expect, it } from 'vitest';
import type { ProjectBrandSummary, SkillFileEntry, SkillPackageInspection, SkillSummary } from '@baocut/protocol';
import {
  addedFilePath,
  assetCounts,
  defaultPicks,
  draftChanges,
  draftFiles,
  fileTree,
  previewOf,
  scriptPaths,
  skillAssets,
  skillSections,
  splitFrontMatter,
} from './skills-page.ts';

const file = (path: string, size = 10): SkillFileEntry => ({ path, size, text: !/\.(png|mp3|mp4|ttf)$/.test(path) });

function skill(id: string, origin: SkillSummary['origin'], description = 'd'): SkillSummary {
  return {
    id,
    name: id,
    title: null,
    description,
    labels: null,
    version: null,
    origin,
    enabled: true,
    defaultEnabled: true,
    removable: origin !== 'builtin',
    path: `/s/${id}`,
    source: null,
    fileCount: 1,
    bytes: 1,
    revision: origin === 'builtin' ? null : 1,
    updatedAt: '2026-10-01T00:00:00Z',
  };
}

const brand = (projectId: string, projectName: string, summary: string): ProjectBrandSummary => ({
  projectId,
  projectName,
  projectPath: `/p/${projectId}`,
  path: `/p/${projectId}/BRAND.md`,
  summary,
  updatedAt: '2026-10-01T00:00:00Z',
  fileCount: 1,
  bytes: 1,
});

describe('Skills 页的分段', () => {
  it('我的（个人与第三方）→ 项目品牌 → 内置；搜索同时筛三段', () => {
    const skills = [skill('mine', 'personal'), skill('gh', 'third-party'), skill('craft', 'builtin', 'teal logo')];
    const brands = [brand('p1', '早报', 'Warm teal'), brand('p2', 'Vlog', 'Short')];
    expect(skillSections(skills, brands, '')).toMatchObject({
      mine: [{ id: 'mine' }, { id: 'gh' }],
      brands: [{ projectId: 'p1' }, { projectId: 'p2' }],
      builtin: [{ id: 'craft' }],
    });
    const hit = skillSections(skills, brands, 'teal');
    expect(hit.mine).toEqual([]);
    expect(hit.brands.map((b) => b.projectId)).toEqual(['p1']);
    expect(hit.builtin.map((s) => s.id)).toEqual(['craft']);
  });
});

describe('素材与文件', () => {
  const files = [
    file('SKILL.md'),
    file('assets/theme.mp3'),
    file('assets/logo.svg'),
    file('assets/b.png'),
    file('fonts/a.ttf'),
    file('references/tone.md'),
    file('scripts/build.py'),
  ];

  it('素材按图片 → 音频 → 视频 → 字体排，svg 算图片', () => {
    const assets = skillAssets(files);
    expect(assets.map((a) => a.path)).toEqual(['assets/b.png', 'assets/logo.svg', 'assets/theme.mp3', 'fonts/a.ttf']);
    expect(assetCounts(assets)).toEqual([
      { kind: 'image', count: 2 },
      { kind: 'audio', count: 1 },
      { kind: 'font', count: 1 },
    ]);
    expect(scriptPaths(files)).toEqual(['scripts/build.py']);
  });

  it('文件树：SKILL.md 在最前，文件夹在文件前', () => {
    const tree = fileTree([file('z.md'), ...files]);
    expect(tree.map((n) => `${'  '.repeat(n.depth)}${n.kind === 'dir' ? `${n.name}/` : n.name}`)).toEqual([
      'SKILL.md',
      'assets/',
      '  b.png',
      '  logo.svg',
      '  theme.mp3',
      'fonts/',
      '  a.ttf',
      'references/',
      '  tone.md',
      'scripts/',
      '  build.py',
      'z.md',
    ]);
    expect(fileTree([file('brand/x.png'), file('BRAND.md')], 'BRAND.md').map((n) => n.path)).toEqual(['BRAND.md', 'brand', 'brand/x.png']);
  });

  it('加进来的文件：素材进 assets/，其余进 references/，品牌进 brand/', () => {
    expect(addedFilePath('/Users/me/Logo.PNG')).toBe('assets/Logo.PNG');
    expect(addedFilePath('C:\\notes\\tone.md')).toBe('references/tone.md');
    expect(addedFilePath('intro.mp3', true)).toBe('brand/intro.mp3');
  });

  it('预览方式按类别', () => {
    expect(['SKILL.md', 'a/b.md', 'x.txt', 'x.svg', 'x.png', 'x.mp3', 'x.mp4', 'x.py', 'x.ttf', 'x.bin'].map(previewOf)).toEqual([
      'markdown',
      'markdown',
      'text',
      'svg',
      'image',
      'audio',
      'video',
      'text',
      'binary',
      'binary',
    ]);
  });
});

describe('上传的默认选择', () => {
  it('能装的都勾上；同名个人的默认更新，同名内置或第三方的另存为副本，有问题的不勾', () => {
    const base = { id: 'x', name: 'x', description: 'd', fileCount: 1, bytes: 1, assets: 0, scripts: 0, issue: null, conflict: null };
    const inspection: SkillPackageInspection = {
      kind: 'zip',
      name: 'pack.zip',
      ignored: ['__MACOSX/'],
      candidates: [
        { ...base, prefix: 'a/' },
        { ...base, prefix: 'b/', conflict: { id: 'b', origin: 'personal', canUpdate: true, nextRevision: 3, copyId: 'b-2' } },
        { ...base, prefix: 'c/', conflict: { id: 'c', origin: 'builtin', canUpdate: false, nextRevision: 1, copyId: 'c-2' } },
        { ...base, prefix: 'd/', issue: { code: 'no-description', message: 'm' } },
      ],
    };
    expect(defaultPicks(inspection)).toEqual([
      { prefix: 'a/', mode: 'new' },
      { prefix: 'b/', mode: 'update' },
      { prefix: 'c/', mode: 'copy' },
    ]);
  });
});

describe('编辑中的改动', () => {
  it('改过的文本、加进来的文件与删掉的文件变成 changes；没改的文本不算', () => {
    const files = [file('SKILL.md'), file('references/a.md'), file('assets/old.png')];
    const draft = {
      texts: { 'SKILL.md': 'new', 'references/a.md': 'same', 'assets/old.png': 'x' },
      added: { 'assets/logo.png': { from: '/Users/me/logo.png', size: 5 } },
      removed: ['assets/old.png'],
    };
    expect(draftFiles(files, draft).map((f) => f.path)).toEqual(['SKILL.md', 'references/a.md', 'assets/logo.png']);
    expect(draftChanges(draft, { 'SKILL.md': 'old', 'references/a.md': 'same' })).toEqual([
      { path: 'SKILL.md', text: 'new' },
      { path: 'assets/logo.png', from: '/Users/me/logo.png' },
      { path: 'assets/old.png', remove: true },
    ]);
  });
});

describe('front matter', () => {
  it('拆开 front matter 与正文；没有时整篇是正文', () => {
    expect(splitFrontMatter('---\r\nname: a\r\n---\r\n\n# A')).toEqual({ front: 'name: a', body: '# A' });
    expect(splitFrontMatter('# B')).toEqual({ front: null, body: '# B' });
  });
});
