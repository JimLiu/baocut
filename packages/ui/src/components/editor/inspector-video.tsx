import type { AssetRecord, EditOperation, Id, Sequence } from '@baocut/protocol';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { durationSeconds, formatFps, formatSeconds } from '../../model/editor.ts';
import { ASPECTS, aspectCanvas, aspectOf, colorParts, type AspectKey } from '../../model/property-values.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { useEditorActions } from './editor-context.tsx';
import { ColorField, Note, PRow, Sec, SecHead, Seg } from './inspector-controls.tsx';
import { INSPECTOR_COPY as IC } from './inspector-copy.ts';

const grid = style({
  display: 'grid',
  gridTemplateColumns: ['auto', '1fr'],
  columnGap: 12,
  rowGap: '[6px]',
  font: 'ui-sm',
  alignItems: 'baseline',
});
const key = style({ color: 'gray-600', whiteSpace: 'nowrap' });
const value = style({ color: 'gray-900', minWidth: 0, overflowWrap: 'anywhere' });

const BACKDROPS = [
  {
    key: 'black',
    get label() {
      return IC.black;
    },
  },
  {
    key: 'color',
    get label() {
      return IC.color;
    },
  },
] as const;

/**
 * 视频属性（没选中片段时）：画幅（短边不变，画面上的东西跟着画布按比例走，一步撤销）、画布底色，
 * 以及只读的规格。帧率与时长由视频决定，这里不改。
 */
export function VideoPage({ sequence, assets }: { sequence: Sequence; assets: Record<Id, AssetRecord> }) {
  const { apply } = useEditorActions();
  const editable = useVideo((s) => canEdit(s.video));
  const { width, height, background } = sequence.canvas;
  const aspect = aspectOf(sequence.canvas);
  const black = colorParts(background, '#000000').hex === '#000000';
  const update = (patch: Omit<Extract<EditOperation, { type: 'updateSequence' }>, 'type' | 'sequenceId'>) =>
    void apply([{ type: 'updateSequence', sequenceId: sequence.id, ...patch }]);
  const setColor = (next: string) => {
    update({ background: colorParts(next, '#000000').hex });
  };
  return (
    <>
      <SecHead first aside={`${width} × ${height}`}>
        {IC.aspect}
      </SecHead>
      <Sec>
        <Seg<AspectKey>
          label={IC.aspect}
          value={aspect}
          options={ASPECTS.map((a) => ({ key: a.key, label: a.key }))}
          isDisabled={!editable}
          onChange={(next) => update({ canvas: aspectCanvas(sequence.canvas, next) })}
        />
        <Note>{IC.aspectNote}</Note>
      </Sec>
      <SecHead>{IC.canvasBackground}</SecHead>
      <Sec>
        <PRow label={IC.backdrop}>
          <Seg
            label={IC.canvasBackground}
            value={black ? 'black' : 'color'}
            options={BACKDROPS}
            isDisabled={!editable}
            onChange={(next) => update({ background: next === 'black' ? '#000000' : '#FFFFFF' })}
          />
          {!black ? (
            <ColorField
              label={IC.canvasColor}
              value={background}
              fallback="#000000"
              allowAlpha={false}
              isDisabled={!editable}
              onCommit={setColor}
            />
          ) : null}
        </PRow>
      </Sec>
      <SecHead>{IC.specs}</SecHead>
      <div className={grid}>
        <span className={key}>{IC.size}</span>
        <span className={value}>
          {width} × {height}
        </span>
        <span className={key}>{IC.frameRate}</span>
        <span className={value}>{formatFps(sequence.fps)}</span>
        <span className={key}>{IC.duration}</span>
        <span className={value}>{formatSeconds(durationSeconds(sequence))}</span>
        <span className={key}>{IC.contents}</span>
        <span className={value}>
          {IC.contentsCount(sequence.tracks.length, sequence.items.length, Object.keys(assets).length)}
        </span>
      </div>
      <Note>{IC.videoNote}</Note>
    </>
  );
}
