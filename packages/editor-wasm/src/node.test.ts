import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EditorWasmError,
  SENTENCE_DERIVATION,
  applySpeakers,
  audioAnalysis,
  audioSheet,
  editorWasmAvailable,
  locateEditorWasm,
  sfxRecipes,
  sfxRender,
  sourceChapters,
  speakerProposal,
  speechSentences,
  templateBlank,
  templateBox,
  templateCatalog,
  templateDefinition,
  templateHit,
  templateInfo,
  templateInstance,
  templateNewLayer,
  templateRatioEquivalent,
} from './node.ts';

const built = editorWasmAvailable();
if (!built) console.warn('编辑语义的 WASM 还没有构建（npm run build:wasm），跳过');

const speech = {
  schema: 'baocut.speech/1',
  timescale: 1000,
  words: [
    { id: 'w0', start: 0, end: 400, text: 'Hello', speaker: 'a' },
    { id: 'w1', start: 500, end: 900, text: ' there;', speaker: 'a' },
    { id: 'w2', start: 1000, end: 1300, text: ' friend.', speaker: 'a' },
    { id: 'w3', start: 1400, end: 1600, text: ' Hidden', speaker: 'a', hidden: true },
    { id: 'w4', start: 3500, end: 3700, text: ' Next', speaker: 'a' },
  ],
};

describe.skipIf(!built)('editor-wasm（Node）', () => {
  it('分句与指纹出自字幕与翻译核心', () => {
    const result = speechSentences(speech);
    expect(result.derivation).toBe(SENTENCE_DERIVATION);
    expect(result.timescale).toBe(1000);
    expect(result.editViewHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.sentences.map((s) => s.id)).toEqual(['s-w0', 's-w4']);
    expect(result.sentences[0]).toMatchObject({
      wordIds: ['w0', 'w1', 'w2'],
      text: 'Hello there; friend.',
      speaker: 'a',
      start: 0,
      end: 1300,
    });
    expect(result.sentences[0]!.fingerprint).toMatch(/^3:w0:w2:[0-9a-z]+$/);
    // 隐藏的词不进句子，也不算停顿的起点之外的词。
    expect(result.sentences[1]!.wordIds).toEqual(['w4']);
  });

  it('同一份正文得出同一个结果；改一个字指纹就变', () => {
    const again = speechSentences(structuredClone(speech));
    expect(again).toEqual(speechSentences(speech));
    const edited = structuredClone(speech);
    edited.words[2]!.text = ' friends.';
    const changed = speechSentences(edited);
    expect(changed.sentences[0]!.fingerprint).not.toBe(again.sentences[0]!.fingerprint);
    expect(changed.sentences[1]!.fingerprint).toBe(again.sentences[1]!.fingerprint);
    expect(changed.editViewHash).not.toBe(again.editViewHash);
    // 全文指纹算全部的词（含隐藏的），改一个字就变。
    expect(again.contentFingerprint).toMatch(/^5:w0:w4:[0-9a-z]+$/);
    expect(changed.contentFingerprint).not.toBe(again.contentFingerprint);
  });

  it('读不了的正文抛 INVALID_SPEECH', () => {
    expect(() => speechSentences({ schema: 'baocut.speech/1', words: [{ id: 'w0', text: 'x' }] })).toThrow(EditorWasmError);
    try {
      speechSentences({ schema: 'baocut.caption/1', words: [] });
    } catch (error) {
      expect((error as EditorWasmError).code).toBe('INVALID_SPEECH');
    }
  });
});

