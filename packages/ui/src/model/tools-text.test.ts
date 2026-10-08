import { describe, expect, it } from 'vitest';
import type { SpaceEntry } from '@baocut/protocol';
import { textModel, textView } from './models-test-fixtures.ts';
import { cloudModelOptions } from './tools-models.ts';
import { textJob, textResult } from './tools-test-fixtures.ts';
import {
  BLANK_TEXT,
  emptyInput,
  MAX_TEXT_INPUT,
  tooLong,
  againTextDraft,
  retryTextRequest,
  textCounter,
  textEffortLine,
  textFacts,
  textFileName,
  textHeaderChip,
  textProblems,
  textPrompt,
  textRequest,
  textSpaceEntry,
  textStatus,
  textTruncated,
} from './tools-text.ts';

describe('校验与请求', () => {
  it('没写要求、超过 16,000 字符（按码点数）', () => {
    expect(textProblems({ input: '  ' })).toEqual([emptyInput()]);
    expect(textProblems({ input: '写一段旁白' })).toEqual([]);
    expect(textProblems({ input: '字'.repeat(MAX_TEXT_INPUT) })).toEqual([]);
    expect(textProblems({ input: '😀'.repeat(MAX_TEXT_INPUT + 1) })).toEqual([tooLong()]);
    expect(tooLong()).toBe('一次最多输入 16,000 字符');
  });

  it('字数行：n / 16,000 字符，超了标出来', () => {
    expect(textCounter({ input: ' 你好 ' })).toEqual({ text: '2 / 16,000 字符', over: false });
    expect(textCounter({ input: 'a'.repeat(16_001) })).toEqual({ text: '16,001 / 16,000 字符', over: true });
  });

  it('请求是一条 user 消息，指名服务商与模型；推理强度与输出上限不给', () => {
    expect(textRequest({ input: ' 写一段旁白 ' }, { providerId: 'openai', modelId: 'gpt-5-mini' })).toEqual({
      messages: [{ role: 'user', content: '写一段旁白' }],
      provider: 'openai',
      model: 'gpt-5-mini',
    });
    expect(textRequest({ input: '总结要点' }, { providerId: 'openai', modelId: 'gpt-5-mini' }, { entryId: 'ent_doc' })).toEqual({
      messages: [{ role: 'user', content: '总结要点' }],
      provider: 'openai',
      model: 'gpt-5-mini',
      material: { entryId: 'ent_doc' },
    });
  });

  it('主按钮旁的现状：门、问题、这次用谁', () => {
    const options = cloudModelOptions(textView(), 'generateText');
    expect(options.map((o) => [o.key, o.usable])).toEqual([
      ['openai/gpt-5-mini', true],
      ['openai/gpt-4.1', true],
      ['google/gemini-2.5-flash', false],
    ]);
    const draft = { ...BLANK_TEXT };
    expect(textStatus(draft, null, false)).toEqual({ text: '请先连接一个文本模型', bad: true });
    expect(textStatus(draft, options[2]!, false)).toEqual({ text: '先连接 Google Gemini', bad: true });
    expect(textStatus(draft, options[0]!, false)).toEqual({ text: 'OpenAI · gpt-5-mini', bad: false });
    expect(textStatus(draft, options[0]!, true)).toEqual({ text: emptyInput(), bad: true });
    expect(textHeaderChip(options[0]!)).toBe('联网 · OpenAI · 按 token 计费');
    expect(textHeaderChip(null)).toBeNull();
  });
});

describe('推理强度', () => {
  it('推理强度用模型页的默认；模型不能调时照实说', () => {
    const tunable = textModel('gpt-5-mini', { efforts: ['low', 'high'] });
    expect(textEffortLine({ effort: null }, tunable)).toBe('推理强度 · 自动（模型页设的默认）');
    expect(textEffortLine({ effort: 'minimal' }, tunable)).toBe('推理强度 · 最低（模型页设的默认）');
    expect(textEffortLine({ effort: 'high' }, textModel('gpt-4.1'))).toBe('推理强度 · 这只模型不能调');
  });
});

