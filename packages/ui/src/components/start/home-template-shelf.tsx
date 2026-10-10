import { useState } from 'react';
import { ActionButton, Text } from '@react-spectrum/s2';
import Checkmark from '@react-spectrum/s2/icons/Checkmark';
import ViewGrid from '@react-spectrum/s2/icons/ViewGrid';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { HOME_COPY } from '../../copy.ts';
import { isExample, templateShelf, type HomeTemplate } from '../../model/home-templates.ts';
import { TemplateCover, TemplateKindBadge } from './template-cover.tsx';
import { TemplateLibrary } from './template-library.tsx';

const section = style({ marginTop: 32 });
// 标题行与网格也给起始页的「快捷开始」那一节用（home-starters.tsx），两节的标题与卡片列对齐。
export const shelfHead = style({ display: 'flex', alignItems: 'center', gap: 8, minHeight: 24, marginBottom: '[6px]' });
export const shelfHeading = style({ margin: 0, flexGrow: 1, font: 'ui', fontWeight: 'bold', color: 'gray-900' });
// 卡片自带 6px 内边距：网格向两侧各探出 6px，封面的边才和输入框对齐。
export const shelfGrid = style({
  display: 'grid',
  gridTemplateColumns: { default: '[repeat(4, minmax(0, 1fr))]', isNarrow: '[repeat(2, minmax(0, 1fr))]' },
  rowGap: 12,
  columnGap: 4,
  marginX: '[-6px]',
});
// 卡片的底、标题与小字同「全部模板」里的卡片（template-library.tsx）；挂上的场景模板换成蓝底，封面上再标「已选」。
const card = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  width: 'full',
  padding: '[6px]',
  boxSizing: 'border-box',
  textAlign: 'start',
  borderStyle: 'none',
  borderRadius: 'lg',
  cursor: 'pointer',
  backgroundColor: { default: 'transparent', ':hover': 'gray-75', isSelected: { default: 'blue-100', ':hover': 'blue-100' } },
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineWidth: 2,
  outlineOffset: 2,
  outlineColor: 'focus-ring',
});
const badge = style({
  position: 'absolute',
  insetEnd: '[6px]',
  bottom: '[6px]',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  height: 20,
  paddingX: '[6px]',
  borderRadius: 'default',
  backgroundColor: 'gray-25',
  font: 'ui-xs',
  color: 'gray-800',
});
const cardTitle = style({
  display: 'flex',
  alignItems: 'center',
  gap: '[6px]',
  minWidth: 0,
  paddingTop: '[6px]',
  paddingX: 2,
  font: 'ui',
  fontWeight: 'bold',
  color: 'gray-900',
});
const oneLine = style({ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const cardSummary = style({
  paddingX: 2,
  font: 'ui-sm',
  color: 'gray-600',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

/**
 * 起始页的一张模板卡（原型 home-templates.jsx `ShelfCard`）：大封面、标题（作品示例带「示例」）与一行摘要。
 * 场景模板是开关：点一下挂到输入框，再点取消；作品示例点一下把提示词放进输入框，没有「选中」这回事（模板包规范 §5.1、§5.2）。
 */
function ShelfCard({
  template,
  picked,
  onScene,
  onExample,
}: {
  template: HomeTemplate;
  picked: boolean;
  onScene(template: HomeTemplate | null): void;
  onExample(template: HomeTemplate): void;
}) {
  const example = isExample(template);
  return (
    <button
      type="button"
      className={card({ isSelected: picked })}
      title={template.summary}
      aria-label={example ? HOME_COPY.useExampleLabel(template.title) : HOME_COPY.useTemplateLabel(template.title)}
      aria-pressed={example ? undefined : picked}
      onClick={() => (example ? onExample(template) : onScene(picked ? null : template))}>
      <TemplateCover template={template}>
        {picked ? (
          <span className={badge}>
            <Checkmark />
            {HOME_COPY.templatePicked}
          </span>
        ) : null}
      </TemplateCover>
      <span className={cardTitle}>
        <span className={oneLine}>{template.title}</span>
        <TemplateKindBadge template={template} />
      </span>
      <span className={cardSummary}>{template.summary}</span>
    </button>
  );
}

/**
 * 起始页输入框下面的模板网格（产品设计 §3.2.1；原型 home-templates.jsx `HomeTemplateShelf`）：宽时四列、窄时两列，最多八张，
 * 最近用过的在前，两类混排；其余的在「全部模板」里。模板目录还没取到时只有标题行与「全部模板」。
 */
export function HomeTemplateShelf({
  catalog,
  scene,
  shelf,
  narrow,
  onScene,
  onExample,
}: {
  /** 模板目录（state/template-catalog-store）。 */
  catalog: readonly HomeTemplate[];
  /** 挂着的场景模板的 id。 */
  scene: string | null;
  /** 最近用过的模板的 id。 */
  shelf: readonly string[];
  narrow: boolean;
  onScene(template: HomeTemplate | null): void;
  onExample(template: HomeTemplate): void;
}) {
  const [library, setLibrary] = useState(false);
  const cards = templateShelf(catalog, shelf);
  return (
    <section className={section} aria-labelledby="home-shelf-title">
      <div className={shelfHead}>
        <h2 id="home-shelf-title" className={shelfHeading}>
          {HOME_COPY.templates}
        </h2>
        <ActionButton isQuiet size="S" onPress={() => setLibrary(true)}>
          <ViewGrid />
          <Text>{HOME_COPY.allTemplates}</Text>
        </ActionButton>
      </div>
      {cards.length ? (
        <div className={shelfGrid({ isNarrow: narrow })} role="list">
          {cards.map((t) => (
            <div key={t.id} role="listitem">
              <ShelfCard template={t} picked={scene === t.id} onScene={onScene} onExample={onExample} />
            </div>
          ))}
        </div>
      ) : null}
      <TemplateLibrary
        open={library}
        picked={scene}
        onClose={() => setLibrary(false)}
        onUse={(t) => {
          setLibrary(false);
          if (isExample(t)) onExample(t);
          else onScene(t);
        }}
      />
    </section>
  );
}