describe.skipIf(!built)('editor-wasm：识别说话人（Node）', () => {
  const words = ['Hello', ' there,', ' how', ' are', ' you?'].map((text, i) => ({
    id: `w${i}`,
    start: i * 500,
    end: i * 500 + 400,
    text,
    speaker: 'a',
  }));
  const body = { schema: 'baocut.speech/1', timescale: 1000, speakers: [{ id: 'a', name: '说话人 1' }], words };

  it('提案复用重叠最多的已有说话人，新聚类新建说话人；应用按提案改词', () => {
    const proposal = speakerProposal(body, [], ['A', 'A', 'A', 'B', 'B']);
    expect(proposal.speakers.map((s) => [s.id, s.name, s.isNew, s.sentences])).toEqual([
      ['a', '说话人 1', false, 1],
      ['spk-2', '说话人 2', true, 1],
    ]);
    expect(proposal.wordSpeakers).toEqual({ w3: 'spk-2', w4: 'spk-2' });
    const applied = applySpeakers(body, [], proposal.wordSpeakers, [{ id: 'spk-2', name: '嘉宾' }]);
    expect((applied.speech.words as Array<{ speaker: string }>).map((w) => w.speaker)).toEqual(['a', 'a', 'a', 'spk-2', 'spk-2']);
    expect(applied.speech.speakers).toEqual([
      { id: 'a', name: '说话人 1' },
      { id: 'spk-2', name: '嘉宾' },
    ]);
    expect(applied.translations).toEqual([]);
  });

  it('labels 与词数不符抛 INVALID_PROPOSAL', () => {
    expect(() => speakerProposal(body, [], ['A'])).toThrow(expect.objectContaining({ code: 'INVALID_PROPOSAL' }));
  });
});

describe.skipIf(!built)('editor-wasm：来源自带章节（Node）', () => {
  const body = {
    schema: 'baocut.speech/1',
    timescale: 1000,
    speakers: [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ],
    words: [
      { id: 'w0', start: 0, end: 400, text: 'Hello.', speaker: 'a' },
      { id: 'w1', start: 60_000, end: 60_400, text: 'Next.', speaker: 'b' },
    ],
    sentences: null,
  };

  it('简介里的时间戳大纲吸到段落起点；不吸附时保留原时间', () => {
    const source = { description: 'Chapters:\n0:00 Intro\n0:59 Next part' };
    const snapped = sourceChapters({ speech: body, source, durationSeconds: 90 });
    expect(snapped.rows).toEqual([
      { title: 'Intro', start: 0, end: 60, status: 'matched' },
      { title: 'Next part', start: 60, end: 90, status: 'matched' },
    ]);
    expect(snapped.entries[1]!.anchor).toMatchObject({ tier: 'paragraph', id: 'p-w1', time: 60 });
    const parsed = sourceChapters({ source, durationSeconds: 90, snap: false });
    expect(parsed.entries.map((e) => [e.status, e.at])).toEqual([
      ['unanchored', 0],
      ['unanchored', 59],
    ]);
  });

  it('没有来源章节时返回空的结果', () => {
    expect(sourceChapters({ source: { title: 'x' }, durationSeconds: 10 }).sourceChapters).toEqual([]);
  });
  it('模板目录按界面语言给内置款，品牌库的一组在最后', () => {
    const zh = templateCatalog('zh-CN', []);
    expect(zh.length).toBeGreaterThan(1);
    const all = zh.flatMap((group) => group.items);
    expect(all.length).toBe(17);
    expect(all.every((item) => !item.brand)).toBe(true);
    const mine = { ...templateBlank<{ id: string; name: string; layers: [] }>('16:9', '我的'), id: 'brand-1' };
    const withBrand = templateCatalog('en', [mine]);
    const last = withBrand.at(-1);
    expect(last?.items).toEqual([{ doc: mine, brand: true }]);
    expect(withBrand[0]?.label).not.toBe(zh[0]?.label);
  });

  it('实例记来源，存回品牌库去掉来源；新建一层避开已占的 id', () => {
    const first = templateCatalog('en', [])[0]!.items[0]!.doc as {
      id: string;
      name: string;
      layers: { id: string; box: never }[];
      from?: string;
      builtin?: boolean;
    };
    const instance = templateInstance(first);
    expect(instance.from).toBe(first.id);
    expect(instance.builtin).toBeUndefined();
    const definition = templateDefinition(instance, 'Mine', 'brand-x');
    expect(definition).toMatchObject({ id: 'brand-x', name: 'Mine' });
    expect(definition.from).toBeUndefined();
    const layer = templateNewLayer<{ id: string; kind: string }>('progress', 'en', ['l-progress-1']);
    expect(layer).toMatchObject({ id: 'l-progress-2', kind: 'progress' });
    expect(templateInfo(instance).problem).toBeUndefined();
  });

  it('画幅同档、框夹进画面、命中跳过关掉的层', () => {
    expect(templateRatioEquivalent(null, 'original')).toBe(true);
    expect(templateRatioEquivalent('16:9', '32:18')).toBe(true);
    expect(templateRatioEquivalent('16:9', '9:16')).toBe(false);
    const clamped = templateBox({ op: 'clamp', box: { x: 95, y: -5, w: 20, h: 10 } });
    expect(clamped.x + clamped.w).toBeLessThanOrEqual(100);
    expect(clamped.y).toBeGreaterThanOrEqual(0);
    const doc = {
      id: 't',
      name: 't',
      layers: [
        { id: 'a', kind: 'text', text: 'x', color: '#fff', box: { x: 0, y: 0, w: 50, h: 50 } },
        { id: 'b', kind: 'text', text: 'y', color: '#fff', on: false, box: { x: 0, y: 0, w: 50, h: 50 } },
      ],
    };
    expect(templateHit(doc, 10, 10)).toBe('a');
    expect(templateHit(doc, 80, 80)).toBeNull();
    expect(() => templateDefinition({ id: 'x', name: 'x', layers: 'nope' } as never, 'n', 'i')).toThrow(EditorWasmError);
  });
});

