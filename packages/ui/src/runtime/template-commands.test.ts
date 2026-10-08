import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLocale, setLocale, type Locale, type MediaHandle, type TemplateListResult, type TemplateSummary } from '@baocut/protocol';
import { emptyTemplateCatalog, useTemplateCatalog } from '../state/template-catalog-store.ts';
import { RuntimeSession } from './session.ts';
import { forgetTemplateFile, loadTemplates, resetTemplateCommands, templateFileUrl, templatePrompt } from './template-commands.ts';

function summary(id: string, version = '1.0.0'): TemplateSummary {
  return {
    manifest: {
      schema: 1,
      id,
      version,
      kind: 'scene',
      title: id,
      summary: '一句话',
      description: '一小段',
      language: 'zh-CN',
      category: 'marketing',
      ratio: '16:9',
      durationSeconds: 30,
      brief: '示例',
      author: 'BaoCut',
      source: 'official',
      license: 'Apache-2.0',
      tags: [],
      cover: { file: 'cover.png', tone: 'blue', figure: 'bars' },
      preview: { beats: ['一', '二', '三'] },
    },
    origin: 'user',
    languages: ['zh-CN'],
    files: { cover: true, preview: false, assets: 0 },
  };
}

/** 假的会话：只有 `client.request`，按方法名回答，记下每次调用。 */
function fakeSession(answer: (method: string, params: Record<string, unknown>) => unknown) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const session = {
    client: {
      request: async (method: string, params: Record<string, unknown>) => {
        calls.push({ method, params });
        return answer(method, params);
      },
    },
  } as unknown as Pick<RuntimeSession, 'client'>;
  return { session, calls };
}

const startLocale = getLocale();

/** 测试进程用 BAOCUT_LOCALE 固定了语言：换语言时连它一起换。 */
function switchLocale(locale: Locale): void {
  vi.stubEnv('BAOCUT_LOCALE', locale);
  setLocale(locale);
}

afterEach(() => {
  vi.unstubAllEnvs();
  setLocale(startLocale);
  resetTemplateCommands();
  useTemplateCatalog.setState(emptyTemplateCatalog());
});

describe('模板目录', () => {
  it('同时要几次只发一次；取到后按来源与 id 排好放进镜像，诊断原样带上', async () => {
    const result: TemplateListResult = {
      templates: [summary('zeta'), summary('alpha')],
      diagnostics: [
        { code: 'invalid', origin: 'user', dir: 'broken', path: '/home/templates/broken', message: '清单不合规', issues: ['缺 title'] },
      ],
    };
    const { session, calls } = fakeSession(() => result);
    await Promise.all([loadTemplates(session), loadTemplates(session)]);
    expect(calls).toHaveLength(1);
    const state = useTemplateCatalog.getState();
    expect(state).toMatchObject({ status: 'ready', loaded: true, error: null });
    expect(state.templates.map((t) => t.id)).toEqual(['alpha', 'zeta']);
    expect(state.diagnostics).toHaveLength(1);
  });

  it('按当前界面语言要；取的过程中换了语言，旧语言的结果不放进镜像，新语言另取一次', async () => {
    switchLocale('ja');
    const answers: Record<string, (result: TemplateListResult) => void> = {};
    const { session, calls } = fakeSession(
      (_method, params) => new Promise((resolve) => (answers[String(params.language)] = resolve)),
    );
    const first = loadTemplates(session);
    expect(calls.map((c) => c.params)).toEqual([{ language: 'ja' }]);
    switchLocale('fr');
    const second = loadTemplates(session);
    expect(calls.map((c) => c.params)).toEqual([{ language: 'ja' }, { language: 'fr' }]);
    answers.fr!({ templates: [summary('fr-only')], diagnostics: [] });
    await second;
    answers.ja!({ templates: [summary('ja-only')], diagnostics: [] });
    await first;
    expect(useTemplateCatalog.getState().templates.map((t) => t.id)).toEqual(['fr-only']);
  });

  it('取失败：没取到过时报失败；取到过的列表不清掉', async () => {
    let fail = true;
    const { session } = fakeSession(() => {
      if (fail) throw new Error('与 Runtime 的连接已断开');
      return { templates: [summary('alpha')], diagnostics: [] };
    });
    await loadTemplates(session);
    expect(useTemplateCatalog.getState()).toMatchObject({ status: 'failed', loaded: false, error: '与 Runtime 的连接已断开' });
    fail = false;
    await loadTemplates(session);
    expect(useTemplateCatalog.getState()).toMatchObject({ status: 'ready', loaded: true });
    fail = true;
    await loadTemplates(session);
    expect(useTemplateCatalog.getState()).toMatchObject({ status: 'failed', loaded: true });
    expect(useTemplateCatalog.getState().templates).toHaveLength(1);
  });
});

