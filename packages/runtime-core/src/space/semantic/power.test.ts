import { describe, expect, it } from 'vitest';
import { parseDarwinBattery, parseDarwinThermal, parseLinuxSupplies, parseWindowsBattery } from './power.ts';

describe('供电与散热的解析', () => {
  it('macOS：pmset 的电源来源；限速低于 100 当作过热', () => {
    expect(parseDarwinBattery("Now drawing from 'AC Power'\n -InternalBattery-0 (id=1234)\t100%; charged;")).toBe(false);
    expect(parseDarwinBattery("Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1234)\t80%; discharging;")).toBe(true);
    expect(parseDarwinBattery("Now drawing from 'AC Power'")).toBe(false);
    expect(parseDarwinBattery('')).toBe(false);
    expect(parseDarwinThermal('Note: No thermal warning level has been recorded\nNote: No CPU power status has been recorded')).toBe(false);
    expect(parseDarwinThermal('CPU Power notify\n\tCPU_Scheduler_Limit \t= 100\n\tCPU_Speed_Limit \t= 100')).toBe(false);
    expect(parseDarwinThermal('CPU Power notify\n\tCPU_Scheduler_Limit \t= 100\n\tCPU_Speed_Limit \t= 62')).toBe(true);
  });

  it('Windows：任何一块电池在放电（1）就是在用电池；没有电池没有输出', () => {
    expect(parseWindowsBattery('1\r\n')).toBe(true);
    expect(parseWindowsBattery('2\r\n')).toBe(false);
    expect(parseWindowsBattery('2\r\n1\r\n')).toBe(true);
    expect(parseWindowsBattery('')).toBe(false);
  });

  it('Linux：有接通的外部电源就是接着电；否则电池在放电才算用电池', () => {
    const bat = (status: string) => ({ type: 'Battery', online: null, status });
    expect(parseLinuxSupplies([{ type: 'Mains', online: '1', status: null }, bat('Charging')])).toBe(false);
    expect(parseLinuxSupplies([{ type: 'Mains', online: '0', status: null }, bat('Discharging')])).toBe(true);
    expect(parseLinuxSupplies([{ type: 'USB', online: '1', status: null }, bat('Discharging')])).toBe(false);
    expect(parseLinuxSupplies([bat('Full')])).toBe(false);
    expect(parseLinuxSupplies([])).toBe(false);
  });
});
