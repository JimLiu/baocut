import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
/** S2 colors are shared by the custom media canvas and semantic control adapters. */
export const mediaTheme = style({
  '--media-tools-bg': { type: 'backgroundColor', value: 'black' },
  '--media-bg': { type: 'backgroundColor', value: 'gray-25' },
  '--media-surface': { type: 'backgroundColor', value: 'gray-75' },
  '--media-border': { type: 'color', value: 'gray-200' },
  '--media-fg': { type: 'color', value: 'gray-900' },
  '--media-muted': { type: 'color', value: 'gray-600' },
  '--media-accent': { type: 'color', value: 'blue-900' },
});
// 查看器挂在 body 下，不在应用根的字体里；表头标题要自己带 S2 字体。
export const mediaHeaderTitle = style({ font: 'ui-sm', color: 'gray-600', textAlign: 'center' });
