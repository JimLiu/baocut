import { useCallback } from 'react';
import type { Marker, TemplateLayers } from '@baocut/protocol';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { demoMarkers } from '../../model/template-layers.ts';
import { KernelThumb, type ThumbDraw } from './kernel-thumb.tsx';
import { TEMPLATE_DEMO_SECONDS, templateThumb } from './thumb-scenes.ts';
import { TEMPLATE_COPY as TC } from './template-copy.ts';
import { useTemplateLogos } from './use-template-logos.ts';

/** 缩略图那一块（原型 .tplthumb）：深底、小圆角，宽按模板自己的画幅算（高 × 比例），不留黑边。 */
const thumb = style({ position: 'relative', flexShrink: 0, overflow: 'hidden', borderRadius: 'sm', backgroundColor: 'gray-800' });

/** 示范章节：四章、名字跟界面语言（缩略图上画的「播到第二章」）。一处算一次，所有格子共用同一份。 */
let demo: { lang: string; markers: Marker[] } | null = null;
export function demoChapters(): Marker[] {
  const titles = [TC.demoChapter1, TC.demoChapter2, TC.demoChapter3, TC.demoChapter4];
  const lang = titles.join('\u0000');
  if (demo?.lang !== lang) demo = { lang, markers: demoMarkers(titles, TEMPLATE_DEMO_SECONDS) };
  return demo.markers;
}

/**
 * 模板缩略图（原型 `TemplateThumb`）：这一套模板在示范章节上的真渲染，停在示范片长的 38%（目录、属性页、时间线上那一格同一个样子）。
 */
export function TemplateThumb({ doc, height = 44 }: { doc: TemplateLayers; height?: number }) {
  const portrait = doc.canvas === '9:16';
  const width = Math.round(portrait ? (height * 9) / 16 : (height * 16) / 9);
  const markers = demoChapters();
  const name = TC.demoTitle;
  const logos = useTemplateLogos(doc);
  const draw = useCallback<ThumbDraw>(
    (planner, w, h) => templateThumb(planner, doc, markers, name, w, h, logos),
    [doc, markers, name, logos],
  );
  return (
    <span className={thumb} style={{ width, height }} aria-hidden>
      <KernelThumb draw={draw} />
    </span>
  );
}
