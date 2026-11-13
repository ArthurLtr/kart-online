/** Regras fixas da corrida. Valem para cliente e servidor. */
export const MAX_KARTS = 9;
export const RACE_LAPS = 3;

/** Passo fixo da simulação e taxa de snapshots do servidor. */
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;
export const NET_TICK_HZ = 30;

/** Dimensões oficiais do kart em metros (o GLB é escalado para este comprimento). */
export const KART_LENGTH_M = 1.85;

export const SERVER_DEFAULT_PORT = 2567;