describe('记录', () => {
  const done = textJob({
    state: 'completed',
    endedAt: '2026-10-03T10:15:00.123Z',
    result: { documentId: null, artifactId: 'sha256:t1', text: textResult({ length: 1234, usage: { inputTokens: 10, outputTokens: 900 } }) },
  });

  it('要求、事实、文件名与 Space 里那份同名', () => {
    expect(textPrompt(done)).toBe('写一段城市漫游旁白');
    expect(textFacts(done)).toBe('1,234 字 · 输出 900 token');
    expect(textFileName(done)).toBe('生成文本-20261003-101500.txt');
    const json = textJob({ ...done, result: { documentId: null, artifactId: 'sha256:t2', text: textResult({ mediaType: 'application/json', usage: null }) } });
    expect(textFileName(json)).toBe('生成文本-20261003-101500.json');
    expect(textFacts(json)).toBe('20 字 · JSON');
  });

  it('截断：警告或结束原因是 length', () => {
    expect(textTruncated(done)).toBe(false);
    const cut = textJob({ ...done, warnings: [{ code: 'output-truncated' }] });
    expect(textTruncated(cut)).toBe(true);
    expect(textFacts(cut)).toContain('到了输出上限，后面被截断');
    const byReason = textJob({ ...done, result: { documentId: null, artifactId: 'sha256:t1', text: textResult({ finishReason: 'length' }) } });
    expect(textTruncated(byReason)).toBe(true);
  });

  it('Space 里的文档：按产物 ID 找，进了废纸篓的不算', () => {
    const entry = (artifactId: string, trashedAt: string | null = null): SpaceEntry => ({
      id: `e-${artifactId}`,
      kind: 'document',
      name: '生成文本-20261003-101500.txt',
      fileName: '生成文本-20261003-101500.txt',
      source: { projectId: null, conversationId: null },
      relPath: '生成文本-20261003-101500.txt',
      size: 60,
      lastActivityAt: '2026-10-03T10:15:00.000Z',
      status: null,
      user: { favorite: false, displayName: null, trashedAt },
      ref: { artifactId },
    });
    expect(textSpaceEntry([entry('sha256:other'), entry('sha256:t1')], done)?.id).toBe('e-sha256:t1');
    expect(textSpaceEntry([entry('sha256:t1', '2026-10-03T11:00:00.000Z')], done)).toBeNull();
    expect(textSpaceEntry([entry('sha256:t1')], textJob())).toBeNull();
  });

  it('带回左边：要求与模型', () => {
    expect(againTextDraft(done)).toEqual({ input: '写一段城市漫游旁白', model: 'openai/gpt-5-mini' });
    expect(againTextDraft(textJob({ generation: undefined }))).toBeNull();
  });

  it('再试一次：照冻结的参数原样再提交，推理强度交回当初请求的那一档', () => {
    expect(retryTextRequest(done)).toEqual({
      messages: [{ role: 'user', content: '写一段城市漫游旁白' }],
      responseFormat: { type: 'text' },
      maxOutputTokens: 128_000,
      provider: 'openai',
      model: 'gpt-5-mini',
    });
    const tuned = textJob({
      generation: {
        capability: 'generateText',
        messages: [{ role: 'user', content: 'hi' }],
        responseFormat: { type: 'text' },
        maxOutputTokens: 100,
        temperature: 0.2,
        requestedEffort: 'minimal',
        effort: 'low',
        seed: 7,
      },
    });
    expect(retryTextRequest(tuned)).toMatchObject({ temperature: 0.2, effort: 'minimal', seed: 7, maxOutputTokens: 100 });
    expect(retryTextRequest(textJob({ generation: undefined }))).toBeNull();
  });
});
