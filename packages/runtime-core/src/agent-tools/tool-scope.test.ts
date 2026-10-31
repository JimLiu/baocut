import { describe, expect, it } from 'vitest';
import { confirmRisk, type ToolConfirmation } from './tool-scope.ts';

/* 无人在场的 Bot 回合里，可能花钱的调用不论授权都要问（Bot 技术方案 §14.2）。 */

const speak = (paid: boolean): ToolConfirmation => ({ tool: 'speak', summary: 'speak', risk: 'command', paid });

describe('confirmRisk', () => {
  it('a paid call in an unattended thread or channel turn is high, so even auto mode asks', () => {
    expect(confirmRisk(speak(true), { role: 'thread', attended: false })).toBe('high');
    expect(confirmRisk(speak(true), { role: 'channel', attended: false })).toBe('high');
  });

  it('attended turns, plain chats, unpaid calls and calls outside a turn keep their own risk', () => {
    expect(confirmRisk(speak(true), { role: 'thread', attended: true })).toBe('command');
    expect(confirmRisk(speak(true), { role: 'chat', attended: false })).toBe('command');
    expect(confirmRisk(speak(false), { role: 'thread', attended: false })).toBe('command');
    expect(confirmRisk(speak(true), null)).toBe('command');
    expect(confirmRisk({ tool: 'unknown_tool', summary: 's' }, { role: 'thread', attended: false })).toBe('command');
  });
});
