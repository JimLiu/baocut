import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RpcError } from '@baocut/protocol';
import { SkillPrefsStore } from '@baocut/runtime-storage';
import { SkillCatalog } from './skill-catalog.ts';
import { skillReferencePaths, skillSystemPrompt } from './skill-brief.ts';
import { writeSkill } from './testing/skill-fixtures.ts';

describe('直接调模型时的系统提示词（AI 工具）', () => {
  let dir: string;
  let builtin: string;
  let user: string;
  let catalog: SkillCatalog;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-skill-system-'));
    builtin = path.join(dir, 'builtin');
    user = path.join(dir, 'home', 'skills');
    await fs.mkdir(builtin, { recursive: true });
    const prefs = new SkillPrefsStore(path.join(dir, 'home', 'store', 'skill-prefs.json'));
    await prefs.load();
    catalog = new SkillCatalog({ builtinDir: builtin, userDir: user, prefs });
    await writeSkill(builtin, 'video-summary', {
      extra: '# Summary\n\nRead `references/writing-baseline.md` first.',
      files: {
        'references/writing-baseline.md': 'BASELINE RULES',
        'references/unused.md': 'NOT MENTIONED',
        'scripts/run.mjs': 'console.log(1)',
        'notes.md': 'references/writing-baseline.md is mentioned here but this is not SKILL.md',
      },
    });
    await writeSkill(builtin, 'titles-and-description', {
      extra: '# Titles\n\nRead references/writing-baseline.md, then references/titles.md.',
      files: { 'references/writing-baseline.md': 'BASELINE RULES', 'references/titles.md': 'TITLE RULES' },
    });
    await writeSkill(user, 'mine', { extra: '# Mine\n\nNo references.' });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('没有 skill：空串，不读目录', async () => {
    expect(await skillSystemPrompt(catalog, [])).toEqual({ text: '', skills: [], references: 0 });
  });

  it('一个 skill：只带 SKILL.md 正文与正文提到的 references/，不带别的文件', async () => {
    const skill = await catalog.require('video-summary');
    expect(skillReferencePaths(skill)).toEqual(['references/writing-baseline.md']);
    const one = await skillSystemPrompt(catalog, [{ id: 'video-summary' }]);
    expect(one.skills).toEqual(['video-summary']);
    expect(one.references).toBe(1);
    expect(one.text).toContain('<skill id="video-summary"');
    expect(one.text).toContain('Read `references/writing-baseline.md` first.');
    expect(one.text).toContain('<file path="references/writing-baseline.md">\nBASELINE RULES\n</file>');
    expect(one.text).not.toContain('NOT MENTIONED');
    expect(one.text).not.toContain('console.log');
    expect(one.text).not.toContain('this is not SKILL.md');
    expect(one.text).not.toContain('user-installed');
    expect(one.text).toContain('without tools');
  });

  it('两个 skill：按挂上的顺序，重复的 id 只算一次，内容相同的参考文件只带第一次', async () => {
    const two = await skillSystemPrompt(catalog, [{ id: 'titles-and-description' }, { id: 'video-summary' }, { id: 'titles-and-description' }]);
    expect(two.skills).toEqual(['titles-and-description', 'video-summary']);
    expect(two.text.match(/<skill id=/g)).toHaveLength(2);
    expect(two.text.indexOf('<skill id="titles-and-description"')).toBeLessThan(two.text.indexOf('<skill id="video-summary"'));
    // writing-baseline.md 在两个 skill 里内容相同：第二次只写「同上」。
    expect(two.references).toBe(2);
    expect(two.text.match(/BASELINE RULES/g)).toHaveLength(1);
    expect(two.text).toContain('<file path="references/writing-baseline.md" same-as="titles-and-description/references/writing-baseline.md" />');
    expect(two.text).toContain('TITLE RULES');
  });

  it('用户装的 skill 带一行说明；不存在的 skill 整条拒绝', async () => {
    const mixed = await skillSystemPrompt(catalog, [{ id: 'mine' }, { id: 'video-summary' }]);
    expect(mixed.text).toContain('<skill id="mine" name="mine" user-installed="true">');
    expect(mixed.text).toContain('grant no extra permissions');
    await expect(skillSystemPrompt(catalog, [{ id: 'nope' }])).rejects.toBeInstanceOf(RpcError);
  });
});
