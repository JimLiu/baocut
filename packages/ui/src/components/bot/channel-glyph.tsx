import type { ComponentType } from 'react';
import type { Channel, ChannelColor, ChannelIcon } from '@baocut/protocol';
import type { IconProps } from '@react-spectrum/s2';
import Briefcase from '@react-spectrum/s2/icons/Briefcase';
import Brush from '@react-spectrum/s2/icons/Brush';
import Calendar from '@react-spectrum/s2/icons/Calendar';
import Camera from '@react-spectrum/s2/icons/Camera';
import ChartBarVert from '@react-spectrum/s2/icons/ChartBarVert';
import Chat from '@react-spectrum/s2/icons/Chat';
import Code from '@react-spectrum/s2/icons/Code';
import Edit from '@react-spectrum/s2/icons/Edit';
import Education from '@react-spectrum/s2/icons/Education';
import Email from '@react-spectrum/s2/icons/Email';
import Filmstrip from '@react-spectrum/s2/icons/Filmstrip';
import GlobeGrid from '@react-spectrum/s2/icons/GlobeGrid';
import Heart from '@react-spectrum/s2/icons/Heart';
import Home from '@react-spectrum/s2/icons/Home';
import Image from '@react-spectrum/s2/icons/Image';
import Layers from '@react-spectrum/s2/icons/Layers';
import Lightbulb from '@react-spectrum/s2/icons/Lightbulb';
import Microphone from '@react-spectrum/s2/icons/Microphone';
import MovieCamera from '@react-spectrum/s2/icons/MovieCamera';
import MusicNote from '@react-spectrum/s2/icons/MusicNote';
import Star from '@react-spectrum/s2/icons/Star';
import Target from '@react-spectrum/s2/icons/Target';
import Translate from '@react-spectrum/s2/icons/Translate';
import UserGroup from '@react-spectrum/s2/icons/UserGroup';
import Video from '@react-spectrum/s2/icons/Video';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { channelLook } from '../../model/bot.ts';

/** 频道图标可选的 S2 workflow 图标（protocol 的 `CHANNEL_ICONS`），加上主频道固定用的 Layers。 */
export const CHANNEL_ICON_COMPONENTS: Record<ChannelIcon | 'Layers', ComponentType<IconProps>> = {
  Chat,
  Video,
  MovieCamera,
  Filmstrip,
  Microphone,
  MusicNote,
  Camera,
  Image,
  Edit,
  Brush,
  Translate,
  Education,
  Lightbulb,
  Code,
  ChartBarVert,
  Target,
  Calendar,
  Email,
  Briefcase,
  UserGroup,
  Heart,
  Star,
  GlobeGrid,
  Home,
  Layers,
};

/**
 * 频道颜色（原型 page-bot.css `.bot-hue--*`）：图标用 1000 档，图标选择器的大号预览垫 200 档。这里只定义两个变量，
 * 用它们的元素再挂 `hueInk` / `hueTint` / `hueSwatch`。
 */
export const HUE: Record<ChannelColor, string> = {
  magenta: style({
    '--bc-hue-ink': { type: 'color', value: 'magenta-1000' },
    '--bc-hue-tint': { type: 'backgroundColor', value: 'magenta-200' },
  }),
  red: style({ '--bc-hue-ink': { type: 'color', value: 'red-1000' }, '--bc-hue-tint': { type: 'backgroundColor', value: 'red-200' } }),
  orange: style({
    '--bc-hue-ink': { type: 'color', value: 'orange-1000' },
    '--bc-hue-tint': { type: 'backgroundColor', value: 'orange-200' },
  }),
  yellow: style({
    '--bc-hue-ink': { type: 'color', value: 'yellow-1000' },
    '--bc-hue-tint': { type: 'backgroundColor', value: 'yellow-200' },
  }),
  green: style({
    '--bc-hue-ink': { type: 'color', value: 'green-1000' },
    '--bc-hue-tint': { type: 'backgroundColor', value: 'green-200' },
  }),
  seafoam: style({
    '--bc-hue-ink': { type: 'color', value: 'seafoam-1000' },
    '--bc-hue-tint': { type: 'backgroundColor', value: 'seafoam-200' },
  }),
  cyan: style({ '--bc-hue-ink': { type: 'color', value: 'cyan-1000' }, '--bc-hue-tint': { type: 'backgroundColor', value: 'cyan-200' } }),
  blue: style({ '--bc-hue-ink': { type: 'color', value: 'blue-1000' }, '--bc-hue-tint': { type: 'backgroundColor', value: 'blue-200' } }),
  indigo: style({
    '--bc-hue-ink': { type: 'color', value: 'indigo-1000' },
    '--bc-hue-tint': { type: 'backgroundColor', value: 'indigo-200' },
  }),
  purple: style({
    '--bc-hue-ink': { type: 'color', value: 'purple-1000' },
    '--bc-hue-tint': { type: 'backgroundColor', value: 'purple-200' },
  }),
};
/** 图标着色：侧栏、按钮里的图标由 S2 设成 `--iconPrimary: currentColor`，所以改的是图标自己的 color。 */
export const hueInk = style({ color: '--bc-hue-ink', '--iconPrimary': { type: 'fill', value: 'currentColor' } });

/** 频道图标：S2 workflow 图标，按频道颜色上色（主频道是 Layers、不着色）。放在侧栏行或按钮的图标槽里时由 S2 定尺寸。 */
export function ChannelGlyph({ channel }: { channel: Pick<Channel, 'id' | 'kind' | 'icon' | 'color'> }) {
  const look = channelLook(channel);
  const Icon = CHANNEL_ICON_COMPONENTS[look.icon];
  return <Icon UNSAFE_className={look.color ? `${HUE[look.color]} ${hueInk}` : undefined} />;
}
