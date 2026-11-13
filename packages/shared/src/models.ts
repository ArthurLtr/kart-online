/**
 * Contrato de nomes dos modelos. O conversor de assets (tools/assets) e as
 * factories procedurais do cliente produzem nós com exatamente estes nomes,
 * para que um GLB possa substituir um procedural sem mudar outra linha.
 */
export const MODEL_IDS = ['kart', 'pilot', 'helmet'] as const;
export type ModelId = (typeof MODEL_IDS)[number];

/**
 * Partes nomeadas do kart.
 * - Rodas: pivô no centro do eixo; giram em torno do X local e as dianteiras
 *   esterçam em torno do Y. `userData.radius` traz o raio em metros.
 * - Volante: pivô no centro do aro; gira em torno de `userData.axis`.
 */
export const KART_PARTS = {
  body: 'kart_body',
  fairing: 'fairing',
  exhaust: 'exhaust',
  wheelFrontLeft: 'wheel_fl',
  wheelFrontRight: 'wheel_fr',
  wheelRearLeft: 'wheel_rl',
  wheelRearRight: 'wheel_rr',
  steeringWheel: 'steering_wheel',
} as const;
export type KartPartName = (typeof KART_PARTS)[keyof typeof KART_PARTS];

export const KART_WHEEL_PARTS: readonly KartPartName[] = [
  KART_PARTS.wheelFrontLeft,
  KART_PARTS.wheelFrontRight,
  KART_PARTS.wheelRearLeft,
  KART_PARTS.wheelRearRight,
];

/**
 * Slots de cosmético. Só o cliente lê isto para renderizar; a simulação e o
 * servidor nunca recebem dados de cosmético.
 */
export const COSMETIC_SLOTS = [
  'livery',
  'fairing',
  'rim',
  'tireStripe',
  'decals',
  'exhaust',
  'suit',
  'gloves',
  'boots',
  'helmetModel',
  'helmetPaint',
  'visorColor',
  'trail',
] as const;
export type CosmeticSlot = (typeof COSMETIC_SLOTS)[number];
