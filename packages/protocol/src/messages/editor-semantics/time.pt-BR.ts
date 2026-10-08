import type { TimeMessages } from './time.ts';

export const ptBR: TimeMessages = {
  rateNotPositive: "O numerador e o denominador da taxa de quadros devem ser positivos",
  rateNotReduced: "A taxa de quadros deve estar na forma irredutível",
  timescaleNotPositive: "timescale deve ser maior que 0",
  notInteger: (p) => `Não é um inteiro decimal: “${p.text}”`,
  leadingZero: "Inteiros não podem ter zeros à esquerda",
  notDecimalSeconds: (p) => `Não são segundos decimais: “${p.text}”`,
  negativePosition: "Uma posição absoluta não pode ser negativa",
};
