import { describe, expect, it } from 'vitest';
import { modelReason, modelWarning, noModelText, saveDirLabel, saveTarget, withSaveDir } from './tool-frame.ts';
import { localNotDownloaded, type ToolModelOption } from './tools-models.ts';

const base: ToolModelOption<null> = {
  key: 'openai/tts-1',
  providerId: 'openai',
  provider: 'OpenAI',
  modelId: 'tts-1',
  label: 'tts-1',
  connected: true,
  usable: true,
  why: null,
  info: null,
};
const offline: ToolModelOption<null> = { ...base, connected: false, usable: false, why: '未连接' };
const missing: ToolModelOption<null> = {
  ...base,
  key: 'local/kokoro',
  providerId: 'local',
  provider: '本机',
  modelId: 'kokoro',
  label: 'Kokoro',
  usable: false,
  why: localNotDownloaded(),
  local: true,
};

describe('model row', () => {
  it('names the reason the start button is off', () => {
    expect(modelReason([], null, '语音合成模型')).toBe('还没有可用的语音合成模型，先去设置');
    expect(modelReason([base], null, '语音合成模型')).toBe('先选一个语音合成模型');
    expect(modelReason([base], base, '语音合成模型')).toBeNull();
    expect(modelReason([offline], offline, '语音合成模型')).toBe('OpenAI 还没连接');
    expect(modelReason([missing], missing, '语音合成模型')).toBe('Kokoro 还没安装');
    expect(modelReason([missing], { ...missing, why: '此平台或构建暂不可用' }, '语音合成模型')).toBe('Kokoro · 此平台或构建暂不可用');
    expect(modelReason([base], { ...base, usable: false, why: '这一档不可用' }, '文本模型')).toBe('OpenAI · 这一档不可用');
  });

  it('warns under the row without blocking the page', () => {
    expect(modelWarning(base)).toBeNull();
    expect(modelWarning(null)).toBeNull();
    expect(modelWarning(offline)).toBe('OpenAI 还没连接，换一只能用的，或去设置连接');
    expect(modelWarning(missing)).toBe('Kokoro 还没安装，换一只已装的，或去设置下载');
    expect(noModelText('生图模型')).toBe('还没有可用的生图模型：在设置里安装一个本机模型，或连接一家云端服务。');
    expect(noModelText('文本模型', false)).toBe('还没有可用的文本模型：在设置里连接一家云端服务。');
  });
});

describe('save location', () => {
  it('shortens the home folder and keeps the last two levels', () => {
    expect(saveDirLabel('/Users/jim/Downloads')).toBe('~/Downloads');
    expect(saveDirLabel('/Users/jim/Movies/BaoCut/工具结果/')).toBe('~/…/BaoCut/工具结果');
    expect(saveDirLabel('/home/jim/Downloads')).toBe('~/Downloads');
    expect(saveDirLabel('/Volumes/Disk/a/b')).toBe('/…/a/b');
    expect(saveDirLabel('C:\\Users\\jim\\Downloads')).toBe('~\\Downloads');
  });

  it('passes the re-picked folder first, then the listed save location, else nothing', () => {
    expect(saveTarget('/Users/jim/Downloads', null)).toBe('/Users/jim/Downloads');
    expect(saveTarget('/Users/jim/Downloads', '/tmp/out')).toBe('/tmp/out');
    expect(saveTarget(null, null)).toBeUndefined();
    expect(saveTarget(null, '  ')).toBeUndefined();
    expect(withSaveDir({ text: 'hi' }, '/tmp/out')).toEqual({ text: 'hi', saveDir: '/tmp/out' });
    expect(withSaveDir({ text: 'hi' }, undefined)).toEqual({ text: 'hi' });
  });
});
