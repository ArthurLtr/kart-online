import type { RoomMode } from './protocol.js';

/** Filas de pareamento. Sala privada não tem fila. */
export type QueueKind = 'casual' | 'ranked';

// --- habilidade ---------------------------------------------------------------

/** Habilidade inicial do OpenSkill (mu) e a incerteza inicial (sigma). */
export const START_MU = 25;
export const START_SIGMA = 25 / 3;

/** mu do OpenSkill → número inteiro usado pela fila (25,0 → 2500). */
export const skillNumber = (mu: number): number => Math.round(mu * 100);

/** Faixa de mu coberta pelos bots: do mais lento (nível 0) ao mais rápido (nível 1). */
const BOT_MU_MIN = 16;
const BOT_MU_MAX = 34;

/** Nível dos bots (0 a 1) para um grupo com esta habilidade média. */
export function botSkillFor(mu: number): number {
  const level = (mu - BOT_MU_MIN) / (BOT_MU_MAX - BOT_MU_MIN);
  return Math.min(1, Math.max(0.05, level));
}

/** Habilidade equivalente de um bot de certo nível, para entrar na conta do rating. */
export const botMu = (level: number): number => BOT_MU_MIN + level * (BOT_MU_MAX - BOT_MU_MIN);

// --- experiência e níveis ------------------------------------------------------

export const MAX_LEVEL = 100;

/** XP para sair do nível `level` e chegar ao próximo. Cresce devagar e de forma previsível. */
export const xpToNext = (level: number): number => 300 + 60 * (level - 1);

/** XP total necessário para estar no nível `level` (nível 1 = 0). */
export function xpForLevel(level: number): number {
  const steps = Math.min(MAX_LEVEL, Math.max(1, level)) - 1;
  // Soma de uma progressão aritmética: 300, 360, 420…
  return steps * 300 + 60 * ((steps * (steps - 1)) / 2);
}

export interface LevelView {
  level: number;
  xp: number;
  /** XP já acumulado dentro do nível atual e o total do nível (0/0 no nível máximo). */
  into: number;
  needed: number;
  /** Título de carreira do nível. */
  title: string;
}

const TITLES: readonly (readonly [number, string])[] = [
  [1, 'Novato'],
  [5, 'Amador'],
  [10, 'Piloto'],
  [20, 'Veterano'],
  [35, 'Especialista'],
  [50, 'Campeão'],
  [75, 'Mestre das pistas'],
  [100, 'Lenda'],
];

export function levelTitle(level: number): string {
  let title = TITLES[0]![1];
  for (const [from, name] of TITLES) if (level >= from) title = name;
  return title;
}

export function levelView(xp: number): LevelView {
  const total = Math.max(0, Math.floor(xp));
  let level = 1;
  while (level < MAX_LEVEL && total >= xpForLevel(level + 1)) level++;
  const maxed = level >= MAX_LEVEL;
  return {
    level,
    xp: total,
    into: maxed ? 0 : total - xpForLevel(level),
    needed: maxed ? 0 : xpToNext(level),
    title: levelTitle(level),
  };
}

export interface XpInput {
  mode: RoomMode;
  /** 1 = vencedor. */
  position: number;
  /** Karts na corrida (com bots). */
  karts: number;
  /** Humanos na corrida. */
  humans: number;
  finished: boolean;
  abandoned: boolean;
  penaltyTicks: number;
  /** Fez a melhor volta pessoal na pista. */
  personalBest: boolean;
}

export interface XpLine {
  label: string;
  xp: number;
}

/**
 * XP de uma corrida, linha por linha (o cliente mostra a conta). Só depende do
 * resultado oficial do servidor. Correr sozinho em sala privada não rende:
 * senão daria para subir de nível sem adversário.
 */
export function raceXp(input: XpInput): XpLine[] {
  if (input.mode === 'private' && input.humans < 2) return [];
  if (input.abandoned) return [{ label: 'Corrida abandonada', xp: 10 }];
  const lines: XpLine[] = [{ label: 'Participação', xp: 60 }];
  if (input.finished) {
    lines.push({ label: 'Corrida completa', xp: 40 });
    const rivals = Math.max(1, input.karts - 1);
    const beaten = Math.max(0, input.karts - input.position);
    const placing = Math.round((beaten / rivals) * 80);
    if (placing > 0) lines.push({ label: `${input.position}º lugar`, xp: placing });
    if (input.position === 1 && input.karts > 1) lines.push({ label: 'Vitória', xp: 40 });
    else if (input.position <= 3 && input.karts > 3) lines.push({ label: 'Pódio', xp: 20 });
    if (input.penaltyTicks === 0) lines.push({ label: 'Corrida limpa', xp: 15 });
    if (input.personalBest) lines.push({ label: 'Melhor volta pessoal', xp: 25 });
  }
  const subtotal = lines.reduce((sum, line) => sum + line.xp, 0);
  if (input.mode === 'ranked') {
    lines.push({ label: 'Bônus do Ranqueado', xp: Math.round(subtotal * 0.25) });
  } else if (input.mode === 'private') {
    lines.push({ label: 'Sala privada', xp: -Math.round(subtotal * 0.5) });
  }
  return lines;
}

export const totalXp = (lines: readonly XpLine[]): number =>
  Math.max(
    0,
    lines.reduce((sum, line) => sum + line.xp, 0),
  );

// --- moedas e loja --------------------------------------------------------------

/**
 * Moedas de uma corrida: proporcionais à experiência ganha (quem corre bem
 * ganha mais das duas coisas). Só existem moedas ganhas jogando.
 */
export const raceCoins = (xp: number): number => Math.max(0, Math.round(xp * 0.6));

/** Bônus em moedas ao chegar ao nível `level`. */
export const levelUpCoins = (level: number): number => 100 + 20 * level;

/** Soma dos bônus ao passar de `from` para `to`. */
export function levelUpBonus(from: number, to: number): number {
  let total = 0;
  for (let level = from + 1; level <= to; level++) total += levelUpCoins(level);
  return total;
}

/** Moedas que toda conta nova recebe. */
export const WELCOME_COINS = 200;
