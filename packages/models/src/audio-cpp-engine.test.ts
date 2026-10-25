import { describe, expect, it } from 'vitest';
import { AUDIO_CPP_RELEASE, audioCppAssetKey, audioCppServerBackend, parseAudioCppVersion } from './audio-cpp-engine.ts';

/** 内置的 audio.cpp 引擎（架构设计 §6.3）：发布包的选择与 `--version` 的解析。 */
describe('audio.cpp 引擎', () => {
  it('Windows 的 CPU 安装包取 CPU 构建，其余变体与 macOS 取默认的包；上游没有的平台没有包', () => {
    expect(audioCppAssetKey('win32', 'x64', 'cpu')).toBe('win32-x64-cpu');
    expect(audioCppAssetKey('win32', 'x64', 'cuda')).toBe('win32-x64');
    expect(audioCppAssetKey('win32', 'x64', 'vulkan')).toBe('win32-x64');
    expect(audioCppAssetKey('darwin', 'arm64', 'cpu')).toBe('darwin-arm64');
    expect(AUDIO_CPP_RELEASE.assets[audioCppAssetKey('linux', 'arm64', null)]).toBeUndefined();
  });

  it('版本取第一行；自己构建没给版本时是 dev', () => {
    expect(parseAudioCppVersion('audio.cpp 0.9.2\ngit: 0097d365 2026-10-15\nbackends: cpu,metal\n')).toBe('0.9.2');
    expect(parseAudioCppVersion(`audio.cpp ${AUDIO_CPP_RELEASE.version}\ngit: 5074956\nbackends: cpu,metal\n`)).toBe(AUDIO_CPP_RELEASE.version);
    expect(parseAudioCppVersion(`audio.cpp v${AUDIO_CPP_RELEASE.version}\n`)).toBe(AUDIO_CPP_RELEASE.version);
    expect(parseAudioCppVersion('audio.cpp dev\n')).toBe('dev');
    expect(parseAudioCppVersion('usage: …')).toBeNull();
  });

  it('合成服务的后端按构建编进去的后端选 GPU 的那个，没有时 cpu（服务自己的默认是 cuda，不带 CUDA 的构建起不来）', () => {
    expect(audioCppServerBackend('audio.cpp 0.9.2\nbuild: Release, apple-clang\nbackends: cpu,metal\n')).toBe('metal');
    expect(audioCppServerBackend('audio.cpp 0.9.2\r\nbackends: cpu,vulkan\r\n')).toBe('vulkan');
    expect(audioCppServerBackend('audio.cpp 0.9.2\nbackends: cpu,cuda\n')).toBe('cuda');
    expect(audioCppServerBackend('audio.cpp 0.9.2\nbackends: cpu\n')).toBe('cpu');
    expect(audioCppServerBackend('audio.cpp 0.9.2\n')).toBe('cpu');
  });
});
