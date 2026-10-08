import type { AudioItem, FitMode, ImageItem, VideoItem } from '@baocut/protocol';
import { Note, PRow, Sec, SecHead, Seg } from './inspector-controls.tsx';
import { DubTakesSection } from './dub-takes.tsx';
import { DuckingCard } from './inspector-ducking.tsx';
import { EffectsSection } from './inspector-effects.tsx';
import { GeometrySection } from './inspector-geometry.tsx';
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

/** 画面：素材在布局框里怎么放（包含留边、覆盖裁切）与不透明度。 */
function PictureSection(props: ItemPageProps<VideoItem | ImageItem>) {
  const { item, sequence, edit, canChange } = props;
  return (
    <>
      <SecHead>{IC.picture}</SecHead>
      <Sec>
        <PRow label={IC.fit}>
          <Seg<FitMode>
            label={IC.fit}
            value={item.fit ?? 'cover'}
            options={FITS}
            isDisabled={!canChange}
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

/** 编辑视频：变速、声音（含压低原声）、画面、效果、转场、几何、时间。 */
export function VideoItemPage(props: ItemPageProps<VideoItem>) {
  return (
    <>
      <SpeedSection {...props} />
      <SoundSection {...props} />
      <DuckingCard {...props} />
      <PictureSection {...props} />
      <EffectsSection {...props} />
      <TransitionSection {...props} />
      <GeometrySection item={props.item} sequence={props.sequence} assets={props.assets} edit={props.edit} isDisabled={!props.canChange} />
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
