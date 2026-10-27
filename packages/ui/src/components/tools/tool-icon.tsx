import type { ComponentProps, ComponentType } from 'react';
import AspectRatio from '@react-spectrum/s2/icons/AspectRatio';
import AudioWave from '@react-spectrum/s2/icons/AudioWave';
import Draw from '@react-spectrum/s2/icons/Draw';
import Filmstrip from '@react-spectrum/s2/icons/Filmstrip';
import ImageIcon from '@react-spectrum/s2/icons/Image';
import Images from '@react-spectrum/s2/icons/Images';
import Download from '@react-spectrum/s2/icons/Download';
import Layers from '@react-spectrum/s2/icons/Layers';
import MagicWand from '@react-spectrum/s2/icons/MagicWand';
import Microphone from '@react-spectrum/s2/icons/Microphone';
import TextIcon from '@react-spectrum/s2/icons/Text';
import Transcript from '@react-spectrum/s2/icons/Transcript';
import Translate from '@react-spectrum/s2/icons/Translate';
import ZoomIn from '@react-spectrum/s2/icons/ZoomIn';
import type { ToolIcon } from '../../model/tool-catalog.ts';
import { MusicIcon } from '../music-icon.tsx';

type IconComponent = ComponentType<ComponentProps<typeof AudioWave>>;

/** 工具目录的图标（设计稿 model-tools.js `GROUPS` 的 `icon`）：总览卡片与侧栏共用。 */
export const TOOL_ICON: Record<ToolIcon, IconComponent> = {
  transcript: Transcript,
  translate: Translate,
  microphone: Microphone,
  import: Download,
  wave: AudioWave,
  image: ImageIcon,
  music: MusicIcon,
  text: TextIcon,
  film: Filmstrip,
  layers: Layers,
  zoom: ZoomIn,
  wand: MagicWand,
  images: Images,
  draw: Draw,
  aspect: AspectRatio,
};
