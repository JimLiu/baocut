import { beforeEach, describe, expect, it } from 'vitest';
import { useHelp } from './help-store.ts';

describe('useHelp', () => {
  beforeEach(() => useHelp.setState({ isOpen: false, session: 0, origin: null }));

  it('每次打开算一次新的会话；开着时再打开不重置', () => {
    useHelp.getState().open();
    expect(useHelp.getState()).toMatchObject({ isOpen: true, session: 1 });
    useHelp.getState().open();
    expect(useHelp.getState().session).toBe(1);
    useHelp.getState().close();
    expect(useHelp.getState().isOpen).toBe(false);
    useHelp.getState().open();
    expect(useHelp.getState().session).toBe(2);
  });

  it('没有 DOM 时不记来源', () => {
    useHelp.getState().open(null);
    expect(useHelp.getState().origin).toBeNull();
  });
});
