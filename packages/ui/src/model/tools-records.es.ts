import type { ToolsRecordsMessages } from './tools-records.ts';
export const es: ToolsRecordsMessages = {
  generating: 'Generando', queued: 'En cola', cancelled: 'Cancelado', failed: 'Fallido',
  unfinished: 'Sin terminar', unknown: 'Resultado desconocido',
  interrupted: 'El Runtime se detuvo o reinició antes de terminar',
  reconcile: 'El Runtime se reinició antes de que esta llamada respondiera. El resultado es desconocido y puede que ya se haya facturado',
  noResult: 'No se generó nada',
};
