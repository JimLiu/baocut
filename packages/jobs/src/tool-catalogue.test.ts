import { describe, expect, it } from 'vitest';
import { MODEL_SERVICE_CAPABILITIES, TOOL_CATEGORIES, TOOL_INPUT_KINDS } from '@baocut/protocol';
import { TOOL_CATALOGUE, TRANSCRIBE_PIPELINE, toolDefinition } from './tool-catalogue.ts';
import { DUB_PIPELINE } from './pipelines/dub.ts';
import { LINK_IMPORT_PIPELINE } from './pipelines/link-import.ts';
import { TRANSCODE_PIPELINE } from './pipelines/transcode.ts';
import { TRANSLATE_PIPELINE } from './pipelines/translate.ts';
import { TRANSLATE_SUBTITLES_PIPELINE } from './pipelines/translate-subtitles.ts';

/** 工具目录的静态注册表（架构设计 §7.9）：首批工具、声明完整、ID 稳定。 */

describe('工具目录', () => {
  it('十个工具按组排列，ID 唯一且是小写连字符', () => {
    expect(TOOL_CATALOGUE.map((t) => t.id)).toEqual([
      'transcribe',
      'translate-subtitles',
      'dub',
      'synthesize-speech',
      'generate-text',
      'generate-image',
      'link-import',
      'compress-video',
      'merge-video',
      'extract-audio',
    ]);
    for (const tool of TOOL_CATALOGUE) {
      expect(tool.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(tool.label).not.toBe('');
      expect(TOOL_CATEGORIES).toContain(tool.category);
      expect(tool.inputs.length).toBeGreaterThan(0);
      for (const input of tool.inputs) expect(TOOL_INPUT_KINDS).toContain(input);
      expect(tool.results.length).toBeGreaterThan(0);
      for (const capability of [...tool.capabilities, ...tool.optionalCapabilities])
        expect(MODEL_SERVICE_CAPABILITIES).toContain(capability);
      // 一种能力不会同时是必需与可选的。
      expect(tool.capabilities.filter((c) => tool.optionalCapabilities.includes(c))).toEqual([]);
      // 按输入换执行方式时，那种输入要在 inputs 里。
      for (const input of Object.keys(tool.executionByInput ?? {})) expect(tool.inputs).toContain(input);
      // 接受视频输入的工具才有候选规则。
      expect(tool.candidates !== null).toBe(tool.inputs.includes('video'));
    }
  });

  it('每个工具对应一个流程或一种直接任务，依赖照实声明', () => {
    expect(toolDefinition('transcribe')).toMatchObject({
      execution: { kind: 'pipeline', method: 'pipelines.start', pipeline: TRANSCRIBE_PIPELINE },
      inputs: ['file', 'video'],
      // 只给文件时结果是保存位置里的 TXT 与 SRT。
      results: ['artifact', 'video'],
      capabilities: ['transcribe'],
      externalTools: [],
      optionalExternalTools: [],
      network: 'none',
      candidates: 'videos',
    });
    expect(TRANSCRIBE_PIPELINE).toBe('transcribe');
    // 翻译字幕两种做法：视频里的文稿写成新的译文，字幕文件翻译成新的字幕文件（文件到文件）。
    expect(toolDefinition('translate-subtitles')).toMatchObject({
      inputs: ['video', 'document', 'file'],
      results: ['video', 'artifact'],
      execution: { pipeline: TRANSLATE_PIPELINE, params: { captions: true } },
      executionByInput: { file: { kind: 'pipeline', method: 'pipelines.start', pipeline: TRANSLATE_SUBTITLES_PIPELINE } },
      capabilities: ['generateText'],
      candidates: 'videos-with-transcript',
    });
    expect(toolDefinition('dub')).toMatchObject({
      execution: { pipeline: DUB_PIPELINE },
      capabilities: ['synthesizeSpeech'],
      optionalCapabilities: ['generateText'],
      externalTools: ['ffmpeg'],
      candidates: 'videos-with-transcript',
    });
    expect(toolDefinition('link-import')).toMatchObject({
      execution: { pipeline: LINK_IMPORT_PIPELINE },
      externalTools: ['yt-dlp'],
      network: 'required',
      results: ['artifact'],
    });
    expect(toolDefinition('compress-video')).toMatchObject({
      execution: { pipeline: TRANSCODE_PIPELINE, params: { action: 'compress' } },
      externalTools: ['ffmpeg'],
      candidates: null,
    });
    expect(toolDefinition('extract-audio')).toMatchObject({
      label: '提取音频',
      category: 'video-file',
      inputs: ['file'],
      results: ['artifact'],
      execution: { kind: 'pipeline', method: 'pipelines.start', pipeline: TRANSCODE_PIPELINE, params: { action: 'extract-audio' } },
      externalTools: ['ffmpeg'],
      candidates: null,
    });
    expect(toolDefinition('merge-video')).toMatchObject({ execution: { pipeline: TRANSCODE_PIPELINE, params: { action: 'merge' } } });
    // Space 里的文档、字幕条目经 `material` 当素材（§7.9）。
    expect(toolDefinition('synthesize-speech')).toMatchObject({
      category: 'speech',
      inputs: ['text', 'document'],
      results: ['artifact'],
      execution: { kind: 'job', method: 'models.synthesizeSpeech', capability: 'synthesizeSpeech' },
    });
    expect(toolDefinition('generate-image')?.execution).toEqual({
      kind: 'job',
      method: 'models.generateImage',
      capability: 'generateImage',
    });
    expect(toolDefinition('generate-text')?.execution).toEqual({ kind: 'job', method: 'models.generateText', capability: 'generateText' });
    expect(toolDefinition('generate-text')?.inputs).toEqual(['text', 'document']);
    expect(toolDefinition('nope')).toBeNull();
  });

  it('分成三组：语音与字幕、文字与图片、视频文件（§7.9，产品设计 §2.7）', () => {
    const groups = Object.fromEntries(TOOL_CATEGORIES.map((c) => [c, TOOL_CATALOGUE.filter((t) => t.category === c).map((t) => t.id)]));
    expect(groups).toEqual({
      speech: ['transcribe', 'translate-subtitles', 'dub', 'synthesize-speech'],
      'text-image': ['generate-text', 'generate-image'],
      'video-file': ['link-import', 'compress-video', 'merge-video', 'extract-audio'],
    });
  });
});
