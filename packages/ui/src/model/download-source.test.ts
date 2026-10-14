import { afterEach, describe, expect, it } from 'vitest';
import { LOCALES, MODELSCOPE_ENDPOINT, setLocale, type ModelInstallPlan } from '@baocut/protocol';
import { settingValueSchemas } from '@baocut/protocol/schemas';
import {
  addMirrorPatch,
  choosePatch,
  mirrorProblem,
  planKinds,
  removeMirrorPatch,
  sourceNotes,
  sourceState,
  updateMirrorPatch,
} from './download-source.ts';

afterEach(() => setLocale('zh-Hans'));

describe('sourceState', () => {
  it('lists the built-in sources first; nothing saved uses the first one', () => {
    const models = sourceState('models', null, []);
    expect(models.list.map((s) => s.id)).toEqual(['hf', 'ms']);
    expect(models.active.name).toBe('Hugging Face');
    const tools = sourceState('tools', null, undefined);
    expect(tools.list.map((s) => s.name)).toEqual(['GitHub']);
    expect(tools.active.endpoint).toBeNull();
  });

  it('reads the hub roots and either ModelScope host as the built-in sources', () => {
    for (const saved of ['https://huggingface.co', 'https://huggingface.co/', 'https://www.huggingface.co', '  ']) {
      expect(sourceState('models', saved, []).active.id).toBe('hf');
    }
    for (const saved of [MODELSCOPE_ENDPOINT, 'https://modelscope.cn/', 'http://www.modelscope.cn']) {
      expect(sourceState('models', saved, []).active.id).toBe('ms');
    }
  });

  it('matches a saved base to a mirror; a mirror without a name shows its host', () => {
    const mirrors = [
      { name: 'Office', base: 'http://10.0.0.2:8080/hf' },
      { name: '', base: 'https://hf-mirror.com' },
    ];
    const st = sourceState('models', 'HTTPS://hf-mirror.com/', mirrors);
    expect(st.list.map((s) => s.name)).toEqual(['Hugging Face', 'ModelScope', 'Office', 'hf-mirror.com']);
    expect(st.active.name).toBe('hf-mirror.com');
    expect(st.active.endpoint).toBe('https://hf-mirror.com');
  });

  it('lists a saved base that is not in the list as an unnamed mirror, without storing it yet', () => {
    const st = sourceState('tools', 'https://gh.example/dl', []);
    expect(st.active).toMatchObject({ name: 'gh.example', base: 'https://gh.example/dl', legacy: true });
    expect(st.list.map((s) => s.name)).toEqual(['GitHub', 'gh.example']);
  });
});

describe('mirrorProblem', () => {
  const st = sourceState('models', null, [{ name: 'Office', base: 'https://a.example' }]);

  it('wants a valid base URL that is not already listed (built-ins included)', () => {
    expect(mirrorProblem(st, { name: '', base: '' })).toMatch(/基址/);
    expect(mirrorProblem(st, { name: '', base: 'hf-mirror.com' })).not.toBeNull();
    expect(mirrorProblem(st, { name: '', base: 'https://u:p@mirror.example' })).not.toBeNull();
    expect(mirrorProblem(st, { name: '', base: 'https://huggingface.co/' })).toContain('Hugging Face');
    expect(mirrorProblem(st, { name: '', base: 'https://modelscope.cn' })).toContain('ModelScope');
    expect(mirrorProblem(st, { name: '', base: 'HTTPS://a.example/' })).toContain('Office');
    expect(mirrorProblem(st, { name: 'x'.repeat(41), base: 'https://b.example' })).toMatch(/40/);
    expect(mirrorProblem(st, { name: 'B', base: 'https://b.example' })).toBeNull();
  });

  it('does not count the mirror being edited as a duplicate', () => {
    expect(mirrorProblem(st, { name: 'Office 2', base: 'https://a.example' }, st.list[2])).toBeNull();
  });
});

