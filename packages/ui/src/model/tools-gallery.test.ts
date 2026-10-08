import { describe, expect, it } from 'vitest';
import type { ModelCapabilitiesView, PipelineInfo, ToolStatus } from '@baocut/protocol';
import { fixtureView, textView, withLocalSpeech } from './models-test-fixtures.ts';
import { TOOLS } from './tool-catalog.ts';
import {
  linkReadyStatus,
  pipelineMissing,
  transcodeCardStatus,
  plannedReason,
  toolBlock,
  toolCardStatus,
  usableCloudCount,
} from './tools-gallery.ts';

function offline(view: ModelCapabilitiesView): ModelCapabilitiesView {
  const strip = <T extends { providers: { config: unknown; available: boolean }[] }>(c: T): T => ({
    ...c,
    providers: c.providers.map((p) => ({ ...p, config: { enabled: false, enabledAt: null, credential: 'missing' }, available: false })),
  });
  return {
    transcribe: strip(view.transcribe),
    synthesizeSpeech: strip(view.synthesizeSpeech),
    generateImage: strip(view.generateImage),
    generateText: strip(view.generateText),
    separateAudio: strip(view.separateAudio),
  };
}

function status(patch: Partial<ToolStatus>): ToolStatus {
  return {
    id: 'translate-subtitles',
    label: '翻译字幕',
    description: '',
    category: 'speech',
    inputs: ['video', 'file'],
    results: ['video', 'artifact'],
    execution: { kind: 'pipeline', method: 'pipelines.start', pipeline: 'translate' },
    executionByInput: { file: { kind: 'pipeline', method: 'pipelines.start', pipeline: 'translate-subtitles' } },
    capabilities: ['generateText'],
    optionalCapabilities: [],
    externalTools: [],
    optionalExternalTools: [],
    network: 'none',
    candidates: 'videos-with-transcript',
    available: true,
    problems: [],
    limitations: [],
    ...patch,
  };
}

const pipeline = (name: string): PipelineInfo => ({ name, label: name, description: '', steps: [], paramsSchema: {} });

