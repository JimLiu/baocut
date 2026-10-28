import { describe, expect, it } from 'vitest';
import { recommendedDriverModel } from '@baocut/protocol';
import { FALLBACK_CLAUDE_MODELS, mapClaudeModels } from './claude/claude-models.ts';
import { toCatalog } from './codex/codex-models.ts';
import { FAKE_CLAUDE_MODELS } from './testing/fake-claude.ts';
import { fakeModel } from './testing/fake-codex.ts';

/** 推荐模型（Claude 2026-09-29、Codex 2026-10-27 用户裁决）放到两家 Driver 真实转出来的模型表上：不因 CLI 标的默认或表里的次序落到贵的那一档。 */
describe('推荐模型 × Driver 的模型表', () => {
  it('Claude Code：CLI 的默认是 Opus、Fable 排在 Sonnet 前面，推荐的仍是 Sonnet；问不到模型表时的精简表也是', () => {
    const models = mapClaudeModels(FAKE_CLAUDE_MODELS);
    expect(models.find((m) => m.isDefault)?.id).toBe('opus');
    expect(recommendedDriverModel('claude', models)?.id).toBe('sonnet');
    expect(recommendedDriverModel('claude', FALLBACK_CLAUDE_MODELS)?.id).toBe('sonnet');
  });

  it('Codex：取第一个 -terra（隐藏的不算），不取 CLI 次序在前的 -sol，也不取标了默认的那一个', () => {
    // 0.164.0 的目录次序。
    const { models } = toCatalog([
      fakeModel('gpt-6.1-sol'),
      fakeModel('gpt-6-astra', { isDefault: true }),
      fakeModel('gpt-7-terra', { hidden: true }),
      fakeModel('gpt-6.1-terra'),
      fakeModel('gpt-6-sol'),
      fakeModel('gpt-6-luna'),
      fakeModel('gpt-5.6-sol'),
      fakeModel('gpt-5.6-terra'),
    ]);
    expect(recommendedDriverModel('codex', models)?.id).toBe('gpt-6.1-terra');
  });

  it('Codex：第一个 -terra 比第一个 -sol 旧一代（还没有 gpt-6.1-terra 的旧 CLI）时取 -sol', () => {
    const { models } = toCatalog([
      fakeModel('gpt-6.1-sol'),
      fakeModel('gpt-6-astra', { isDefault: true }),
      fakeModel('gpt-6-sol'),
      fakeModel('gpt-6-luna'),
      fakeModel('gpt-5.6-sol'),
      fakeModel('gpt-5.6-terra'),
    ]);
    expect(recommendedDriverModel('codex', models)?.id).toBe('gpt-6.1-sol');
    expect(recommendedDriverModel('codex', toCatalog([fakeModel('gpt-6-sol'), fakeModel('gpt-6-terra')]).models)?.id).toBe('gpt-6-terra');
  });

  it('Codex：没有 -terra 时取第一个 -sol（隐藏的不算），不取标了默认的那一个', () => {
    const { models } = toCatalog([
      fakeModel('gpt-7-sol', { hidden: true }),
      fakeModel('gpt-6-astra', { isDefault: true }),
      fakeModel('gpt-6-sol'),
      fakeModel('gpt-5.6-sol'),
    ]);
    expect(recommendedDriverModel('codex', models)?.id).toBe('gpt-6-sol');
    // 假 codex 的默认场景。
    expect(
      recommendedDriverModel('codex', toCatalog([fakeModel('fake-luna'), fakeModel('fake-sol', { isDefault: true })]).models)?.id,
    ).toBe('fake-sol');
  });
});
