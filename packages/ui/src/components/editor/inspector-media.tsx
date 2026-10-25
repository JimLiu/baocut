import type { AudioItem, FitMode, ImageItem, VideoItem } from '@baocut/protocol';
import { isFramed, isPanelled } from '../../model/stage-framing.ts';
import { Note, PRow, Sec, SecHead, Seg } from './inspector-controls.tsx';
import { DubTakesSection } from './dub-takes.tsx';
import { DuckingCard } from './inspector-ducking.tsx';
import { EffectsSection } from './inspector-effects.tsx';
import { FramingSection } from './inspector-framing.tsx';
import { GeometrySection } from './inspector-geometry.tsx';
import { PanelsSection } from './inspector-panels.tsx';
import { DeleteItem, OpacityRow, SoundSection, SpeedSection, TimeSection, type ItemPageProps } from './inspector-sections.tsx';
import { TransitionSection } from './inspector-transition.tsx';
import { INSPECTOR_COPY as IC } from './inspector-copy.ts';

const FITS: readonly { key: FitMode; label: string }[] = [
  {
    key: 'contain',
    get label() {
      return IC.fitContain;
    },
  },
  {
    key: 'cover',
    get label() {
      return IC.fitCover;
    },
  },
];

/** 画面：素材在布局框里怎么放（包含留边、覆盖裁切）与不透明度。按原片取景的视频恒铺满（见「取景」段），放法不能改。 */
function PictureSection(props: ItemPageProps<VideoItem | ImageItem>) {
  const { item, sequence, edit, canChange } = props;
  const framed = isFramed(item);
  return (
    <>
      <SecHead>{IC.picture}</SecHead>
      <Sec>
        <PRow label={IC.fit}>
          <Seg<FitMode>
            label={IC.fit}
            value={item.fit ?? 'cover'}
            options={FITS}
            isDisabled={!canChange || framed}
            onChange={(fit) => edit.commit([{ type: 'setStyle', sequenceId: sequence.id, itemId: item.id, fit }])}
          />
        </PRow>
        <OpacityRow {...props} />
        {(item.bg && item.bg !== 'black') || item.place.radius || item.place.cornerRadii ? (
          <Note>{IC.plateNote}</Note>
        ) : null}
      </Sec>
    </>
  );
}

/** 编辑视频：变速、声音（含压低原声）、画面、效果、转场、几何（按原片取景时换成「取景」段，分屏时换成「版式」段）、时间。 */
export function VideoItemPage(props: ItemPageProps<VideoItem>) {
  const geometry = { sequence: props.sequence, assets: props.assets, edit: props.edit, isDisabled: !props.canChange };
  return (
    <>
      <SpeedSection {...props} />
      <SoundSection {...props} />
      <DuckingCard {...props} />
      <PictureSection {...props} />
      <EffectsSection {...props} />
      <TransitionSection {...props} />
      {isPanelled(props.item) ? (
        <PanelsSection item={props.item} {...geometry} />
      ) : isFramed(props.item) ? (
        <FramingSection item={props.item} {...geometry} />
      ) : (
        <GeometrySection item={props.item} {...geometry} />
      )}
      <TimeSection {...props} />
      <DeleteItem {...props} />
    </>
  );
}

/** 编辑图片：画面、效果、转场、几何、时间。 */
export function ImagePage(props: ItemPageProps<ImageItem>) {
  return (
    <>
      <PictureSection {...props} />
      <EffectsSection {...props} />
      <TransitionSection {...props} />
      <GeometrySection item={props.item} sequence={props.sequence} assets={props.assets} edit={props.edit} isDisabled={!props.canChange} />
      <TimeSection {...props} />
      <DeleteItem {...props} />
    </>
  );
}

/** 编辑音频：变速、声音（含压低原声）、时间。 */
export function AudioPage(props: ItemPageProps<AudioItem>) {
  return (
    <>
      <SpeedSection {...props} />
      <SoundSection {...props} />
      <DubTakesSection {...props} />
      <DuckingCard {...props} />
      <TimeSection {...props} />
      <DeleteItem {...props} />
    </>
  );
}
