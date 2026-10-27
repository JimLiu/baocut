import { style } from '@react-spectrum/s2/style' with { type: 'macro' };

// 引导对话框与在线服务那一面共用的样式（原型 onboarding.css：.onb-hint、.onb-note、.onb-models、.onb-model）。
export const hint = style({ marginTop: 8, marginBottom: 0, font: 'ui-sm', color: 'gray-700' });
export const note = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 4,
  marginTop: 12,
  marginBottom: 0,
  font: 'ui-sm',
  color: 'gray-600',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
export const cards = style({ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 });
export const card = style({
  display: 'flex',
  alignItems: 'start',
  gap: 4,
  paddingStart: 8,
  paddingEnd: 12,
  paddingY: 4,
  borderRadius: 'lg',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: { default: 'gray-200', isOn: 'blue-800' },
  backgroundColor: { default: 'gray-50', isOn: 'blue-100' },
  transition: 'default',
});
export const cardBody = style({ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0, paddingY: 4 });
// 勾选框（单选框）与图标各占一列、和名字那一行等高居中，下面的说明就与名字对齐（原型 onboarding.css 的 onb-agent）。
export const cardCell = style({ display: 'flex', alignItems: 'center', flexShrink: 0, height: 24, marginTop: 4, marginEnd: { default: 0, isIcon: 4 } });
export const cardHead = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, minHeight: 24 });
export const cardName = style({ font: 'ui', fontWeight: 'bold', color: 'gray-900', minWidth: 0, overflowWrap: 'anywhere' });
export const grow = style({ flexGrow: 1 });
export const cardDesc = style({ font: 'ui-sm', color: { default: 'gray-700', isPlan: 'gray-800' }, overflowWrap: 'anywhere' });
export const installed = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  font: 'ui-sm',
  fontWeight: 'bold',
  color: 'positive-900',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
