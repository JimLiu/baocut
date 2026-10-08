import type { TimeMessages } from './time.ts';
export const es: TimeMessages = {
 rateNotPositive: 'El numerador y el denominador de la frecuencia de fotogramas deben ser positivos', rateNotReduced: 'La frecuencia de fotogramas debe estar en su mínima expresión',
 timescaleNotPositive: 'timescale debe ser mayor que 0', notInteger: (p) => `No es un entero decimal: «${p.text}»`, leadingZero: 'Los enteros no pueden tener ceros iniciales',
 notDecimalSeconds: (p) => `No son segundos decimales: «${p.text}»`, negativePosition: 'Una posición absoluta no puede ser negativa',
};
