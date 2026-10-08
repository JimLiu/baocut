import { ActionButton, Text, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import AudioWave from '@react-spectrum/s2/icons/AudioWave';
import CloseCaptions from '@react-spectrum/s2/icons/CloseCaptions';
import Cut from '@react-spectrum/s2/icons/Cut';
import FileAdd from '@react-spectrum/s2/icons/FileAdd';
import Translate from '@react-spectrum/s2/icons/Translate';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { HOME_COPY } from '../../copy.ts';
import { homeStarters, type HomeStarter, type StarterKey } from '../../model/home-starters.ts';

const row = style({ display: 'flex', alignItems: 'start', gap: 8, minWidth: 0, marginTop: 20 });
// 行名与小按钮（高 24）的文字对齐。
const label = style({ flexShrink: 0, font: 'ui-sm', color: 'gray-600', lineHeight: '[24px]' });
const items = style({ display: 'flex', flexGrow: 1, flexWrap: 'wrap', gap: 4, minWidth: 0 });

const STARTER_ICON: Record<StarterKey, typeof CloseCaptions> = { sub: CloseCaptions, trans: Translate, clean: Cut, a2v: AudioWave };

/**
 * 起始页输入框下面「快捷开始」一行（原型 new-agent.jsx `HomeStarters`）：安静的小按钮，点一下把一句提示词放进输入框，不发送。
 * 行尾的「新建空白视频」不经过 Agent，直接建一个空视频在功能区打开。`target` 是上次「转录并翻译」填的目标语言，没有时那句话留待填项。
 */
export function HomeStarters({ target, onPick, onBlank }: { target: string | null; onPick(starter: HomeStarter): void; onBlank(): void }) {
  return (
    <div className={row} role="group" aria-label={HOME_COPY.quickStart}>
      <span className={label} aria-hidden>
        {HOME_COPY.quickStart}
      </span>
      <div className={items}>
        {homeStarters(target).map((starter) => {
          const Icon = STARTER_ICON[starter.key];
          return (
            <TooltipTrigger key={starter.key} placement="bottom">
              <ActionButton isQuiet size="S" onPress={() => onPick(starter)}>
                <Icon />
                <Text>{starter.title}</Text>
              </ActionButton>
              <Tooltip>{starter.tip}</Tooltip>
            </TooltipTrigger>
          );
        })}
      </div>
      <TooltipTrigger placement="bottom">
        <ActionButton isQuiet size="S" onPress={onBlank}>
          <FileAdd />
          <Text>{HOME_COPY.blankVideo}</Text>
        </ActionButton>
        <Tooltip>{HOME_COPY.blankVideoTip}</Tooltip>
      </TooltipTrigger>
    </div>
  );
}
