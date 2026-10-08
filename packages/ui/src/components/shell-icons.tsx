import exitFull from './shell-icons/exit-full.svg';
import full from './shell-icons/full.svg';
import hideTabs from './shell-icons/hide-tabs.svg';
import sidebarHidden from './shell-icons/sidebar-hidden.svg';
import sidebar from './shell-icons/sidebar.svg';
import summary from './shell-icons/summary.svg';
import tabsPlus from './shell-icons/tabs-plus.svg';
import tabs from './shell-icons/tabs.svg';

/*
 * 外壳按钮的图形（产品设计 §2.1、§2.5、§3.3）：`shell-icons/` 里的 SVG 与原型 designs/baocut/assets/shell 逐字节相同
 * （来源记在原型的 provenance.json，原型的 icon-sync.test.js 核对两份一致）。按 S2 的画法画在 20 网格上，显示 16px；
 * 和原型一样当 CSS 遮罩用，颜色跟 currentColor 走（app.css `.bc-shell-icon`）。
 */
function ShellIcon({ src }: { src: string }) {
  return <span aria-hidden="true" className="bc-shell-icon" style={{ maskImage: `url("${src}")`, WebkitMaskImage: `url("${src}")` }} />;
}

/** 侧边栏开着：方框 + 4 宽的侧栏条。 */
export const ShellSidebarIcon = () => <ShellIcon src={sidebar} />;

/** 侧边栏已隐藏：方框 + 1.5 宽的侧栏条（即 S2 expand-right）。 */
export const ShellSidebarHiddenIcon = () => <ShellIcon src={sidebarHidden} />;

/** 隐藏标签页 / 进入分屏视图：方框 + 中线。 */
export const ShellHideTabsIcon = () => <ShellIcon src={hideTabs} />;

/** 进入完整视图：S2 FullScreen 的两角放在右上、左下，向外。 */
export const ShellFullIcon = () => <ShellIcon src={full} />;

/** 退出完整视图：同样两角转成向内。 */
export const ShellExitFullIcon = () => <ShellIcon src={exitFull} />;

/** 会话摘要：S2 ListBulleted。 */
export const ShellSummaryIcon = () => <ShellIcon src={summary} />;

/**
 * 标签页按钮的图形：方框中间叠一层，没有标签时是小加号，功能区收起时是标签页数（超过 9 写「9+」，缩到 0.75）。
 * 尺寸由 app.css `.bc-tabstack` 定。
 */
export function TabStackIcon({ badge }: { badge?: string }) {
  return (
    <span className="bc-tabstack" aria-hidden="true">
      <ShellIcon src={tabs} />
      <span className="bc-tabstack-overlay">
        {badge ? (
          <span className={badge.length > 1 ? 'bc-tabstack-count bc-tabstack-wide' : 'bc-tabstack-count'}>{badge}</span>
        ) : (
          <ShellIcon src={tabsPlus} />
        )}
      </span>
    </span>
  );
}
