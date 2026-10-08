import { Button } from '@react-spectrum/s2';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import { iconStyle, lightDark, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { STAGE_MEDIA_COPY as C } from '../../model/stage-media.ts';
import type { StageMedia } from './use-stage-media.ts';

/** 盖在画面上、不收指针：点画面照旧是选中 / 清选（设计稿 `.stagemedia`）。 */
const layer = style({
  position: 'absolute',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  boxSizing: 'border-box',
  pointerEvents: 'none',
});
/** 画面背后总是黑的，卡也总是深色：不随明暗主题翻转。 */
const card = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'start',
  gap: 4,
  maxWidth: 440,
  paddingX: 16,
  paddingY: 12,
  borderRadius: 'lg',
  backgroundColor: 'transparent-black-800',
  // `font` 简写自带颜色，颜色要写在它后面。
  font: 'ui-sm',
  color: 'transparent-white-800',
  overflowWrap: 'anywhere',
});
const title = style({ display: 'flex', alignItems: 'center', gap: 8, font: 'title-sm', color: 'white' });
const name = style({ color: 'transparent-white-900' });
const hint = style({ color: 'transparent-white-600' });
const failure = style({ color: lightDark('red-700', 'red-1000') });
const action = style({ marginTop: 4, pointerEvents: 'auto' });

/**
 * 主媒体放不出来时画面正中的常驻卡（设计稿 stage.jsx 的 `StageMediaNotice`）。播放时也不收：字幕、元素照常画在它周围。
 * 桌面端多一个「重新关联…」（设计稿放在 Space 的 ⋯ 菜单里，这里改到卡上，见 model/stage-media.ts）。
 */
export function StageMediaNotice({ media, frame }: { media: StageMedia; frame: { left: number; top: number; width: number; height: number } }) {
  const n = media.notice;
  if (!n) return null;
  return (
    <div className={layer} style={frame} role="alert" data-stage-media={n.kind}>
      <div className={card}>
        <div className={title}>
          <AlertTriangle styles={iconStyle({ size: 'S', color: 'notice' })} />
          {n.title}
        </div>
        <div className={name}>{n.name}</div>
        <div>{n.body}</div>
        {n.volume ? <div>{n.volume}</div> : null}
        {n.more ? <div>{n.more}</div> : null}
        {media.error ? (
          <div className={failure}>{media.error}</div>
        ) : media.busy ? (
          <div className={hint}>{C.relinking}</div>
        ) : n.hint ? (
          <div className={hint}>{n.hint}</div>
        ) : null}
        {n.relink ? (
          <div className={action}>
            <Button
              variant="primary"
              staticColor="white"
              size="S"
              isPending={media.busy}
              isDisabled={!media.canRelink}
              aria-label={C.label(n.relink.name)}
              onPress={media.relink}>
              {C.relink}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