describe('patches', () => {
  it('choosing a source writes only the in-use base', () => {
    const st = sourceState('models', null, []);
    expect(choosePatch('models', st.list[1]!)).toEqual({ 'models.downloadEndpoint': MODELSCOPE_ENDPOINT });
    expect(choosePatch('tools', sourceState('tools', 'https://gh.example', []).list[0]!)).toEqual({ 'tools.downloadEndpoint': null });
  });

  it('adding a mirror stores it and switches to it; the patch passes the contract', () => {
    const st = sourceState('models', null, [{ name: 'Office', base: 'https://a.example' }]);
    const patch = addMirrorPatch('models', st, { name: ' Mirror ', base: 'https://hf-mirror.com/ ' });
    expect(patch).toEqual({
      'models.downloadMirrors': [
        { name: 'Office', base: 'https://a.example' },
        { name: 'Mirror', base: 'https://hf-mirror.com' },
      ],
      'models.downloadEndpoint': 'https://hf-mirror.com',
    });
    expect(settingValueSchemas['models.downloadMirrors'].safeParse(patch['models.downloadMirrors']).success).toBe(true);
  });

  it('adding a mirror keeps a saved base that was not in the list', () => {
    const st = sourceState('tools', 'https://old.example', []);
    expect(addMirrorPatch('tools', st, { name: '', base: 'https://new.example' })).toEqual({
      'tools.downloadMirrors': [
        { name: '', base: 'https://old.example' },
        { name: '', base: 'https://new.example' },
      ],
      'tools.downloadEndpoint': 'https://new.example',
    });
  });

  it('editing the mirror in use moves the in-use base with it; editing another leaves it', () => {
    const mirrors = [
      { name: 'A', base: 'https://a.example' },
      { name: 'B', base: 'https://b.example' },
    ];
    const st = sourceState('models', 'https://a.example', mirrors);
    expect(updateMirrorPatch('models', st, st.list[2]!, { name: 'A2', base: 'https://a2.example' })).toEqual({
      'models.downloadMirrors': [
        { name: 'A2', base: 'https://a2.example' },
        { name: 'B', base: 'https://b.example' },
      ],
      'models.downloadEndpoint': 'https://a2.example',
    });
    expect(updateMirrorPatch('models', st, st.list[3]!, { name: '', base: 'https://b.example' })).toEqual({
      'models.downloadMirrors': [
        { name: 'A', base: 'https://a.example' },
        { name: '', base: 'https://b.example' },
      ],
    });
  });

  it('editing a saved base that was not in the list stores it', () => {
    const st = sourceState('models', 'https://old.example', []);
    expect(updateMirrorPatch('models', st, st.active, { name: 'Old', base: 'https://old.example' })).toEqual({
      'models.downloadMirrors': [{ name: 'Old', base: 'https://old.example' }],
      'models.downloadEndpoint': 'https://old.example',
    });
  });

  it('removing the mirror in use falls back to the default in the same patch', () => {
    const mirrors = [
      { name: 'A', base: 'https://a.example' },
      { name: 'B', base: 'https://b.example' },
    ];
    const st = sourceState('models', 'https://b.example', mirrors);
    expect(removeMirrorPatch('models', st, st.list[2]!)).toEqual({
      patch: { 'models.downloadMirrors': [{ name: 'B', base: 'https://b.example' }] },
      fellBack: null,
    });
    expect(removeMirrorPatch('models', st, st.list[3]!)).toEqual({
      patch: { 'models.downloadMirrors': [{ name: 'A', base: 'https://a.example' }], 'models.downloadEndpoint': null },
      fellBack: 'Hugging Face',
    });
    const legacy = sourceState('tools', 'https://old.example', []);
    expect(removeMirrorPatch('tools', legacy, legacy.active)).toEqual({
      patch: { 'tools.downloadMirrors': [], 'tools.downloadEndpoint': null },
      fellBack: 'GitHub',
    });
  });
});

describe('planKinds', () => {
  const component = (origin?: 'github-release') => ({
    component: 'x',
    repo: 'r',
    revision: 'v',
    ...(origin ? { origin } : {}),
    action: 'download' as const,
    files: [],
    bytes: 1,
  });
  it('groups GitHub release components under tools, the rest under the model hub', () => {
    const plan = { components: [component('github-release'), component()] } as Pick<ModelInstallPlan, 'components'>;
    expect(planKinds(plan)).toEqual(['models', 'tools']);
    expect(planKinds({ components: [component()] })).toEqual(['models']);
  });
});

describe('copy', () => {
  it('keeps brand names and the environment variable in every locale', () => {
    for (const locale of LOCALES) {
      setLocale(locale);
      const models = sourceState('models', MODELSCOPE_ENDPOINT, []);
      expect(models.list[0]!.hint).toContain('huggingface.co');
      expect(models.list[1]!.hint).toContain('modelscope.cn');
      expect(sourceNotes('models', models.active)[0]).toMatch(/whisper\.cpp/);
      expect(sourceNotes('models', models.active).at(-1)).toContain('BAOCUT_MODELS_ENDPOINT');
      expect(sourceNotes('tools', sourceState('tools', null, []).active).at(-1)).toContain('BAOCUT_TOOLS_ENDPOINT');
    }
  });
});
