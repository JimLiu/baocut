import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SKILL_LIMITS } from '@baocut/protocol';
import { SkillPrefsStore } from '@baocut/runtime-storage';
import { SkillCatalog, resolveBuiltinSkillsDir, type LoadedSkill } from './skill-catalog.ts';

/** 仓库根 `skills/` 里随应用分发的内置 skill。新增或改名时同步这里与 `skills/README.md`。 */
const EXPECTED_IDS = [
  'cover-and-title',
  'motion-graphics',
  'narration',
  'polish-transcript',
  'shorts-segments',
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

  it('开发时从仓库根找到 skills/，全部加载、没有诊断', async () => {
    expect(path.basename(builtinDir)).toBe('skills');
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
});