describe('工具总览的现状行', () => {
  it('目录里没有「即将推出」的工具；压缩、合并与提取音频确认能用时写在哪儿做', () => {
    expect(TOOLS.filter((t) => plannedReason(t.id)).map((t) => t.id)).toEqual([]);
    // 不看云端能力视图：视图没到时也写在哪儿做；tools.list 还没到时不写。
    expect(toolCardStatus('compress-video', null, null)).toEqual({ on: true, text: transcodeCardStatus() });
    expect(toolCardStatus('merge-video', null, null)).toEqual({ on: true, text: transcodeCardStatus() });
    expect(toolCardStatus('extract-audio', null, null)).toEqual({ on: true, text: transcodeCardStatus() });
    expect(toolCardStatus('compress-video', null)).toBeNull();
    // Web 上的原因（固定流程不开放、保存位置在项目目录之外）由 tools.list 给，照写。
    const web = 'Web 服务上不能调用 pipelines.start';
    expect(toolCardStatus('extract-audio', null, web)).toEqual({ on: false, text: web });
  });

  it('不可用以 tools.list 为准：写第一条原因，点变灰', () => {
    const down = status({ available: false, problems: [{ code: 'CAPABILITY_NOT_CONFIGURED', message: '还没有配置文本生成模型', remedy: '到设置里连接' }] });
    expect(toolBlock(down, null)).toBe('还没有配置文本生成模型');
    expect(toolBlock(down, null, undefined, true)).toBe('还没有配置文本生成模型。到设置里连接');
    const same = '转写还没有可用的模型：安装本机模型包，或配置一个在线服务并设为默认。';
    const twice = status({ available: false, problems: [{ code: 'CAPABILITY_NOT_CONFIGURED', message: same, remedy: same }] });
    expect(toolBlock(twice, null, undefined, true)).toBe(same);
    const dotted = status({ available: false, problems: [{ code: 'X', message: '下载工具还没装。', remedy: '先在首页准备' }] });
    expect(toolBlock(dotted, null, undefined, true)).toBe('下载工具还没装。先在首页准备');
    expect(toolCardStatus('translate-subtitles', textView(), toolBlock(down, null))).toEqual({ on: false, text: '还没有配置文本生成模型' });
    expect(toolCardStatus('compress-video', null, 'ffmpeg 没装')).toEqual({ on: false, text: 'ffmpeg 没装' });
  });

  it('执行它的流程不在 pipelines.list 里时按不了（按输入种类找流程）', () => {
    const ok = status({});
    expect(toolBlock(ok, null)).toBeNull();
    expect(toolBlock(ok, [pipeline('translate')])).toBeNull();
    expect(toolBlock(ok, [pipeline('translate')], 'file')).toBe(pipelineMissing());
    expect(toolBlock(ok, [pipeline('translate'), pipeline('translate-subtitles')], 'file')).toBeNull();
    expect(toolBlock(status({ execution: { kind: 'pipeline', method: 'pipelines.start', pipeline: 'transcribe' }, executionByInput: undefined }), [])).toBe(
      pipelineMissing(),
    );
    expect(toolBlock(null, [])).toBeNull();
  });

  it('从链接导入：确认能用时写下载工具就绪，状态没到时不写', () => {
    expect(toolCardStatus('link-import', null, null)).toEqual({ on: true, text: linkReadyStatus() });
    expect(toolCardStatus('link-import', null)).toBeNull();
    expect(toolCardStatus('transcribe', fixtureView(), null)).toBeNull();
  });

  it('文本生成按能用的云端服务商计数', () => {
    // OpenAI 连上了；Google 没连。
    expect(usableCloudCount(textView(), 'generateText')).toBe(1);
    expect(toolCardStatus('generate-text', textView())).toEqual({ on: true, text: '1 家云端已连接' });
    // 没有任何文本服务商（Runtime 还没列出来）时也说清楚。
    expect(toolCardStatus('generate-text', fixtureView())).toEqual({ on: false, text: '还没有可用的文本模型' });
  });

  it('语音与生图按能用的云端服务商计数：连上了、这一档也可用', () => {
    const view = fixtureView();
    // OpenAI 与声明了语音合成模型的 TTS Box；ASR Box 连上了但这一档没有模型，不算。
    expect(usableCloudCount(view, 'synthesizeSpeech')).toBe(2);
    expect(toolCardStatus('synthesize-speech', view)).toEqual({ on: true, text: '2 家云端已连接' });
    // Codex 画图是智能体 Provider，不算云端。
    expect(toolCardStatus('generate-image', view)).toEqual({ on: true, text: '1 家云端已连接' });
  });

  it('生成语音把装好的本机模型也算上', () => {
    expect(toolCardStatus('synthesize-speech', withLocalSpeech())).toEqual({ on: true, text: '本机 1 个模型 · 2 家云端已连接' });
    expect(toolCardStatus('synthesize-speech', withLocalSpeech(offline(fixtureView())))).toEqual({ on: true, text: '本机 1 个模型' });
  });

  it('都没连上时说清楚', () => {
    const view = offline(fixtureView());
    expect(toolCardStatus('synthesize-speech', view)).toEqual({ on: false, text: '还没有可用的语音合成模型' });
    expect(toolCardStatus('generate-image', view)).toEqual({ on: false, text: '还没有可用的生图模型' });
    expect(toolCardStatus('generate-text', offline(textView()))).toEqual({ on: false, text: '还没有可用的文本模型' });
  });

  it('能力视图还没到时不写现状', () => {
    expect(toolCardStatus('synthesize-speech', null)).toBeNull();
    expect(toolCardStatus('generate-image', null)).toBeNull();
    expect(toolCardStatus('generate-text', null)).toBeNull();
  });
});
