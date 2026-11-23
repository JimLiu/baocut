import type { ComponentType } from 'react';
import Animation from '@react-spectrum/s2/icons/Animation';
import ChartBarVert from '@react-spectrum/s2/icons/ChartBarVert';
import ColorHarmony from '@react-spectrum/s2/icons/ColorHarmony';
import Draw from '@react-spectrum/s2/icons/Draw';
import Layout from '@react-spectrum/s2/icons/Layout';
import Shapes from '@react-spectrum/s2/icons/Shapes';
import Table from '@react-spectrum/s2/icons/Table';
import TextParagraph from '@react-spectrum/s2/icons/TextParagraph';

/**
 * Open Artifact 作品的类型图标（docs/design/artifacts §5）：自带的八种各有一个，别的类型（自装的）用设计稿那一个。
 * 尺寸由放它的地方定（工作区标签 16px，产物卡片的图标块 20px）。
 */
const ICONS: Record<string, ComponentType<{ UNSAFE_style?: React.CSSProperties }>> = {
  slides: Layout,
  design: Shapes,
  'design-system': ColorHarmony,
  docs: TextParagraph,
  sheets: Table,
  data: ChartBarVert,
  whiteboard: Draw,
  motion: Animation,
};

export function artifactIcon(type: string | undefined): ComponentType<{ UNSAFE_style?: React.CSSProperties }> {
  return (type && Object.hasOwn(ICONS, type) ? ICONS[type] : undefined) ?? Shapes;
}
