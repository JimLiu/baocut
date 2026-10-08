import type { RenderMessages } from './render-copy.ts';
export const es: RenderMessages = {
  confetti: {
    shapes: { rect: 'Papel', strip: 'Tira', circle: 'Punto', ellipse: 'Elipse', triangle: 'Triángulo', diamond: 'Rombo', star: 'Estrella', starlet: 'Estrella de cuatro puntas', sparkle: 'Destello', heart: 'Corazón', petal: 'Pétalo', ribbon: 'Cinta' },
    styles: { 'rainbow-paper': 'Papel arcoíris', 'pastel-fall': 'Caída en tonos pastel', 'neon-streamers': 'Serpentinas de neón', 'golden-starburst': 'Estallido de estrellas doradas', 'festival-fireworks': 'Fuegos artificiales festivos', 'hearts-petals': 'Corazones y pétalos', 'party-cannons': 'Cañones de fiesta', 'curling-ribbons': 'Cintas rizadas', 'geometric-pop': 'Explosión geométrica', 'champagne-sparkle': 'Destellos de champán' },
  },
  fonts: {
    tableFailed: (status: number) => `No se pudo obtener una tabla de fuentes: ${status}`,
    tableLength: (expected: number, got: number) => `La tabla de fuentes tiene una longitud incorrecta: se esperaban ${expected} bytes y se recibieron ${got}`,
    localMissing: (family: string) => `La fuente local ${family} ya no está`,
    notFound: (name: string) => `No se encontró la fuente ${name}. Primero ejecuta npm run build:wasm`,
    unreadable: (name: string, status: number) => `No se pudo leer la fuente ${name} (${status})`,
    unreadableUrl: (url: string) => `No se pudo leer la fuente: ${url}`,
  },
  planner: {
    wasmMissing: 'El WASM de vista previa no está disponible. Primero ejecuta npm run build:wasm',
    reloading: 'El planificador de fotogramas se está recargando',
    crashed: (message: string) => `El planificador de fotogramas encontró un error y se está recargando: ${message}`,
    reloadFailed: 'No se pudo recargar el planificador de fotogramas',
  },
};
