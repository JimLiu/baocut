import { useMemo, useState } from 'react';
import type { AssetRecord, CaptionItem, DocumentRecord, Id, Sequence } from '@baocut/protocol';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { captionChips, onScreen, type CaptionChip } from '../../model/caption-tracks.ts';
import { useEditor } from '../../state/editor-store.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { CaptionGallery, openGallery } from './caption-gallery.tsx';
import { CaptionPage } from './inspector-caption.tsx';
import { INSPECTOR_COPY as IC } from './inspector-copy.ts';
import { LITE_COPY as L } from './lite-copy.ts';
import { PanelHead, panelBody } from './panel-head.tsx';
import { SubtitleStrip } from './subtitle-strip.tsx';
import { openFlow } from './translate-run.ts';
import { useItemEdit } from './use-item-edit.ts';

const page = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 });
const panel = style({ display: 'flex', flexDirection: 'column', gap: 8 });

/** 侧栏头上「字幕样式」能不能点：画面上有字幕、没在图层里全关掉。 */
export function useCaptionStyleAvailability(sequence: Sequence, documents: Record<Id, DocumentRecord>): 'ready' | 'hidden' | 'none' {
  const chips = useMemo(() => onScreen(captionChips(sequence, documents)), [sequence, documents]);
  const hidden = useEditor((s) => s.captionsHidden || chips.every((chip) => s.captionLayersHidden[chip.kind]));
  return !chips.length ? 'none' : hidden ? 'hidden' : 'ready';
}

/**
 * 轻量视图侧栏的字幕样式（轻量编辑器设计 §3「侧栏」；原型 editor-lite-script.jsx 的 CaptionStyle）：与时间线视图字幕面板同一套页——
 * 先是样式库（`CaptionGallery`），卡上的「编辑」进字幕属性（`CaptionPage`，只要样式），「更换样式」回样式库。页的栈记在这里，
 * 不写时间线视图的面板状态与选中：两边各推各的。两页的返回都回到侧栏原来那一页。改样式的草稿走编辑器的 DraftDocuments，画面照样跟着变。
 */
export function LiteCaptionStyle({
  videoId,
  sequence,
  documents,
  assets,
  backLabel,
  onClose,
}: {
  videoId: Id;
  sequence: Sequence;
  documents: Record<Id, DocumentRecord>;
  assets: Record<Id, AssetRecord>;
  /** 返回到哪一页（「台词」或「脚本」）。 */
  backLabel: string;
  onClose(): void;
}) {
  const chips = useMemo(() => captionChips(sequence, documents), [sequence, documents]);
  const [view, setView] = useState<'props' | 'gallery'>('gallery');
  const [chosen, setChosen] = useState<string | null>(null);
  const showing = onScreen(chips);
  const current: CaptionChip | null =
    chips.find((c) => c.key === chosen && c.state !== 'shelved') ?? showing.find((c) => c.kind === 'original') ?? showing[0] ?? null;
  const item = current ? sequence.items.find((i): i is CaptionItem => i.id === current.itemIds[0] && i.type === 'caption') : undefined;
  const back = { label: L.backTo(backLabel), onPress: onClose };
  /** 「＋ 翻译成…」：翻译设置页在时间线视图的字幕面板里（product-design §5.9「字幕属性」），切过去再打开它。 */
  const translate = () => {
    const editor = useEditor.getState();
    editor.setView('timeline');
    openGallery(videoId, false);
    openFlow(videoId, true);
    editor.showPanel('subtitle');
  };

  if (view === 'gallery' && current) {
    return (
      <div className={page}>
        <CaptionGallery
          videoId={videoId}
          sequence={sequence}
          documents={documents}
          chips={chips}
          selected={current.key}
          onBack={onClose}
          backLabel={back.label}
          onEdit={() => setView('props')}
        >
          <SubtitleStrip noCard sequence={sequence} documents={documents} chips={chips} selected={current.key} onSelect={setChosen} onTranslate={translate} />
        </CaptionGallery>
      </div>
    );
  }
  return (
    <div className={page}>
      <PanelHead title={IC.pageCaption} back={back} />
      <div className={`${panelBody} bc-scroll`}>
        <div className={panel}>
          {item ? (
            <StylePage
              key={item.id}
              item={item}
              sequence={sequence}
              documents={documents}
              assets={assets}
              onOpenStyles={(key) => {
                setChosen(key);
                setView('gallery');
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StylePage({
  item,
  sequence,
  documents,
  assets,
  onOpenStyles,
}: {
  item: CaptionItem;
  sequence: Sequence;
  documents: Record<Id, DocumentRecord>;
  assets: Record<Id, AssetRecord>;
  onOpenStyles(chipKey: string): void;
}) {
  const editable = useVideo((s) => canEdit(s.video));
  const edit = useItemEdit(sequence, item);
  const track = sequence.tracks.find((t) => t.id === item.trackId);
  const canChange = editable && !item.locked && !track?.locked;
  return (
    <CaptionPage
      item={item}
      sequence={sequence}
      documents={documents}
      assets={assets}
      edit={edit}
      canChange={canChange}
      onOpenStyles={onOpenStyles}
      styleOnly
    />
  );
}
