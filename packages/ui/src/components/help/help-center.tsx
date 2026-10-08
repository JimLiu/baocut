import { useEffect, useId, useRef, useState } from 'react';
import { ActionButton, Button, CustomDialog, DialogContainer, SearchField, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import Close from '@react-spectrum/s2/icons/Close';
import HelpCircle from '@react-spectrum/s2/icons/HelpCircle';
import InfoCircle from '@react-spectrum/s2/icons/InfoCircle';
import ListBulleted from '@react-spectrum/s2/icons/ListBulleted';
import Play from '@react-spectrum/s2/icons/Play';
import Search from '@react-spectrum/s2/icons/Search';
import Transcript from '@react-spectrum/s2/icons/Transcript';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import { HELP_COPY as COPY } from '../../copy.ts';
import { HELP_GUIDES, helpCta, searchGuides, type HelpCta, type HelpGuide } from '../../model/help-guides.ts';
import { useEditor } from '../../state/editor-store.ts';
import { useHelp } from '../../state/help-store.ts';
import { defaultRoute, routeVideo, useShell } from '../../state/shell-store.ts';
import { openHome } from '../start/open-home.ts';
import { HelpArticle } from './help-article.tsx';
import { GuideList, detail, intro, kbd, sectionHeading, sectionTitle } from './help-guide-list.tsx';
import { HelpKeys } from './help-keys.tsx';
import { HelpStart } from './help-start.tsx';

type Section = 'start' | 'guide' | 'keys' | 'faq';

const SECTIONS: readonly { id: Section; icon: typeof Play }[] = [
  { id: 'start', icon: Play },
  { id: 'guide', icon: Transcript },
  { id: 'keys', icon: ListBulleted },
  { id: 'faq', icon: HelpCircle },
];

/**
 * 帮助中心（原型 help-center.jsx / help-center.css）：S2 CustomDialog（L），挂在外壳一处，经 useHelp 开合。
 * 内容是内置的离线指南（model/help-guides.ts），不连网。
 */
export function HelpCenter({ platform }: { platform: string }) {
  const isOpen = useHelp((s) => s.isOpen);
  const session = useHelp((s) => s.session);
  const close = useHelp((s) => s.close);

  // 焦点归还：S2 弹层（RAC FocusScope）关闭时自己把焦点还给打开前的元素；它没还成（比如来源在弹层开着时被换掉了）
  // 而且来源还在页面上时，这里补一次。
  useEffect(() => {
    if (isOpen) return;
    const origin = useHelp.getState().origin;
    if (!origin) return;
    const timer = window.setTimeout(() => {
      const active = document.activeElement;
      if (origin.isConnected && (active === null || active === document.body)) origin.focus();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  // DialogContainer 关闭后仍留着上一个子元素（为了退场动画），HelpDialog 的状态会带到下一次打开；按打开次数换 key 重新开始。
  return (
    <DialogContainer onDismiss={close}>
      {isOpen ? <HelpDialog key={session} mac={platform === 'darwin'} onClose={close} /> : null}
    </DialogContainer>
  );
}

function HelpDialog({ mac: macDefault, onClose }: { mac: boolean; onClose(): void }) {
  const titleId = useId();
  const content = useRef<HTMLDivElement>(null);
  const [section, setSection] = useState<Section>('start');
  const [query, setQuery] = useState('');
  const [article, setArticle] = useState<HelpGuide | null>(null);
  const [mac, setMac] = useState(macDefault);
  const inVideo = useShell((s) => routeVideo(s.route) !== undefined);
  const searching = query.trim() !== '';

  useEffect(() => {
    if (content.current) content.current.scrollTop = 0;
  }, [article, section, query]);

  const choose = (id: Section) => {
    setSection(id);
    setQuery('');
    setArticle(null);
  };
  const search = (value: string) => {
    setQuery(value);
    setArticle(null);
  };

  // 去做（原型 `navigate`）：先关帮助，再去对应的地方。只做这里真能到的（见 model/help-guides 的 helpCta）；
  // `close` 只关帮助，回到视频。
  const act = (cta: HelpCta) => {
    onClose();
    const shell = useShell.getState();
    if (cta.target === 'new') openHome(shell.route.tab === 'home' ? shell.route.projectId : null);
    else if (cta.target === 'space') shell.go(defaultRoute('space'));
    else if (cta.target === 'agent') shell.go({ tab: 'settings', section: 'agent' });
    else if (cta.target === 'models') shell.go({ tab: 'models', category: 'asr', page: 'local' });
    else if (cta.target === 'subtitle') useEditor.getState().showPanel('subtitle');
  };

  const listing = searching ? searchGuides(query) : HELP_GUIDES.filter((guide) => guide.group === section);
  const sectionLabel = COPY.sections[section];

  return (
    <CustomDialog size="L" padding="none" isDismissible aria-labelledby={titleId}>
      <div className={shell}>
        <header className={header}>
          <span className={brand}>
            <HelpCircle />
            <h1 id={titleId} className={heading}>
              {COPY.title}
            </h1>
          </span>
          <span className={headerNote}>{COPY.subtitle}</span>
          <TooltipTrigger>
            <ActionButton isQuiet aria-label={COPY.close} onPress={onClose}>
              <Close />
            </ActionButton>
            <Tooltip>{COPY.close}</Tooltip>
          </TooltipTrigger>
        </header>
        <div className={layout}>
          <nav className={nav} aria-label={COPY.navLabel}>
            <div className={navTitle}>{COPY.navTitle}</div>
            {SECTIONS.map(({ id, icon: Icon }) => {
              const current = !searching && section === id;
              return (
                <RACButton
                  key={id}
                  className={(state) => navRow({ ...state, isCurrent: current })}
                  aria-current={current ? 'page' : undefined}
                  onPress={() => choose(id)}>
                  <Icon styles={navIcon} />
                  {COPY.sections[id]}
                </RACButton>
              );
            })}
            <div className={navNote}>
              <InfoCircle styles={navIcon} />
              <span>
                {COPY.navNote[0]}
                <br />
                {COPY.navNote[1]}
              </span>
            </div>
          </nav>
          <div className={main}>
            <div className={searchBar}>
              <SearchField
                size="L"
                aria-label={COPY.searchLabel}
                placeholder={COPY.searchPlaceholder}
                value={query}
                onChange={search}
                onClear={() => search('')}
                styles={searchField}
              />
            </div>
            <div ref={content} className={`${body} bc-scroll`}>
              {article ? (
                <HelpArticle
                  guide={article}
                  backLabel={searching ? COPY.backToResults : COPY.backTo(sectionLabel)}
                  cta={helpCta(article, inVideo)}
                  onBack={() => setArticle(null)}
                  onAction={() => act(helpCta(article, inVideo))}
                  onRead={setArticle}
                />
              ) : searching ? (
                <>
                  <div className={sectionHeading}>
                    <h2 className={sectionTitle}>{COPY.results}</h2>
                    <span role="status" className={detail}>
                      {COPY.found(listing.length)}
                    </span>
                  </div>
                  {listing.length ? (
                    <GuideList guides={listing} onRead={setArticle} />
                  ) : (
                    <div className={empty}>
                      <Search styles={emptyIcon} data-bc-icons="own" />
                      <h3 className={emptyTitle}>{COPY.emptyTitle}</h3>
                      <p className={emptyBody}>{COPY.emptyBody}</p>
                      <Button variant="secondary" onPress={() => choose('start')}>
                        {COPY.emptyAction}
                      </Button>
                    </div>
                  )}
                </>
              ) : section === 'start' ? (
                <HelpStart onRead={setArticle} onChoose={choose} />
              ) : section === 'keys' ? (
                <HelpKeys mac={mac} onPlatform={setMac} />
              ) : (
                <>
                  <div className={sectionHeading}>
                    <h2 className={sectionTitle}>{section === 'guide' ? COPY.guideTitle : COPY.faqTitle}</h2>
                  </div>
                  <p className={intro}>{section === 'guide' ? COPY.guideIntro : COPY.faqIntro}</p>
                  <GuideList guides={listing} onRead={setArticle} />
                </>
              )}
            </div>
            <footer className={footer}>
              <span className={detail}>{COPY.footer}</span>
              <span className={spacer} />
              <kbd className={kbd}>Esc</kbd>
              <span className={detail}>{COPY.close}</span>
            </footer>
          </div>
        </div>
      </div>
    </CustomDialog>
  );
}

/** 原型 .help-center：高 min(716px, 视口 − 48px)，不超出 S2 弹层的 90%；宽是 S2 的 L（原型 .bc-help-dialog 撑满它）。 */
const shell = style({
  display: 'flex',
  flexDirection: 'column',
  height: '[min(716px, calc(100dvh - 48px), 90dvh)]',
  backgroundColor: 'gray-25',
  fontFamily: 'sans',
  color: 'gray-800',
});
const header = style({
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  flexShrink: 0,
  height: 64,
  paddingStart: 24,
  paddingEnd: 20,
  borderWidth: 0,
  borderBottomWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const brand = style({ display: 'flex', alignItems: 'center', gap: 8, flexGrow: 1, minWidth: 0, color: 'gray-900', '--iconPrimary': { type: 'fill', value: 'currentColor' } });
const heading = style({ margin: 0, fontSize: 'ui-lg', fontWeight: 'extra-bold', color: 'gray-900' });
const headerNote = style({ font: 'ui-sm', color: 'gray-600', whiteSpace: 'nowrap' });
const layout = style({ display: 'flex', flexGrow: 1, minHeight: 0 });
const nav = style({
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 0,
  boxSizing: 'border-box',
  width: { default: 180, '@media (max-width: 760px)': 140 },
  paddingTop: { default: 24, '@media (max-width: 760px)': 20 },
  paddingBottom: { default: 16, '@media (max-width: 760px)': 20 },
  paddingX: { default: 12, '@media (max-width: 760px)': 8 },
  backgroundColor: 'gray-75',
  borderWidth: 0,
  borderEndWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
/** 原型 .t-section：11px 粗体灰字。 */
const navTitle = style({ marginX: 12, marginBottom: 12, font: 'ui-xs', fontWeight: 'bold', color: 'gray-600' });
/** 原型 .siderow：悬停 gray-100，当前 gray-200 加粗。 */
const navRow = style<{ isHovered: boolean; isFocusVisible: boolean; isCurrent: boolean }>({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
  boxSizing: 'border-box',
  width: 'full',
  marginY: 2,
  paddingX: 8,
  paddingY: '[7px]',
  borderWidth: 0,
  borderRadius: 'default',
  backgroundColor: { default: 'transparent', isHovered: 'gray-100', isCurrent: 'gray-200' },
  font: 'ui',
  fontWeight: { default: 'normal', isCurrent: 'bold' },
  color: { default: 'gray-800', isCurrent: 'gray-900' },
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
  textAlign: 'start',
  cursor: 'pointer',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  transition: 'default',
});
const navIcon = iconStyle({ size: 'S' });
const navNote = style({
  display: { default: 'flex', '@media (max-width: 760px)': 'none' },
  alignItems: 'start',
  gap: 8,
  marginTop: 'auto',
  marginX: 8,
  font: 'ui-xs',
  lineHeight: '[1.6]',
  color: 'gray-600',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const main = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 });
const searchBar = style({
  flexShrink: 0,
  paddingTop: { default: 20, '@media (max-width: 760px)': 16 },
  paddingX: { default: 28, '@media (max-width: 760px)': 20 },
});
const searchField = style({ width: 'full' });
const body = style({
  flexGrow: 1,
  minHeight: 0,
  overflowY: 'auto',
  paddingY: { default: 24, '@media (max-width: 760px)': 20 },
  paddingX: { default: 28, '@media (max-width: 760px)': 20 },
});
const empty = style({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, paddingY: 64, paddingX: 20, textAlign: 'center' });
const emptyIcon = iconStyle({ size: 'XL', color: 'gray' });
const emptyTitle = style({ margin: 0, font: 'ui', fontWeight: 'bold', color: 'gray-900' });
const emptyBody = style({ maxWidth: 340, margin: 0, font: 'ui-sm', lineHeight: '[1.6]', color: 'gray-700' });
const footer = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
  paddingY: 12,
  paddingX: 28,
  borderWidth: 0,
  borderTopWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const spacer = style({ flexGrow: 1 });
