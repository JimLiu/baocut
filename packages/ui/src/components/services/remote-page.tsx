import { useState, type Key } from 'react';
import { SegmentedControl, SegmentedControlItem } from '@react-spectrum/s2';
import { REMOTE_COPY } from '../../copy.ts';
import { UtilityPage } from '../utility-page.tsx';
import { RemoteNodes } from './remote-nodes.tsx';
import { RemoteShare } from './remote-share.tsx';
import { lede, strong } from './service-card.tsx';

/**
 * 远端算力页（原型 designs/baocut/app/page-shell.jsx `RemotePage`）：标题右侧两个页签，默认落在「共享这台 Mac」——
 * 这一页住在「服务」里，先回答开没开。页签只存在页面里（路由没有页签段）。
 */
export function RemotePage() {
  const [tab, setTab] = useState<'share' | 'nodes'>('share');
  const lines = tab === 'share' ? REMOTE_COPY.ledeShare : REMOTE_COPY.ledeNodes;
  return (
    <UtilityPage
      kind="services"
      title={REMOTE_COPY.title}
      actions={
        <SegmentedControl
          aria-label={REMOTE_COPY.tabsLabel}
          selectedKey={tab}
          onSelectionChange={(key: Key) => setTab(key === 'nodes' ? 'nodes' : 'share')}>
          <SegmentedControlItem id="share">{REMOTE_COPY.tabShare}</SegmentedControlItem>
          <SegmentedControlItem id="nodes">{REMOTE_COPY.tabNodes}</SegmentedControlItem>
        </SegmentedControl>
      }>
      <p className={lede}>
        {lines.before}
        <b className={strong}>{lines.strong}</b>
        {lines.after}
      </p>
      {tab === 'share' ? <RemoteShare /> : <RemoteNodes />}
    </UtilityPage>
  );
}
