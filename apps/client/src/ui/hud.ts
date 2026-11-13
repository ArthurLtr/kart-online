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
  /** Esconde o HUD fora da corrida (lobby, resultado). Volta a aparecer no próximo `update`. */
  setVisible(visible: boolean): void;
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

/** Segmentos do conta-giros. */
const REV_SEGMENTS = 14;
/** A partir deste segmento o conta-giros fica vermelho. */
const REV_RED = 12;

/** HUD da corrida: posição, volta, tempos, minimapa, velocímetro, conta-giros e pneus. */
export function createHud(parent: HTMLElement, track: Track): Hud {
  const root = element('div', 'hud', parent);
  // Sem dados (lobby, carregando) o HUD não aparece.
  root.hidden = true;
  let visible = true;

  const place = element('section', 'hud-lugar', root);
  place.setAttribute('aria-label', 'Posição e volta');
  const positionLabel = element('p', 'hud-posicao', place);
  const positionNumber = element('strong', '', positionLabel);
  const positionTotal = element('span', '', positionLabel);
  const lapLabel = element('p', 'hud-volta', place);

  const timing = element('section', 'hud-tempos', root);
  timing.setAttribute('aria-label', 'Tempos');
  const currentLabel = element('p', 'hud-tempo', timing);
  const row = (label: string): HTMLElement => {
    const line = element('p', 'hud-linha', timing);
    element('span', '', line, label);
    return element('b', '', line);
  };
  const lastLabel = row('Última');
  const bestLabel = row('Melhor');
  const minimap = createMinimap(track);
  timing.append(minimap.element);

  const notice = element('p', 'hud-aviso', root);
  notice.setAttribute('role', 'status');

  const gauges = element('section', 'hud-painel', root);
  gauges.setAttribute('aria-label', 'Painel');
  const tireLabel = element('p', 'hud-pneus', gauges);
  const speedRow = element('p', 'hud-velocidade', gauges);
  const speedLabel = element('strong', '', speedRow);
  element('span', 'hud-unidade', speedRow, 'km/h');
  const revBar = element('div', 'hud-giro', gauges);
  revBar.setAttribute('aria-hidden', 'true');
  const revSegments = Array.from({ length: REV_SEGMENTS }, (_, index) => {
    const segment = element('i', '', revBar);
    if (index >= REV_RED) segment.dataset.alto = 'true';
    return segment;
  });
  const revLabel = element('p', 'hud-rpm', gauges);
  const help = element('p', 'hud-ajuda', root);

  let message = '';
  let messageUntil = 0;
  let litSegments = -1;
  const setText = (node: HTMLElement, text: string): void => {
    if (node.textContent !== text) node.textContent = text;
  };

  return {
    update(data, now) {
      if (!visible) return;
      if (root.hidden) root.hidden = false;
      const [position = '', total = ''] = data.positionText.split('/');
      if (positionNumber.textContent !== position) {
        // Trocou de posição: o número pisca uma vez.
        const first = positionNumber.textContent === '';
        positionNumber.textContent = position;
        if (!first && position) {
          positionLabel.classList.remove('hud-mudou');
          void positionLabel.offsetWidth;
          positionLabel.classList.add('hud-mudou');
        }
      }
      setText(positionTotal, total ? `/${total}` : '');
      positionLabel.hidden = position === '';
      setText(lapLabel, data.lapText);
      setText(currentLabel, formatTime(data.currentTicks));
      setText(lastLabel, formatTime(data.lastTicks));
      setText(bestLabel, formatTime(data.bestTicks));
      setText(speedLabel, String(Math.round(Math.abs(data.speed) * 3.6)));
      const rev = (data.rpm - TUNING.idleRpm) / (TUNING.maxRpm - TUNING.idleRpm);
      const lit = Math.round(Math.min(1, Math.max(0, rev)) * REV_SEGMENTS);
      if (lit !== litSegments) {
        litSegments = lit;
        revSegments.forEach((segment, index) => {
          segment.dataset.aceso = String(index < lit);
        });
      }
      setText(revLabel, `${(Math.round(data.rpm / 100) / 10).toFixed(1)} × 1000 rpm`);
      minimap.draw(data.dots);
      const cold = data.tireTemp < 0.85;
      setText(tireLabel, cold ? `Pneus frios ${Math.round(data.tireTemp * 100)}%` : 'Pneus ok');
      tireLabel.dataset.frio = String(cold);
      const text = now < messageUntil ? message : data.offTrack ? 'Fora da pista' : '';
      setText(notice, text);
      notice.dataset.alerta = String(text === 'Fora da pista');
    },
    say(text, seconds, now) {
      message = text;
      messageUntil = now + seconds;
    },
    setHelp(text) {
      setText(help, text);
    },
    setVisible(next) {
      visible = next;
      if (!next) root.hidden = true;
    },
    dispose() {
      root.remove();
    },
  };
}
