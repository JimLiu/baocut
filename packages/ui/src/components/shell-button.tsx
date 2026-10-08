import { useEffect, useRef, type ReactNode } from 'react';
import { ActionButton, Tooltip, TooltipTrigger, type ActionButtonProps } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };

/** 按下态的底色（app.css `.bc-shell-button[aria-pressed='true']` 读这个变量）。 */
const pressedFill = style({ '--bc-shell-pressed': { type: 'backgroundColor', value: 'gray-100' } });

/**
 * 外壳按钮（产品设计 §2.5 用户修订；原型 home-shell-chrome.jsx `ShellButton`）：32×32 的安静按钮，图形按 S2 20 网格画、显示 16×16 居中，
 * 标题栏的侧栏开关、视图按钮组与标签页列表里的行尾按钮都用它；`small` 是列表行尾的 24×24。
 * 开关类按钮给 `pressed`，按下时铺一层底色（S2 的安静按钮没有选中态）。
 * `description` 写进按钮的 aria-description（S2 的按钮不透传这个属性，挂载后补上）。
 */
export function ShellButton({
  label,
  onPress,
  pressed,
  tooltip = true,
  small = false,
  description,
  children,
  ...rest
}: {
  label: string;
  /** 放在 DialogTrigger 里时不传：由 DialogTrigger 开关弹层。 */
  onPress?: () => void;
  pressed?: boolean;
  tooltip?: boolean;
  small?: boolean;
  description?: string;
  children: ReactNode;
} & Pick<ActionButtonProps, 'aria-haspopup' | 'aria-expanded' | 'isDisabled' | 'excludeFromTabOrder'>) {
  const anchor = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const button = anchor.current?.querySelector('button');
    if (!button) return;
    if (description) button.setAttribute('aria-description', description);
    else button.removeAttribute('aria-description');
  }, [description]);
  return (
    <span ref={anchor} className="bc-shell-anchor">
      <TooltipTrigger isDisabled={!tooltip}>
        <ActionButton
          {...rest}
          isQuiet
          aria-label={label}
          aria-pressed={pressed}
          onPress={onPress}
          UNSAFE_className={`${small ? 'bc-shell-button bc-shell-button-small' : 'bc-shell-button'} ${pressedFill}`}>
          {children}
        </ActionButton>
        <Tooltip>{label}</Tooltip>
      </TooltipTrigger>
    </span>
  );
}
