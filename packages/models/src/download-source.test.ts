import { describe, expect, it } from 'vitest';
import { DEFAULT_MODELS_ENDPOINT, MODELS_ENDPOINT_ENV, modelFileUrl, resolveModelsEndpoint, validEndpoint } from './download-source.ts';

describe('下载来源', () => {
  it('基址的优先级：环境变量 → 设置 → 公共仓库', () => {
    expect(resolveModelsEndpoint({}, null)).toEqual({ endpoint: DEFAULT_MODELS_ENDPOINT, origin: 'default' });
    expect(resolveModelsEndpoint({}, 'https://mirror.example/hf/')).toEqual({ endpoint: 'https://mirror.example/hf', origin: 'setting' });
    expect(resolveModelsEndpoint({ [MODELS_ENDPOINT_ENV]: 'http://127.0.0.1:9/' }, 'https://mirror.example')).toEqual({
      endpoint: 'http://127.0.0.1:9',
      origin: 'env',
    });
  });

  it('不合规的基址：环境变量报错，设置退回公共仓库', () => {
    expect(() => resolveModelsEndpoint({ [MODELS_ENDPOINT_ENV]: 'ftp://x' }, null)).toThrow(MODELS_ENDPOINT_ENV);
    expect(resolveModelsEndpoint({}, 'https://user:pw@mirror.example').origin).toBe('default');
    for (const bad of ['mirror.example', 'https://a.example/?token=x', 'https://a.example/#x', 'https://u@a.example', 'file:///tmp']) {
      expect(validEndpoint(bad)).toBe(false);
    }
    expect(validEndpoint('https://a.example/prefix')).toBe(true);
  });

  it('文件 URL：<基址>/<owner>/<repo>/resolve/<revision>/<路径>，逐段编码，保留 /', () => {
    expect(modelFileUrl('https://huggingface.co', 'aufklarer/Silero-VAD', 'abc123', 'model.safetensors')).toBe(
      'https://huggingface.co/aufklarer/Silero-VAD/resolve/abc123/model.safetensors',
    );
    expect(modelFileUrl('https://m.example/hf/', 'o/r', 'rev', 'sub dir/a#b.json')).toBe(
      'https://m.example/hf/o/r/resolve/rev/sub%20dir/a%23b.json',
    );
  });
});
