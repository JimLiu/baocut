import { describe, expect, it } from 'vitest';
import { ProviderFailure } from '@baocut/models';
import { checkFacts, providerCheckCode } from './model-install-service.ts';

describe('检查没通过：Worker 的失败按原因分类', () => {
  it('加载时文件缺失或损坏是模型文件的问题，资源不足是内存不够，响应不合协议是输出不对，其余是 Worker 的问题', () => {
    const load = (reason: string) => new ProviderFailure('load-failed', '模型包加载失败', { reason, workerCode: 'X' });
    expect(providerCheckCode(load('not-installed'))).toBe('MODEL_FILES_DAMAGED');
    expect(providerCheckCode(load('resource'))).toBe('MODEL_OUT_OF_MEMORY');
    expect(providerCheckCode(load('unsupported'))).toBe('MODEL_WORKER_FAILED');
    expect(providerCheckCode(load('worker-missing'))).toBe('MODEL_WORKER_FAILED');
    expect(providerCheckCode(new ProviderFailure('protocol', 'job.run 返回 completed 却没有输出'))).toBe('MODEL_OUTPUT_WRONG');
    expect(providerCheckCode(new ProviderFailure('crashed', 'Model Worker 在任务进行中退出'))).toBe('MODEL_WORKER_FAILED');
    expect(providerCheckCode(new ProviderFailure('unavailable', '模型包已停用'))).toBe('MODEL_WORKER_FAILED');
  });

  it('技术细节：key: value 一行一条，常用的在前；不放 stderr、staging 与本机绝对路径；对象写成 JSON，过长截断', () => {
    const facts = checkFacts({
      stderrTail: 'panic at /Users/someone/model.rs',
      staging: '/private/tmp/staging',
      file: '/Users/someone/Library/BaoCut/models/x/model.safetensors',
      workerDetails: { file: 'model.safetensors' },
      workerCode: 'MODEL_NOT_INSTALLED',
      kind: 'load-failed',
      text: 'x'.repeat(400),
      note: 'see /Users/someone/log.txt',
      winNote: 'see C:\\Users\\someone\\log.txt',
      empty: null,
    });
    expect(facts.slice(0, 3)).toEqual([
      'kind: load-failed',
      'workerCode: MODEL_NOT_INSTALLED',
      'workerDetails: {"file":"model.safetensors"}',
    ]);
    expect(facts.find((l) => l.startsWith('text: '))).toHaveLength('text: '.length + 301);
    expect(facts.join('\n')).not.toMatch(/Users|\/private\/|stderrTail|staging|empty/);
  });
});
