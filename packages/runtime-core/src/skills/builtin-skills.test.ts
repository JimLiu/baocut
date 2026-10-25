import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LOCALES, SKILL_LIMITS, SKILL_META_FILE, parseSkillLabels } from '@baocut/protocol';
import { SkillPrefsStore } from '@baocut/runtime-storage';
import { SkillCatalog, resolveBuiltinSkillsDir, type LoadedSkill } from './skill-catalog.ts';

/**
 * 仓库根 `skills/baocut/built-in-skills/` 里随应用分发的内置 skill。新增或改名时同步这里、那里 `README.md` 的索引与说明书
 * `SKILL.md` 的「内置 skill」表。
 */
const EXPECTED_IDS = [
  'clip-montage',
  'cover-and-title',
  'cross-video-qa',
  'design',
  'design-system',
  'docs',
  'explainer-video',
  'history-video',
  'motion-graphics',
  'narration',
  'polish-transcript',
  'production-scripts',
  'shorts-segments',
  'slides',
  'speaker-labeling',
  'subtitle-workflow',
  'talking-head-cut',
  'titles-and-description',
  'translate-subtitles',
  'video-blog',
  'video-chapters',
  'video-production',
  'video-summary',
];

/** 只给会话内智能体的内置 skill：说明书的路由只在工具桥面列出它们，CLI 面的「内置 skill」表也不列。 */
const AGENT_ONLY_IDS = ['design', 'design-system', 'docs', 'slides'];

/** 会话开始时的 skill 索引只取 description 的前 300 个字符（`skill-brief.ts`），内置的写在这个长度以内。 */
const INDEX_DESCRIPTION_CHARS = 300;

describe('仓库里的内置 skill', () => {
  let tmp: string;
  let builtinDir: string;
  let skills: LoadedSkill[];
  let catalog: SkillCatalog;

  beforeAll(async () => {
    const resolved = resolveBuiltinSkillsDir({});
    expect(resolved).not.toBeNull();
    builtinDir = resolved!;
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-builtin-skills-'));
    const prefs = new SkillPrefsStore(path.join(tmp, 'store', 'skill-prefs.json'));
    await prefs.load();
    catalog = new SkillCatalog({ builtinDir, userDir: path.join(tmp, 'skills'), prefs });
    const scan = await catalog.scan();
    expect(scan.diagnostics).toEqual([]);
    skills = scan.skills;
  });

  afterAll(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('开发时从仓库根找到 skills/baocut/built-in-skills/，全部加载、没有诊断', async () => {
    expect(builtinDir.endsWith(path.join('skills', 'baocut', 'built-in-skills'))).toBe(true);
    expect(skills.map((s) => s.id).sort()).toEqual(EXPECTED_IDS);
    const list = await catalog.list();
    expect(list.diagnostics).toEqual([]);
    for (const summary of list.skills) {
      expect(summary).toMatchObject({ origin: 'builtin', enabled: true, defaultEnabled: true, removable: false, source: null });
    }
  });

  it('front matter 齐全且在上限内', () => {
    for (const skill of skills) {
      expect(skill.name.trim(), skill.id).not.toBe('');
      expect(skill.name.length, skill.id).toBeLessThanOrEqual(SKILL_LIMITS.name);
      expect(skill.description.length, skill.id).toBeLessThanOrEqual(Math.min(SKILL_LIMITS.description, INDEX_DESCRIPTION_CHARS));
      expect(skill.version, skill.id).toMatch(/^\d+\.\d+\.\d+$/);
      expect(skill.version!.length, skill.id).toBeLessThanOrEqual(SKILL_LIMITS.version);
      expect(skill.body.trim(), skill.id).not.toBe('');
    }
    const names = skills.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it(`每个都有 ${SKILL_META_FILE}：全部出货语言的名称与一句话介绍，各一行、在上限内，没有多余的键`, async () => {
    for (const skill of skills) {
      const raw = JSON.parse(await fs.readFile(path.join(skill.dir, SKILL_META_FILE), 'utf8')) as Record<string, Record<string, string>>;
      expect(Object.keys(raw).sort(), skill.id).toEqual(['name', 'summary']);
      for (const field of ['name', 'summary'] as const) {
        expect(Object.keys(raw[field]!), `${skill.id} ${field}`).toEqual([...LOCALES]);
      }
      // 解析不丢任何一条（空的、多行的、超长的都会被丢掉），加载出来的就是文件内容。
      expect(parseSkillLabels(raw), skill.id).toEqual(raw);
      expect(skill.labels, skill.id).toEqual(raw);
    }
    const names = skills.map((s) => s.labels!.name.en);
    expect(new Set(names).size).toBe(names.length);
  });

  it('文件数、大小在上限内，正文提到的 references 文件都在', () => {
    for (const skill of skills) {
      const skillFile = skill.files.find((f) => f.path === 'SKILL.md');
      expect(skillFile, skill.id).toBeDefined();
      expect(skillFile!.size, skill.id).toBeLessThanOrEqual(SKILL_LIMITS.skillFileBytes);
      expect(skill.files.length, skill.id).toBeLessThanOrEqual(SKILL_LIMITS.files);
      expect(
        skill.files.reduce((sum, f) => sum + f.size, 0),
        skill.id,
      ).toBeLessThanOrEqual(SKILL_LIMITS.totalBytes);
      const paths = new Set(skill.files.map((f) => f.path));
      for (const match of skill.body.matchAll(/`(references\/[^`]+\.md)`/g)) {
        expect(paths.has(match[1]!), `${skill.id} → ${match[1]}`).toBe(true);
      }
    }
  });

  it('目录 README.md 的索引列出全部内置 skill，每行链到它的 SKILL.md', async () => {
    const readme = await fs.readFile(path.join(builtinDir, 'README.md'), 'utf8');
    const rows = [...readme.matchAll(/^\| \[`([a-z0-9-]+)`\]\(([^)]+)\) \|/gm)];
    expect(rows.map((row) => row[1]).sort()).toEqual(EXPECTED_IDS);
    for (const [, id, target] of rows) expect(target, id).toBe(`${id}/SKILL.md`);
  });

  it('说明书 SKILL.md 的「内置 skill」表（只给 CLI 面）列出全部内置 skill，只给会话内智能体的除外', async () => {
    const manual = await fs.readFile(path.join(builtinDir, '..', 'SKILL.md'), 'utf8');
    const start = manual.indexOf('### 内置 skill');
    expect(start).toBeGreaterThan(0);
    const section = manual.slice(start, manual.indexOf('<!-- /surface -->', start));
    const ids = [...section.matchAll(/^\| \{\{skill:([a-z0-9-]+)\}\} \|/gm)].map((row) => row[1]);
    expect(ids.sort()).toEqual(EXPECTED_IDS.filter((id) => !AGENT_ONLY_IDS.includes(id)));
  });
});
