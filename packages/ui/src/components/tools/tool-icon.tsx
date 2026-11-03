import type { ComponentProps, ComponentType } from 'react';
import AspectRatio from '@react-spectrum/s2/icons/AspectRatio';
import AudioWave from '@react-spectrum/s2/icons/AudioWave';
import ColorHarmony from '@react-spectrum/s2/icons/ColorHarmony';
import Cut from '@react-spectrum/s2/icons/Cut';
import Draw from '@react-spectrum/s2/icons/Draw';
import Filmstrip from '@react-spectrum/s2/icons/Filmstrip';
import ImageIcon from '@react-spectrum/s2/icons/Image';
import Images from '@react-spectrum/s2/icons/Images';
import Download from '@react-spectrum/s2/icons/Download';
import Layers from '@react-spectrum/s2/icons/Layers';
import MagicWand from '@react-spectrum/s2/icons/MagicWand';
import Maximize from '@react-spectrum/s2/icons/Maximize';
import Microphone from '@react-spectrum/s2/icons/Microphone';
import StepForward from '@react-spectrum/s2/icons/StepForward';
import Target from '@react-spectrum/s2/icons/Target';
import TextIcon from '@react-spectrum/s2/icons/Text';
import Transcript from '@react-spectrum/s2/icons/Transcript';
import Translate from '@react-spectrum/s2/icons/Translate';
import UnlinkHoriz from '@react-spectrum/s2/icons/UnlinkHoriz';
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
  target: Target,
  maximize: Maximize,
  frames: StepForward,
  color: ColorHarmony,
  cut: Cut,
  stems: UnlinkHoriz,
};