it('finds the shipped WASM from a shared chunk outside the repository', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-editor-chunk-'));
  try {
    const main = path.join(root, 'out', 'main');
    fs.mkdirSync(path.join(main, 'chunks'), { recursive: true });
    fs.mkdirSync(path.join(main, 'generated'));
    const file = path.join(main, 'generated', 'editor.wasm');
    fs.writeFileSync(file, new Uint8Array());
    expect(locateEditorWasm(path.join(main, 'chunks'))).toBe(file);
    expect(locateEditorWasm(main)).toBe(file);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe.skipIf(!built)('editor-wasm audio（Node）', () => {
  it('analyzes PCM passed as bytes and renders SFX as WAV', () => {
    const rate = 16000;
    const pcm = new Float32Array(rate * 3);
    for (let beat = 0; beat < 6; beat++) {
      const start = rate / 4 + (beat * rate) / 2;
      for (let i = 0; i < 800; i++) pcm[start + i] = Math.exp((-i / rate) * 60) * Math.sin((2 * Math.PI * 1000 * i) / rate);
    }
    const result = audioAnalysis(pcm, { sampleRate: rate, fps: 25, beats: false });
    expect(result.frameCount).toBe(75);
    expect(result.frames.level).toHaveLength(75);
    expect(result.onsets.map((o) => Math.round(o.t * 4) / 4)).toEqual([0.25, 0.75, 1.25, 1.75, 2.25, 2.75]);
    expect(() => audioAnalysis(new Float32Array(0), { sampleRate: rate, fps: 25 })).toThrow(
      expect.objectContaining({ code: 'AUDIO_EMPTY' }),
    );
    const synced = audioAnalysis(pcm, { sampleRate: rate, fps: 25, beats: false, cues: [0.76, 1.5, 9] });
    expect(synced.sync?.cues.map((c) => c.status)).toEqual(['ok', 'none', 'outside']);
    expect(synced.sync?.chance).toBeGreaterThan(0);
    expect(result.sync).toBeUndefined();
    const sheet = audioSheet(pcm, { sampleRate: rate, width: 320, beats: false, cues: [0.76] });
    expect(sheet.width).toBe(320);
    expect(sheet.rgba.length).toBe(320 * sheet.height * 4);
    expect(sheet.height).toBeGreaterThan(100);

    const wav = sfxRender({ recipe: 'blip', seed: 1 });
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF');
    expect(wav.length).toBe(44 + Math.round(0.15 * 48000) * 4);
    expect(sfxRender({ recipe: 'blip', seed: 1 })).toEqual(wav);
    expect(() => sfxRender({ recipe: 'laser' })).toThrow(expect.objectContaining({ code: 'SFX_UNKNOWN_RECIPE' }));
    expect(sfxRecipes().map((r) => r.name)).toContain('whoosh');
  });
});
