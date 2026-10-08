import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { codexHome, parseTopLevelModel, readCodexConfigModel } from './codex-config.ts';
import { inferTier, toCatalog, toDriverModel } from './codex-models.ts';
import type { CodexModel } from './codex-protocol.ts';

const model = (id: string, patch: Partial<CodexModel> = {}): CodexModel => ({
  id,
  model: id,
  displayName: id,
  description: '',
  hidden: false,
  isDefault: false,
  supportedReasoningEfforts: [],
  defaultReasoningEffort: 'medium',
  ...patch,
});

describe('Codex 模型表', () => {
  it('toDriverModel：显示名、说明、默认、强度与默认强度原样转述', () => {
    expect(
      toDriverModel(
        model('gpt-6.1-sol', {
          displayName: 'GPT-6.1 Sol',
          description: 'Our workhorse model. ',
          isDefault: true,
          supportedReasoningEfforts: [
            { reasoningEffort: 'low', description: 'Fast' },
            { reasoningEffort: 'xhigh', description: 'Extra' },
          ],
          defaultReasoningEffort: 'xhigh',
        }),
      ),
    ).toEqual({
      id: 'gpt-6.1-sol',
      label: 'GPT-6.1 Sol',
      description: 'Our workhorse model.',
      tier: 'balanced',
      isDefault: true,
      efforts: [
        { id: 'low', label: 'low' },
        { id: 'xhigh', label: 'xhigh' },
      ],
      defaultEffort: 'xhigh',
    });
  });

  it('toDriverModel：缺字段时退回 id 与 null', () => {
    const raw = { id: 'weird', hidden: false } as unknown as CodexModel;
    expect(toDriverModel(raw)).toEqual({
      id: 'weird',
      label: 'weird',
      description: null,
      tier: null,
      isDefault: false,
      efforts: [],
      defaultEffort: null,
    });
  });

  it('inferTier：家族后缀优先，其次看说明，推不出来为 null', () => {
    expect(inferTier('gpt-6-astra', null)).toBe('max');
    expect(inferTier('gpt-6-sol', null)).toBe('balanced');
    expect(inferTier('gpt-5.6-luna', null)).toBe('fast');
    expect(inferTier('gpt-5-mini', null)).toBe('fast');
    expect(inferTier('gpt-5.5', 'Frontier model for the most demanding work.')).toBe('max');
    expect(inferTier('gpt-x', 'Fastest option for quick edits.')).toBe('fast');
    expect(inferTier('gpt-x', 'An everyday model.')).toBe('balanced');
    expect(inferTier('gpt-5.5', 'Older model.')).toBeNull();
    expect(inferTier('gpt-5.6-terra', null)).toBeNull();
  });

  it('toCatalog：隐藏模型不进 models，但进 all；没有 id 的条目丢掉', () => {
    const catalog = toCatalog([model('a'), model('secret', { hidden: true }), { hidden: false } as unknown as CodexModel]);
    expect(catalog.models.map((m) => m.id)).toEqual(['a']);
    expect(catalog.all).toEqual(['a', 'secret']);
  });
});

describe('Codex 配置里的模型', () => {
  it('parseTopLevelModel：只认第一个表头之前的 model', () => {
    expect(parseTopLevelModel('model = "gpt-6.1-sol"\n')).toBe('gpt-6.1-sol');
    expect(parseTopLevelModel(`# comment\napproval_policy = "untrusted"\nmodel='gpt-5.5'  # 注释\n`)).toBe('gpt-5.5');
    expect(parseTopLevelModel('model_reasoning_effort = "high"\nmodel = "x"\n')).toBe('x');
    expect(parseTopLevelModel('[profiles.fast]\nmodel = "gpt-5.6-luna"\n')).toBeNull();
    expect(parseTopLevelModel('model = ""\n')).toBeNull();
    expect(parseTopLevelModel('model = "a\\"b"')).toBe('a"b');
    expect(parseTopLevelModel('')).toBeNull();
    expect(parseTopLevelModel('model = gpt-5\n')).toBeNull();
  });

  it('readCodexConfigModel：读 CODEX_HOME 下的 config.toml；没有文件为 null', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-codex-config-'));
    try {
      const env = { CODEX_HOME: dir };
      expect(codexHome(env)).toBe(dir);
      expect(await readCodexConfigModel(env)).toBeNull();
      await fs.writeFile(path.join(dir, 'config.toml'), 'model = "gpt-6-sol"\n[mcp_servers.x]\nmodel = "nope"\n');
      expect(await readCodexConfigModel(env)).toBe('gpt-6-sol');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
