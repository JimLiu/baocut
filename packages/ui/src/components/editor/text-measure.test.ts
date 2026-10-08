import { describe, expect, it, vi } from 'vitest';
import { blankTextLayer, type MeasureText } from '../../model/text-presets.ts';
import { PlanFailure } from '../../render/render-planner.ts';
import { withTextMeasure, type TextKernel } from './text-measure.ts';

const canvas = { width: 1920, height: 1080 };
type MeasureOn = (size: typeof canvas) => MeasureText;
const crashed = () => new PlanFailure({ code: 'PLANNER_CRASHED', message: '帧计划器出错，正在重新载入' });

/** 假的内核：量出来的框宽是字数 × 100；`fail` 给出第几次量要抛什么。 */
function fakeKernel(fail: (call: number) => Error | null = () => null) {
  let calls = 0;
  let recover: () => void = () => {};
  const kernel: TextKernel & { calls(): number; recover(): void } = {
    measureText: (text, _style, wrapWidth, size) => {
      const error = fail(++calls);
      if (error) throw error;
      return { width: wrapWidth ?? text.length * 100, height: size.height / 10 };
    },
    recovered: () => new Promise<void>((resolve) => (recover = resolve)),
    calls: () => calls,
    recover: () => recover(),
  };
  return kernel;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => ((resolve = ok), (reject = fail)));
  return { promise, resolve, reject };
}

describe('新建文字时量框', () => {
  it('内核还没载入时等它，载入之后按它量，不先给近似的框', async () => {
    const kernel = fakeKernel();
    const loading = deferred<TextKernel>();
    const build = vi.fn((measureOn: MeasureOn) => blankTextLayer(canvas, measureOn(canvas)));
    const made = withTextMeasure(build, () => loading.promise);
    await Promise.resolve();
    expect(build).not.toHaveBeenCalled();
    loading.resolve(kernel);
    const layer = await made;
    expect(build).toHaveBeenCalledTimes(1);
    // 「输入文字」四个字 → 400 像素宽，占 1920 宽画布的 400/1920。
    expect(layer.place?.w).toBeCloseTo((400 / 1920) * 100, 1);
  });

  it('内核载入失败就拒绝，不建框', async () => {
    const build = vi.fn(() => 1);
    await expect(withTextMeasure(build, () => Promise.reject(new Error('预览渲染模块没有载入')))).rejects.toThrow('预览渲染模块没有载入');
    expect(build).not.toHaveBeenCalled();
  });

  it('量到一半内核陷阱（PLANNER_CRASHED）：等它重新载入好了，把整组重量一遍', async () => {
    // 第二次量的时候陷阱：第一层量好了、第二层没量到，结果不能用半截的。
    const kernel = fakeKernel((call) => (call === 2 ? crashed() : null));
    const build = vi.fn((measureOn: MeasureOn) => [measureOn(canvas)('一', {}, null).width, measureOn(canvas)('一二', {}, null).width]);
    let settled = false;
    const made = withTextMeasure(build, async () => kernel).finally(() => (settled = true));
    await vi.waitFor(() => expect(kernel.calls()).toBe(2));
    // 还没重新载入好：不重试，也不交出结果。
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(build).toHaveBeenCalledTimes(1);
    kernel.recover();
    expect(await made).toEqual([100, 200]);
    expect(build).toHaveBeenCalledTimes(2);
    expect(kernel.calls()).toBe(4);
  });

  it('不是陷阱的错误照抛，不重试', async () => {
    const kernel = fakeKernel(() => new PlanFailure({ code: 'INVALID_PARAMS', message: '还没注入字体' }));
    const build = vi.fn((measureOn: MeasureOn) => measureOn(canvas)('字', {}, null));
    await expect(withTextMeasure(build, async () => kernel)).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('每次都陷阱时试三次就放弃', async () => {
    const kernel = fakeKernel(() => crashed());
    const recovered = vi.spyOn(kernel, 'recovered').mockResolvedValue(undefined);
    const build = vi.fn((measureOn: MeasureOn) => measureOn(canvas)('字', {}, null));
    await expect(withTextMeasure(build, async () => kernel)).rejects.toMatchObject({ code: 'PLANNER_CRASHED' });
    expect(build).toHaveBeenCalledTimes(3);
    expect(recovered).toHaveBeenCalledTimes(2);
  });

  it('重新载入失败时拒绝', async () => {
    const kernel = fakeKernel(() => crashed());
    vi.spyOn(kernel, 'recovered').mockRejectedValue(new Error('重新实例化失败'));
    await expect(
      withTextMeasure(
        (measureOn) => measureOn(canvas)('字', {}, null),
        async () => kernel,
      ),
    ).rejects.toThrow('重新实例化失败');
  });
});
