import type { ComponentProps, ComponentType } from 'react';
import AudioWave from '@react-spectrum/s2/icons/AudioWave';
import Filmstrip from '@react-spectrum/s2/icons/Filmstrip';
import ImageIcon from '@react-spectrum/s2/icons/Image';
import Download from '@react-spectrum/s2/icons/Download';
import Layers from '@react-spectrum/s2/icons/Layers';
import Microphone from '@react-spectrum/s2/icons/Microphone';
import TextIcon from '@react-spectrum/s2/icons/Text';
import Transcript from '@react-spectrum/s2/icons/Transcript';
import Translate from '@react-spectrum/s2/icons/Translate';
import type { ToolIcon } from '../../model/tool-catalog.ts';

type IconComponent = ComponentType<ComponentProps<typeof AudioWave>>;

/** 工具目录的图标（设计稿 model-tools.js `GROUPS` 的 `icon`）：总览卡片与侧栏共用。 */
export const TOOL_ICON: Record<ToolIcon, IconComponent> = {
  transcript: Transcript,
  translate: Translate,
  microphone: Microphone,
  import: Download,
  wave: AudioWave,
  image: ImageIcon,
  text: TextIcon,
  film: Filmstrip,
  layers: Layers,
};