describe('提示词', () => {
  it('按 id@版本:语言 缓存；失败的不记，下次重取', async () => {
    let fail = true;
    const { session, calls } = fakeSession((_method, params) => {
      if (fail) throw new Error('没有这个模板');
      return { template: summary(String(params.id)), prompt: `正文：${String(params.id)}（${String(params.language)}）` };
    });
    await expect(templatePrompt(session, 'alpha', '1.0.0', 'en')).rejects.toThrow('没有这个模板');
    fail = false;
    expect(await templatePrompt(session, 'alpha', '1.0.0', 'en')).toBe('正文：alpha（en）');
    expect(await templatePrompt(session, 'alpha', '1.0.0', 'en')).toBe('正文：alpha（en）');
    expect(await templatePrompt(session, 'alpha', '1.0.0', 'ja')).toBe('正文：alpha（ja）');
    expect(calls.map((c) => [c.method, c.params.id, c.params.language])).toEqual([
      ['templates.get', 'alpha', 'en'],
      ['templates.get', 'alpha', 'en'],
      ['templates.get', 'alpha', 'ja'],
    ]);
  });
});

describe('随附文件', () => {
  it('句柄到期前复用，快到期或报错后重新要', async () => {
    let n = 0;
    let expiresIn = 10 * 60_000;
    const { session, calls } = fakeSession((_method, params): MediaHandle => {
      n++;
      return {
        url: `http://media/${String(params.path)}?n=${n}`,
        expiresAt: new Date(Date.now() + expiresIn).toISOString(),
      } as MediaHandle;
    });
    expect(await templateFileUrl(session, 'alpha', 'cover.png')).toBe('http://media/cover.png?n=1');
    expect(await templateFileUrl(session, 'alpha', 'cover.png')).toBe('http://media/cover.png?n=1');
    forgetTemplateFile('alpha', 'cover.png');
    expiresIn = 10_000;
    expect(await templateFileUrl(session, 'alpha', 'cover.png')).toBe('http://media/cover.png?n=2');
    expect(await templateFileUrl(session, 'alpha', 'cover.png')).toBe('http://media/cover.png?n=3');
    expect(calls.every((c) => c.method === 'templates.openHandle' && c.params.id === 'alpha')).toBe(true);
  });
});

describe('带场景模板发送', () => {
  it('template 原样交给 conversations.send；不挂时不带这个字段', async () => {
    const { session, calls } = fakeSession(() => ({ taskId: 'task_1' }));
    const send = RuntimeSession.prototype.send;
    await send.call(session as RuntimeSession, 'conv_1', '讲讲我的猫', undefined, [], { id: 'promo-ad', version: '1.0.0' });
    await send.call(session as RuntimeSession, 'conv_1', '讲讲我的猫');
    expect(calls[0]).toMatchObject({
      method: 'conversations.send',
      params: { conversationId: 'conv_1', text: '讲讲我的猫', template: { id: 'promo-ad', version: '1.0.0' } },
    });
    expect(calls[0]!.params).not.toHaveProperty('attachments');
    expect(calls[1]!.params).not.toHaveProperty('template');
  });
});
