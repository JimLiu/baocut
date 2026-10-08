import type { MeasureText } from '../../model/text-presets.ts';
import { loadRenderPlanner } from '../../render/preview-wasm.ts';
import { PlanFailure, type RenderPlanner } from '../../render/render-planner.ts';

type Size = { width: number; height: number };

/** 量文字框要用的那部分渲染内核（`RenderPlanner`）。 */
export type TextKernel = Pick<RenderPlanner, 'measureText' | 'recovered'>;

/** 内核接连在 `build` 里出错几次就不再等（同一段输入每次都让它陷阱时不会没完）。 */
const ATTEMPTS = 3;

/**
 * 新建文字时量框：等渲染内核载入（含字体），把按某块序列画布量的量法交给 `build`（框与画出来的字同一台排版引擎、
 * 同一批字体，`frame_render::text_measure`）。内核正在重新载入（`PLANNER_CRASHED`）时等它好了，把 `build` 整个重跑，
 * 不拿半截量出来的结果。没有近似的量法：内核载入失败就拒绝，不建框。
 */
export async function withTextMeasure<T>(
  build: (measureOn: (canvas: Size) => MeasureText) => T,
  load: () => Promise<TextKernel> = loadRenderPlanner,
): Promise<T> {
  const kernel = await load();
  const measureOn =
    (canvas: Size): MeasureText =>
    (text, style, wrapWidth) =>
      kernel.measureText(text, style, wrapWidth, canvas);
  for (let attempt = 1; ; attempt++) {
    try {
      return build(measureOn);
    } catch (error) {
      if (!(error instanceof PlanFailure) || error.code !== 'PLANNER_CRASHED' || attempt >= ATTEMPTS) throw error;
      await kernel.recovered();
    }
  }
}
