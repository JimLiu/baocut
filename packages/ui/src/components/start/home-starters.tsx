import { ActionButton, Text, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import FileAdd from '@react-spectrum/s2/icons/FileAdd';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { HOME_COPY } from '../../copy.ts';
import { homeStarters, type HomeStarter, type StarterKey } from '../../model/home-starters.ts';
import { shelfGrid, shelfHead, shelfHeading } from './home-template-shelf.tsx';

const section = style({ marginTop: 24 });
// 卡片的底、悬停与焦点环同模板卡（home-template-shelf.tsx）；插画的几何在 app.css（.bc-quick-art），色从这里给，跟着主题走。
const card = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  width: 'full',
  padding: '[6px]',
  boxSizing: 'border-box',
  textAlign: 'start',
  borderStyle: 'none',
  borderRadius: 'lg',
  cursor: 'pointer',
  backgroundColor: { default: 'transparent', ':hover': 'gray-75' },
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineWidth: 2,
  outlineOffset: 2,
  outlineColor: 'focus-ring',
  '--bc-quick-200': {
    type: 'backgroundColor',
    value: { tone: { blue: 'blue-200', green: 'green-200', orange: 'orange-200', magenta: 'magenta-200' } },
  },
  '--bc-quick-300': {
    type: 'backgroundColor',
    value: { tone: { blue: 'blue-300', green: 'green-300', orange: 'orange-300', magenta: 'magenta-300' } },
  },
  '--bc-quick-400': {
    type: 'backgroundColor',
    value: { tone: { blue: 'blue-400', green: 'green-400', orange: 'orange-400', magenta: 'magenta-400' } },
  },
  '--bc-quick-1000': {
    type: 'backgroundColor',
    value: { tone: { blue: 'blue-1000', green: 'green-1000', orange: 'orange-1000', magenta: 'magenta-1000' } },
  },
  '--bc-quick-screen': { type: 'backgroundColor', value: 'gray-25' },
  '--bc-quick-mute': { type: 'backgroundColor', value: 'gray-300' },
});
const name = style({
  paddingX: 2,
  font: 'ui',
  fontWeight: 'bold',
  color: 'gray-900',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

// 插画里的小色块（<i>）各几块：画法在 app.css 的 .bc-quick-screen[data-kind]。
const STARTER_ART: Record<StarterKey, number> = { sub: 2, trans: 4, clean: 9, a2v: 7 };

/**
 * 起始页「快捷开始」那一节（原型 new-agent.jsx `HomeStarters`）：比模板常用，排在模板前面，四张和模板卡同宽的带色卡片，
 * 上面一幅按色系画的小插画（字幕条、双语行、波形），下面是名字。点一下把一句提示词放进输入框，不发送。
 * 标题行尾的「新建空白视频」不经过 Agent，直接建一个空视频在功能区打开。`target` 是上次「转录并翻译」填的目标语言，没有时那句话留待填项。
 * `narrow` 与模板网格同一个开关：窄时两列。
 */
export function HomeStarters({
  target,
  narrow,
  onPick,
  onBlank,
}: {
  target: string | null;
  narrow: boolean;
  onPick(starter: HomeStarter): void;
  onBlank(): void;
}) {
  return (
    <section className={section} aria-labelledby="home-quick-title">
      <div className={shelfHead}>
        <h2 id="home-quick-title" className={shelfHeading}>
          {HOME_COPY.quickStart}
        </h2>
        <TooltipTrigger placement="bottom">
          <ActionButton isQuiet size="S" onPress={onBlank}>
            <FileAdd />
            <Text>{HOME_COPY.blankVideo}</Text>
          </ActionButton>
          <Tooltip>{HOME_COPY.blankVideoTip}</Tooltip>
        </TooltipTrigger>
      </div>
      <div className={shelfGrid({ isNarrow: narrow })}>
        {homeStarters(target).map((starter) => (
          <button
            key={starter.key}
            type="button"
            className={`bc-quick-card ${card({ tone: starter.tone })}`}
            title={starter.tip}
            aria-label={starter.title}
            onClick={() => onPick(starter)}>
            <span className="bc-quick-art" aria-hidden>
              <span className="bc-quick-screen" data-kind={starter.key}>
                {Array.from({ length: STARTER_ART[starter.key] }, (_, i) => (
                  <i key={i} />
                ))}
              </span>
            </span>
            <span className={name}>{starter.title}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
