import { RpcError, formatRef, localizeText, setLocale } from '@baocut/protocol';
import { JobsManager } from '@baocut/protocol/messages/jobs/job-manager.ts';
import { JobsResourceScheduler } from '@baocut/protocol/messages/jobs/resource-scheduler.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorText, jobError, jobWarning, joinList, withCause } from './job-text.ts';
import { DIMENSION_LABELS, ResourceExceedsCapacity } from './resource-scheduler.ts';
import { TOOL_CATALOGUE } from './tool-catalogue.ts';

/** 测试中途换成中文：`BAOCUT_LOCALE` 优先于 `setLocale`，两个一起换。 */
function toChinese(): void {
  vi.stubEnv('BAOCUT_LOCALE', 'zh-Hans');
  setLocale('zh-Hans');
}

describe('任务文字的多语言', () => {
  beforeEach(() => {
    vi.stubEnv('BAOCUT_LOCALE', 'en');
    setLocale('en');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
  });

  it('任务错误按当前语言生成，并带上引用供界面换语言', () => {
    const error = jobError('JOB_INTERRUPTED', JobsManager.interrupted());
    expect(error.message).toBe("The task didn't finish before Runtime stopped; you can submit it again");
    expect(error.messageRef?.key).toBe('jobsManager.interrupted');
    expect(formatRef(error.messageRef!, error.message, 'zh-Hans')).toBe('Runtime 停止时任务没有完成；可以重新提交');
  });

  it('「说明：原因」嵌套原因的引用，换语言时整句一起换', () => {
    const cause = new RpcError('not-found', JobsManager.videoNotOpen());
    const message = withCause(JobsManager.requeueCheckFailed(), cause);
    expect(message.text).toBe("The check before re-queuing failed: The video isn't open");
    const error = jobError('STALE_JOB_INPUT', message);
    expect(formatRef(error.messageRef!, error.message, 'zh-Hans')).toBe('重新排队之前的校验没有通过：视频没有打开');
    // 第三方原话没有引用：照原样嵌进去。
    expect(String(withCause(JobsManager.requeueCheckFailed(), new Error('ENOENT')))).toBe('The check before re-queuing failed: ENOENT');
  });

  it('警告的 detail 带 detailRef', () => {
    const warning = jobWarning('output-truncated', JobsManager.outputTruncated({ limit: 512 }));
    expect(warning.detail).toBe('The output hit the limit (512 tokens) and was cut off; the content is incomplete');
    expect(localizeText(warning.detail, warning.detailRef)).toBe(warning.detail);
    toChinese();
    expect(localizeText(warning.detail, warning.detailRef)).toBe('输出到了上限（512 token）被截断，内容不完整');
  });

  it('资源调度的拒绝与等待说明', () => {
    const exceeded = new ResourceExceedsCapacity([
      { dimension: 'memory', demand: 2, limit: 1 },
      { dimension: 'gpuMemory', demand: 2, limit: 1 },
    ]);
    expect(exceeded.message).toBe('This needs more memory, GPU memory than this machine can provide');
    expect(String(errorText(exceeded))).toBe(exceeded.message);
    expect(formatRef(exceeded.messageRef!, exceeded.message, 'zh-Hans')).toBe('需要的内存、GPU 内存超过了这台机器能给的量');
    expect(DIMENSION_LABELS.scratchDisk).toBe('disk space');
    expect(JobsResourceScheduler.queuedBehind({ ahead: 1 }).text).toBe('Queued: 1 task ahead in the same queue');
  });

  it('工具目录的名字与说明在读的时候按当前语言生成', () => {
    const transcribe = TOOL_CATALOGUE.find((tool) => tool.id === 'transcribe')!;
    expect(transcribe.label).toBe('Transcribe');
    toChinese();
    expect(transcribe.label).toBe('转录');
  });

  it('列表分隔符跟随语言', () => {
    expect(joinList(['a', 'b'])).toBe('a, b');
    toChinese();
    expect(joinList(['a', 'b'])).toBe('a、b');
  });
});
