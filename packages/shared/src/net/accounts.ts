import type { LevelView, QueueKind } from './progression.js';
import type { Cosmetics, CustomPaint } from './protocol.js';
import { sanitizeCosmetics, sanitizeCustomPaint } from './protocol.js';

/** Visual completo guardado com um nome, para trocar com um clique. */
export interface PresetData {
  name: string;
  loadout: Cosmetics;
  paint: CustomPaint | null;
}

export const MAX_PRESETS = 6;

export const sanitizePresetName = (value: unknown): string =>
  (typeof value === 'string' ? value.replace(/[^\p{L}\p{N} _.-]/gu, '').trim() : '').slice(0, 20) ||
  'Visual';

export function sanitizePresets(value: unknown): PresetData[] {
  if (!Array.isArray(value)) return [];
  const presets: PresetData[] = [];
  for (const raw of value.slice(0, MAX_PRESETS)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    presets.push({
      name: sanitizePresetName(entry.name),
      loadout: sanitizeCosmetics(entry.loadout),
      paint: sanitizeCustomPaint(entry.paint),
    });
  }
  return presets;
}

export const DIVISIONS = [
  { name: 'Bronze', min: 0 },
  { name: 'Prata', min: 800 },
  { name: 'Ouro', min: 1300 },
  { name: 'Platina', min: 1800 },
  { name: 'Diamante', min: 2300 },
  { name: 'Mestre', min: 2800 },
  { name: 'Lenda', min: 3300 },
] as const;

/** Partidas de posicionamento antes de a divisão aparecer. */
export const PLACEMENT_MATCHES = 5;

/** Pontos exibidos: estimativa conservadora da habilidade (mu − 3·sigma). */
export function ratingPoints(mu: number, sigma: number): number {
  return Math.max(0, Math.round((mu - 3 * sigma) * 100));
}

export function divisionOf(points: number): string {
  let name: string = DIVISIONS[0].name;
  for (const division of DIVISIONS) if (points >= division.min) name = division.name;
  return name;
}

export interface RatingView {
  points: number;
  /** `null` enquanto está em posicionamento. */
  division: string | null;
  matches: number;
  placementLeft: number;
}

export function ratingView(mu: number, sigma: number, matches: number): RatingView {
  const points = ratingPoints(mu, sigma);
  const placementLeft = Math.max(0, PLACEMENT_MATCHES - matches);
  return {
    points,
    division: placementLeft > 0 ? null : divisionOf(points),
    matches,
    placementLeft,
  };
}

export interface AccountView {
  id: string;
  name: string;
  guest: boolean;
  email: string | null;
  /** Menor de 18: não pode comprar gemas com dinheiro real. */
  minor: boolean;
  /** Já confirmou o kart inicial. Antes disso, o jogo fica na Garagem em modo de criação. */
  onboarded: boolean;
}

export interface HistoryEntry {
  mode: string;
  position: number;
  karts: number;
  timeTicks: number | null;
  bestLapTicks: number | null;
  pointsDelta: number | null;
  /** Experiência e moedas ganhas na corrida. */
  xp: number;
  coins: number;
  endedAt: string;
}

/** Carreira num modo ("casual", "ranked" ou "private"). */
export interface CareerStats {
  mode: string;
  matches: number;
  wins: number;
  podiums: number;
  finishes: number;
  /** Posição média de chegada (0 sem corridas). */
  averagePosition: number;
  bestLapTicks: number | null;
}

export interface TrackRecordView {
  track: string;
  bestLapTicks: number | null;
  bestRaceTicks: number | null;
}

export interface MeResponse {
  user: AccountView;
  season: { name: string; endsAt: string };
  rating: RatingView;
  /** Nível de carreira e experiência. */
  level: LevelView;
  /** Moedas do jogo (ganhas correndo, gastas na loja). */
  coins: number;
  /** Gemas (compradas com dinheiro real, por Pix). */
  gems: number;
  stats: CareerStats[];
  records: TrackRecordView[];
  /** Ids ("slot:chave") dos cosméticos possuídos. */
  inventory: string[];
  loadout: Cosmetics;
  /** Pintura livre gravada na conta. Ausente = a conta nunca gravou uma. */
  paint?: CustomPaint | null;
  presets: PresetData[];
  history: HistoryEntry[];
}

export interface AuthResponse {
  token: string;
  user: AccountView;
}

/** O que o cliente precisa saber do servidor antes de entrar. */
export interface PublicConfig {
  /** Client ID do Google para o botão "Entrar com Google"; `null` = login Google desligado. */
  googleClientId: string | null;
}

/** Resposta do login Google quando a conta ainda não existe e faltam dados. */
export interface GoogleProfileNeeded {
  needsProfile: true;
  /** Nome que veio do Google, como sugestão de apelido. */
  suggestedName: string;
}

export interface RankingEntry {
  position: number;
  name: string;
  points: number;
  division: string | null;
  matches: number;
}

export interface QueueStatus {
  state: 'idle' | 'waiting' | 'matched';
  /** Fila em que o jogador está (ou da partida formada). */
  queue: QueueKind | null;
  waitedSeconds: number;
  /** Diferença de habilidade aceita no momento (cresce com a espera). */
  band: number;
  /** Reserva de vaga do Colyseus, quando a partida foi formada. */
  reservation: unknown;
}
