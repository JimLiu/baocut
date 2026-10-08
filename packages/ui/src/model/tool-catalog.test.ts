import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_LABELS,
  INPUT_LABELS,
  TOOL_GROUPS,
  TOOLS,
  artifactText,
  inputOptions,
  isFileVideoTool,
  isVideoTool,
  openable,
  outputOf,
  resultLine,
  spaceKindsOf,
  targetOptions,
  toolById,
  toolIdOf,
} from './tool-catalog.ts';

/* 设计稿 model-tools.test.js 第 19–64 行的用例，工具 ID 换成 Runtime 注册表的 ID。 */

describe('工具目录', () => {
  it('按处理的对象分三组：语音与字幕、文字与图片、视频文件（产品设计 §2.7，`TOOL_CATEGORIES` 的顺序）', () => {
    expect(TOOL_GROUPS.map((g) => [g.key, g.label])).toEqual([
      ['speech', '语音与字幕'],
      ['text-image', '文字与图片'],
      ['video-file', '视频文件'],
    ]);
    expect(TOOL_GROUPS[0]!.tools.map((t) => t.id)).toEqual(['transcribe', 'translate-subtitles', 'dub', 'synthesize-speech']);
    expect(TOOL_GROUPS[1]!.tools.map((t) => t.id)).toEqual(['generate-text', 'generate-image']);
    expect(TOOL_GROUPS[2]!.tools.map((t) => t.id)).toEqual(['link-import', 'compress-video', 'merge-video', 'extract-audio']);
    expect(TOOL_GROUPS.every((g) => g.desc.length > 0)).toBe(true);
    expect(openable('link-import')?.name).toBe('下载视频');
    expect(openable('transcribe')?.group).toBe('speech');
    expect(openable('dub')?.name).toBe('翻译配音');
    expect(openable('generate-text')?.group).toBe('text-image');
    expect(openable('extract-audio')?.name).toBe('提取音频');
    expect(openable('extract-audio')?.group).toBe('video-file');
    expect(openable('remote')).toBeNull();
    expect(openable('merge-video')?.name).toBe('合并视频');
    expect(openable('nope')).toBeNull();
    expect(TOOLS.some((t) => t.planned)).toBe(false);
    for (const t of TOOLS) {
      expect(['video', 'artifact']).toContain(t.output);
      expect(t.inputs.length).toBeGreaterThan(0);
      for (const i of t.inputs) {
        expect(INPUT_LABELS[i.kind]).toBeTruthy();
        expect(['video', 'artifact']).toContain(i.output);
      }
      for (const a of t.artifacts) expect(ARTIFACT_LABELS[a]).toBeTruthy();
      // 只写进视频的工具（翻译配音）不产出条目；其余缺省产出 Space 里的条目。
      if (t.output === 'video') expect(t.artifacts).toEqual([]);
      else expect(t.artifacts.length).toBeGreaterThan(0);
    }
  });

  it('旧版短名落到注册表 ID，未知的认不出', () => {
    expect(toolIdOf('translate')).toBe('translate-subtitles');
    expect(toolIdOf('link')).toBe('link-import');
    expect(toolIdOf('tts')).toBe('synthesize-speech');
    expect(toolIdOf('image')).toBe('generate-image');
    expect(toolIdOf('text')).toBe('generate-text');
    expect(toolIdOf('compress')).toBe('compress-video');
    expect(toolIdOf('merge')).toBe('merge-video');
    expect(toolIdOf('extract')).toBe('extract-audio');
    expect(toolIdOf('transcribe')).toBe('transcribe');
    expect(toolIdOf('constructor')).toBeNull();
    expect(toolIdOf('')).toBeNull();
    expect(toolIdOf(undefined)).toBeNull();
    expect(toolById('tts')?.id).toBe('synthesize-speech');
    expect(isVideoTool('dub')).toBe(true);
    expect(isVideoTool('generate-text')).toBe(false);
    // 「视频工具」是页面机制（视频选择器、运行页），与分组无关：下载视频在视频文件组里，照样是。
    expect(isVideoTool('link-import')).toBe(true);
    expect(isVideoTool('extract-audio')).toBe(false);
    expect(['compress-video', 'merge-video', 'extract-audio'].every((id) => isFileVideoTool(id as 'extract-audio'))).toBe(true);
    expect(isFileVideoTool('transcribe')).toBe(false);
  });

  it('输入来源与结果从声明派生：转录三选一（链接由从链接导入执行）、翻译字幕的文件输入得到产物', () => {
    expect(inputOptions('transcribe').map((o) => o.label)).toEqual(['本机文件', 'Space', '链接']);
    expect(inputOptions('transcribe').map((o) => o.via)).toEqual([null, null, 'link-import']);
    expect(inputOptions('translate-subtitles').map((o) => [o.key, o.label, o.output])).toEqual([
      ['space', 'Space', 'artifact'],
      ['file', '本机字幕文件', 'artifact'],
    ]);
    expect(inputOptions('translate-subtitles')[0]!.needs).toBe('transcript');
    expect(inputOptions('translate-subtitles')[1]!.accept).toEqual(['.srt', '.vtt']);
    expect(inputOptions('dub').map((o) => o.key)).toEqual(['video']);
    expect(outputOf('transcribe', 'link')).toBe('artifact');
    expect(inputOptions('synthesize-speech').map((o) => o.key)).toEqual(['text', 'space']);
    // 文本生成的 Space 条目是附带的素材，不是另一种来源：不进切换，但收的种类照样算。
    expect(inputOptions('generate-text').map((o) => o.key)).toEqual(['text']);
    expect(spaceKindsOf('generate-text')).toEqual(['document', 'subtitle']);
    expect(spaceKindsOf('extract-audio')).toEqual(['video-file', 'export', 'audio']);
    expect(spaceKindsOf('generate-image')).toEqual([]);
    expect(outputOf('translate-subtitles', 'file')).toBe('artifact');
    expect(outputOf('dub', 'file')).toBeNull();
    expect(inputOptions('nope')).toEqual([]);
    expect(resultLine('transcribe')).toBe('结果：Space 里的文档与字幕条目；也可以新建视频；选可编辑的视频时写进它');
    expect(resultLine('translate-subtitles')).toBe('结果：Space 里的字幕条目；选可编辑的视频时写进它');
    expect(resultLine('dub')).toBe('结果：写进你选的视频');
    expect(resultLine('synthesize-speech')).toBe('结果：Space 里的音频条目');
    expect(resultLine('extract-audio')).toBe('结果：Space 里的音频条目');
    expect(artifactText([])).toBe('产物条目');
    expect(resultLine('nope')).toBe('');
  });

  it('下载视频：链接输入得到文件，不需要视频目标', () => {
    expect(inputOptions('link-import').map((o) => [o.key, o.output])).toEqual([['link', 'artifact']]);
    expect(outputOf('link-import', 'link')).toBe('artifact');
    expect(targetOptions('link-import')).toEqual([]);
    expect(resultLine('link-import')).toContain('视频文件');
  });
});
