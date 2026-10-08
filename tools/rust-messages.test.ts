import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCALES, setLocale } from '../packages/protocol/src/i18n.ts';
import { formatRef, localizeText, type MessageParam } from '../packages/protocol/src/message-ref.ts';
import '../packages/protocol/src/messages/index.ts';
import { engineHostMessages } from '../packages/protocol/src/messages/engine-host/engineHost.ts';
import { engineMessages } from '../packages/protocol/src/messages/video-engine/engine.ts';
import { videoModelMessages } from '../packages/protocol/src/messages/video-model/videoModel.ts';
import { timeMessages } from '../packages/protocol/src/messages/editor-semantics/time.ts';
import { listMessages } from '../packages/protocol/src/messages/message-ref/list.ts';
import { engineError } from '../packages/runtime-core/src/videos/engine-host.ts';
import { messagesIn, placeholders, rustMessages } from './rust-messages.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const messages = rustMessages(root);
const RUST_AREAS = { engine: engineMessages, engineHost: engineHostMessages, videoModel: videoModelMessages, time: timeMessages, list: listMessages };
const MISSING = '\u0000missing';

/** 把每个占位符原样作为参数：渲染出来的英文应当与模板一字不差。 */
function selfParams(template: string): Record<string, MessageParam> {
  return Object.fromEntries(placeholders(template).map((name) => [name, `{${name}}`]));
}

beforeEach(() => {
  vi.stubEnv('BAOCUT_LOCALE', undefined);
  setLocale('en');
});
afterEach(() => vi.unstubAllEnvs());

describe('Rust msg! 与 TS 文案目录', () => {
  it('找得到 Rust 里的消息', () => {
    expect(messages.length).toBeGreaterThan(300);
    expect(messages.find((m) => m.key === 'engine.notFound')).toMatchObject({ template: '{kind} {id} does not exist' });
  });

  it('同一个键处处用同一个模板', () => {
    const byKey = new Map<string, Set<string>>();
    for (const m of messages) byKey.set(m.key, (byKey.get(m.key) ?? new Set()).add(m.template));
    const conflicts = [...byKey].filter(([, templates]) => templates.size > 1).map(([key, templates]) => `${key}: ${[...templates].join(' | ')}`);
    expect(conflicts).toEqual([]);
  });

  it('每个键都已登记，英文与 Rust 模板一致', () => {
    const wrong = messages.flatMap((m) => {
      const rendered = formatRef({ key: m.key, params: selfParams(m.template) }, MISSING, 'en');
      return rendered === m.template ? [] : [`${m.file}:${m.line} ${m.key}: ${rendered === MISSING ? '没有登记' : rendered}`];
    });
    expect(wrong).toEqual([]);
  });

  it('每种译文都用上全部参数', () => {
    const wrong = LOCALES.filter((locale) => locale !== 'en').flatMap((locale) =>
      messages.flatMap((m) => {
        const rendered = formatRef({ key: m.key, params: selfParams(m.template) }, MISSING, locale);
        const lost = placeholders(m.template).filter((name) => !rendered.includes(`{${name}}`));
        return lost.length ? [`${locale} ${m.key}: ${lost.join(', ')}`] : [];
      }),
    );
    expect(wrong).toEqual([]);
  });

  it('目录里没有 Rust 已经不用的键', () => {
    const used = new Set(messages.map((m) => m.key));
    const stale = Object.entries(RUST_AREAS).flatMap(([area, builders]) => Object.keys(builders).map((name) => `${area}.${name}`)).filter((key) => !used.has(key));
    expect(stale).toEqual([]);
  });
});

describe('messagesIn', () => {
  it('处理转义，跳过注释与测试模块', () => {
    const source = [
      'fn a() { msg!("x.one", "Say \\"hi\\" \\u{2014} {name}", name); }',
      '/// msg!("x.doc", "in a doc comment")',
      'fn b() { msg!(',
      '    "x.two",',
      '    "first \\',
      '     second",',
      '); }',
      '#[cfg(test)]',
      'mod tests { fn t() { let _ = \'{\'; msg!("x.test", "only in tests"); } }',
      'fn c() { msg!("x.three", "after tests"); }',
    ].join('\n');
    expect(messagesIn(source).map(({ key, template }) => [key, template])).toEqual([
      ['x.one', 'Say "hi" — {name}'],
      ['x.two', 'first second'],
      ['x.three', 'after tests'],
    ]);
    expect(placeholders('{{literal}} {a} and {b_2}')).toEqual(['a', 'b_2']);
  });
});

describe('引擎错误的引用', () => {
  // 与 `crates/video-engine/src/error.rs` 的单测同一个形状：实体种类是嵌套的引用。
  const body = {
    code: 'ENTITY_NOT_FOUND',
    message: 'Clip item_1 does not exist',
    messageRef: { key: 'engine.notFound', params: { kind: { key: 'engine.kindItem', text: 'Clip' }, id: 'item_1' } },
    entityIds: ['item_1'],
    inputRevisions: [],
    retryability: 'after-refresh' as const,
    details: null,
    recovery: 'Re-read the video, then choose the target again',
    recoveryRef: { key: 'engine.notFoundRecovery' },
  };

  it('按当前语言展开，嵌套的种类也跟着换', () => {
    expect(localizeText(body.message, body.messageRef)).toBe('Clip item_1 does not exist');
    setLocale('zh-Hans');
    expect(localizeText(body.message, body.messageRef)).toBe('片段 item_1 不存在');
    expect(localizeText(body.recovery, body.recoveryRef)).toBe('重新读取视频之后再选择目标');
  });

  it('认不出的键照用英文缺省文字', () => {
    setLocale('zh-Hans');
    expect(localizeText('Something new', { key: 'engine.fromTheFuture' })).toBe('Something new');
  });

  it('RpcError 带着引用，文字是 Runtime 的语言', () => {
    setLocale('zh-Hans');
    const error = engineError(body);
    expect(error.code).toBe('not-found');
    expect(error.message).toBe('片段 item_1 不存在');
    expect(error.messageRef).toEqual(body.messageRef);
    expect(error.toPayload()).toMatchObject({ messageRef: body.messageRef });
  });

  it('拼接的多条原因逐条展开', () => {
    const problems = { key: 'list.join', params: { head: { key: 'time.leadingZero', text: 'x' }, tail: { key: 'engine.overlap', text: 'y' } } };
    setLocale('zh-Hans');
    expect(formatRef({ key: 'engine.bodyNotSchema', params: { schema: 'baocut.cuts/1', problems } }, '')).toBe(
      '正文不合 baocut.cuts/1：整数不能有前导零；同一轨道上的片段不能重叠',
    );
  });
});
