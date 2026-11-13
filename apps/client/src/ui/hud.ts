import type { Track } from '@kart/shared';
import { SIM_HZ, TUNING } from '@kart/shared';
import type { MinimapDot } from './minimap';
import { createMinimap } from './minimap';

/** 83,456 s → "1:23.456". */
export function formatTime(ticks: number | null): string {
  if (ticks === null) return '–:––.–––';
  const total = ticks / SIM_HZ;
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  return `${minutes}:${seconds.toFixed(3).padStart(6, '0')}`;
}

export interface HudData {
  /** Ex.: "Volta 2/3" ou "Volta de saída". */
  lapText: string;
  /** Ex.: "1º/9"; vazio no treino. */
  positionText: string;
  currentTicks: number;
  lastTicks: number | null;
  bestTicks: number | null;
  speed: number;
  rpm: number;
  tireTemp: number;
  offTrack: boolean;
  /** Um ponto por kart no minimapa. */
  dots: readonly MinimapDot[];
}

export interface Hud {
  update(data: HudData, now: number): void;
  /** Mostra um aviso no meio da tela por alguns segundos. */
  say(text: string, seconds: number, now: number): void;
  setHelp(text: string): void;
  dispose(): void;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parent: HTMLElement,
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  parent.append(node);
  return node;
}

/** HUD da corrida: posição, volta, tempos, minimapa, velocímetro, conta-giros e pneus. */
export function createHud(parent: HTMLElement, track: Track): Hud {
  const root = element('div', 'hud', parent);
  const timing = element('section', 'hud-tempos', root);
  timing.setAttribute('aria-label', 'Tempos');
  const positionLabel = element('p', 'hud-posicao', timing);
  const lapLabel = element('p', 'hud-volta', timing);
  const currentLabel = element('p', 'hud-tempo', timing);
  const lastLabel = element('p', '', timing);
  const bestLabel = element('p', '', timing);
  const minimap = createMinimap(track);
  root.append(minimap.element);
  const notice = element('p', 'hud-aviso', root);
  notice.setAttribute('role', 'status');
  const gauges = element('section', 'hud-painel', root);
  gauges.setAttribute('aria-label', 'Painel');
  const speedLabel = element('p', 'hud-velocidade', gauges);
  element('span', 'hud-unidade', gauges, 'km/h');
  const revBar = element('div', 'hud-giro', gauges);
  const revFill = element('div', '', revBar);
  const revLabel = element('p', 'hud-rpm', gauges);
  const tireLabel = element('p', 'hud-pneus', gauges);
  const help = element('p', 'hud-ajuda', root);

  let message = '';
  let messageUntil = 0;
  const setText = (node: HTMLElement, text: string): void => {
    if (node.textContent !== text) node.textContent = text;
  };

  return {
    update(data, now) {
      setText(positionLabel, data.positionText);
      setText(lapLabel, data.lapText);
      setText(currentLabel, formatTime(data.currentTicks));
      setText(lastLabel, `Última ${formatTime(data.lastTicks)}`);
      setText(bestLabel, `Melhor ${formatTime(data.bestTicks)}`);
      setText(speedLabel, String(Math.round(Math.abs(data.speed) * 3.6)));
      const rev = (data.rpm - TUNING.idleRpm) / (TUNING.maxRpm - TUNING.idleRpm);
      revFill.style.transform = `scaleX(${Math.min(1, Math.max(0, rev)).toFixed(3)})`;
      revFill.dataset.alto = String(rev > 0.9);
      setText(revLabel, `${(Math.round(data.rpm / 100) / 10).toFixed(1)} × 1000 rpm`);
      minimap.draw(data.dots);
      const cold = data.tireTemp < 0.85;
      setText(
        tireLabel,
        cold ? `Pneus frios ${Math.round(data.tireTemp * 100)}%` : 'Pneus na temperatura',
      );
      tireLabel.dataset.frio = String(cold);
      setText(notice, now < messageUntil ? message : data.offTrack ? 'Fora da pista' : '');
    },
    say(text, seconds, now) {
      message = text;
      messageUntil = now + seconds;
    },
    setHelp(text) {
      setText(help, text);
    },
    dispose() {
      root.remove();
    },
  };
}
