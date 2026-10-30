import type { ImportNote } from '@baocut/protocol';
import Import from '@react-spectrum/s2/icons/Import';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { sourceName } from '../../model/agent-import.ts';
import { agoLabel } from '../../model/format.ts';
import { useConnection } from '../../state/connection-store.ts';
import { IMPORT_COPY as I } from '../agent-import/import-copy.ts';

const line = style({ display: 'flex', alignItems: 'center', gap: 12, font: 'ui-xs', color: 'gray-600' });
const rule = style({ flexGrow: 1, flexShrink: 1, flexBasis: 24, height: 1, backgroundColor: 'gray-200' });
const text = style({
  flexGrow: 0,
  flexShrink: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexWrap: 'wrap',
  gap: 4,
  textAlign: 'center',
});

/**
 * 导入的会话里复制过来的记录下面那一条（产品设计 §3.1「导入外部会话」，原型 model-agent-import.js `toRows`）：「以上导入自 X · 时刻」；
 * 只复制了最近的几轮时写明更早的几轮没有复制。
 */
export function ImportedMarker({ note }: { note: ImportNote }) {
  const probed = useConnection((s) => s.drivers?.find((d) => d.id === note.driverId)?.name);
  return (
    <div className={line} role="note">
      <span className={rule} aria-hidden />
      <span className={text}>
        <Import />
        <span>{I.importedFrom(sourceName(note.driverId, probed), agoLabel(note.at))}</span>
        {note.omitted ? <span>· {I.omitted(note.omitted)}</span> : null}
      </span>
      <span className={rule} aria-hidden />
    </div>
  );
}
