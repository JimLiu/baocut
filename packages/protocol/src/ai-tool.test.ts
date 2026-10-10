import { describe, expect, it } from 'vitest';
import { aiToolParamsSchema } from './schemas.ts';
import { AI_TOOL_APPLY_KINDS, AI_TOOL_KINDS, AI_TOOL_PROMPT_MAX } from './pipelines.ts';
import { MAX_ATTACHMENTS_PER_MESSAGE } from './limits.ts';
import { SKILL_LIMITS } from './skill.ts';

describe('ai-tool 流程的参数', () => {
  const base = { videoId: 'vid_1', tool: 'summary', prompt: 'Summarize this video' };
  const ok = (params: Record<string, unknown>) => aiToolParamsSchema.safeParse(params).success;

  it('收最少的参数与完整的参数', () => {
    expect(ok(base)).toBe(true);
    expect(
      ok({
        ...base,
        tool: 'polish',
        range: { start: 12.5, end: 80 },
        documentId: 'doc_1',
        attachments: ['att_1'],
        skills: [{ id: 'polish-transcript' }, { id: 'video-summary' }],
        provider: 'openai',
        model: 'gpt-5',
      }),
    ).toBe(true);
    expect(ok({ ...base, prompt: '' })).toBe(true);
  });

  it('只收能直接调模型的工具', () => {
    for (const tool of AI_TOOL_KINDS) expect(ok({ ...base, tool })).toBe(true);
    for (const tool of ['retranscribe', 'cleanup', 'stale', 'cover', 'speakers', 'translate']) expect(ok({ ...base, tool })).toBe(false);
    expect(AI_TOOL_APPLY_KINDS).toEqual(['polish', 'chapters']);
  });

  it('拒绝多余字段、空视频、过长的提示词与倒着的范围', () => {
    expect(ok({ ...base, extra: 1 })).toBe(false);
    expect(ok({ ...base, videoId: '' })).toBe(false);
    expect(ok({ ...base, prompt: 'x'.repeat(AI_TOOL_PROMPT_MAX + 1) })).toBe(false);
    expect(ok({ ...base, range: { start: 10, end: 10 } })).toBe(false);
    expect(ok({ ...base, range: { start: -1, end: 10 } })).toBe(false);
    expect(ok({ ...base, range: { start: 0, end: 10, label: 'x' } })).toBe(false);
  });

  it('章节总是整篇：给了范围时拒绝', () => {
    expect(ok({ ...base, tool: 'chapters' })).toBe(true);
    expect(ok({ ...base, tool: 'chapters', range: { start: 0, end: 10 } })).toBe(false);
  });

  it('附件与 skill 按发送时的上限与写法', () => {
    expect(ok({ ...base, attachments: Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE }, (_, i) => `att_${i}`) })).toBe(true);
    expect(ok({ ...base, attachments: Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE + 1 }, (_, i) => `att_${i}`) })).toBe(false);
    expect(ok({ ...base, skills: [{ id: 'Not An Id' }] })).toBe(false);
    expect(ok({ ...base, skills: Array.from({ length: SKILL_LIMITS.perMessage + 1 }, (_, i) => ({ id: `s${i}` })) })).toBe(false);
  });
});
