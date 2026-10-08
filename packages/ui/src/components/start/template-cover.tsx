import type { ReactNode } from 'react';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { HOME_COPY } from '../../copy.ts';
import { isExample, type HomeTemplate } from '../../model/home-templates.ts';
import { useTemplateFileUrl } from './use-templates.ts';

// 统一的 16:10 格子：竖屏、方形的画面两边留空，一排卡片才对得齐。几何在 app.css（.bc-tpl-cover）。
const box = style({ backgroundColor: 'gray-100' });
// 作品示例的小标识：与卡片上「已选」同一份几何。
const kindBadge = style({
  display: 'flex',
  alignItems: 'center',
  flexShrink: 0,
  height: 20,
  paddingX: '[6px]',
  borderRadius: 'default',
  backgroundColor: 'gray-100',
  font: 'ui-xs',
  color: 'gray-700',
  fontWeight: 'normal',
  lineHeight: '[1]',
});
const art = style({
  backgroundColor: {
    tone: {
      blue: 'blue-200',
      orange: 'orange-200',
      green: 'green-200',
      purple: 'purple-200',
      cyan: 'cyan-200',
      indigo: 'indigo-200',
      magenta: 'magenta-200',
      seafoam: 'seafoam-200',
      brown: 'brown-200',
    },
  },
  color: {
    tone: {
      blue: 'blue-1000',
      orange: 'orange-1000',
      green: 'green-1000',
      purple: 'purple-1000',
      cyan: 'cyan-1000',
      indigo: 'indigo-1000',
      magenta: 'magenta-1000',
      seafoam: 'seafoam-1000',
      brown: 'brown-1000',
    },
  },
});

/**
 * 模板的封面（原型 home-templates.jsx `HomeTemplateThumb`）：按模板自己的画幅画一帧，放进统一的格子里。
 * `size`：xs = 模板行与输入框里的小色块（不写字）；md = 卡片封面；lg = 详情里的预览。
 * `slide`：null = 封面；数字 = 预览播到第几幕。
 * 清单有封面图（`cover.file`）时封面显示那张图，底下照样画占位封面，图片加载前与加载失败时看到的是它（规范 §3.3）；
 * 预览视频不在这里，详情里另放（template-library.tsx）。
 */
export function TemplateCover({
  template,
  size = 'md',
  slide = null,
  children,
}: {
  template: HomeTemplate;
  size?: 'xs' | 'md' | 'lg';
  slide?: number | null;
  children?: ReactNode;
}) {
  const count = template.beats.length;
  const at = slide == null ? null : slide % count;
  const image = useTemplateFileUrl(template.id, slide == null ? template.cover : null);
  return (
    <span className={`bc-tpl-cover ${box}`} data-size={size} aria-hidden>
      <span className={`bc-tpl-art ${art({ tone: template.tone })}`} data-ratio={template.ratio ?? '16:9'}>
        {size !== 'xs' ? <span className="bc-tpl-art__kicker">{at == null ? template.kicker : `${at + 1} / ${count}`}</span> : null}
        <span className="bc-tpl-art__fig" data-fig={template.figure}>
          <i />
          <i />
          <i />
          <i />
        </span>
        {size !== 'xs' ? <span className="bc-tpl-art__word">{at == null ? template.title : template.beats[at]}</span> : null}
        {size !== 'xs' ? <span className="bc-tpl-art__line" /> : null}
      </span>
      {image.url ? <img className="bc-tpl-cover__image" src={image.url} alt="" decoding="async" onError={image.fail} /> : null}
      {children}
    </span>
  );
}

/** 作品示例的「示例」小标识（场景模板不标）：卡片标题旁与输入框下那一行都用它（原型 `HomeTemplateKind`）。 */
export function TemplateKindBadge({ template }: { template: Pick<HomeTemplate, 'kind'> }) {
  return isExample(template) ? <span className={kindBadge}>{HOME_COPY.exampleBadge}</span> : null;
}
