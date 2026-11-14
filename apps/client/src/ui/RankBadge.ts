import type { RankTier, RankTierId, RatingView } from '@kart/shared';
import { getRankFromRating, RANK_TIERS } from '@kart/shared';
import { btn, el } from './dom';

export interface RankBadgeOptions {
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  showProgress?: boolean;
}

const fmt = (points: number): string => points.toLocaleString('pt-BR');

/** Faixa de pontos legível ("1.300–1.799 pts" ou "2.900+ pts"). */
export const tierRange = (tier: RankTier): string =>
  Number.isFinite(tier.maxRating)
    ? `${fmt(tier.minRating)}–${fmt(tier.maxRating)} pts`
    : `${fmt(tier.minRating)}+ pts`;

function icon(tier: RankTier | null): HTMLImageElement {
  const image = el('img', 'patente-icone');
  image.src = (tier ?? RANK_TIERS[0]!).iconPath;
  image.alt = '';
  image.decoding = 'async';
  return image;
}

/**
 * Insígnia da patente: ícone com brilho da cor do elo, nome e (opcional) barra
 * até a próxima. Aceita pontos, o id da patente, ou `null` (em posicionamento).
 */
export function createRankBadgeElement(
  rating: number | RankTierId | null,
  options: RankBadgeOptions = {},
): HTMLElement {
  const { size = 'md', showLabel = true, showProgress = false } = options;
  const points = typeof rating === 'number' ? rating : null;
  const tier =
    typeof rating === 'string'
      ? (RANK_TIERS.find((entry) => entry.id === rating) ?? null)
      : points === null
        ? null
        : getRankFromRating(points).tier;
  const badge = el('span', `patente patente-${size}`);
  badge.dataset.patente = tier?.id ?? 'posicionamento';
  if (tier) badge.style.setProperty('--patente', tier.primaryColor);
  const label = tier ? `${tier.name} · ${tier.title}` : 'Em posicionamento';
  badge.title = label;
  if (!showLabel) {
    badge.setAttribute('role', 'img');
    badge.setAttribute('aria-label', `Patente: ${label}`);
  }
  badge.append(icon(tier));
  if (!showLabel && !showProgress) return badge;

  const text = el('span', 'patente-texto');
  if (showLabel) {
    const name = el('span', 'patente-nome');
    name.append(el('strong', '', tier?.name ?? 'Posicionamento'));
    if (tier && size !== 'sm') name.append(el('small', '', tier.title));
    text.append(name);
  }
  if (showProgress && points !== null) {
    const rank = getRankFromRating(points);
    const bar = el('span', 'patente-barra');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', 'Progresso até a próxima patente');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', String(Math.round(rank.progress)));
    const fill = el('i');
    fill.style.width = `${rank.progress}%`;
    bar.append(fill);
    text.append(
      bar,
      el(
        'small',
        'patente-falta',
        rank.next
          ? `${fmt(points)} pts · faltam ${fmt(rank.pointsToNext ?? 0)} para ${rank.next.name}`
          : `${fmt(points)} pts · patente máxima`,
      ),
    );
  }
  badge.append(text);
  return badge;
}

/** Modal com as 6 patentes, faixas de pontos e recompensa de temporada. */
export function openRanksModal(current: number | null): void {
  const dialog = el('dialog', 'modal-patentes');
  dialog.setAttribute('aria-labelledby', 'modal-patentes-titulo');
  const title = el('h2', '', 'Patentes do Ranqueado');
  title.id = 'modal-patentes-titulo';
  const here = current === null ? null : getRankFromRating(current).tier.id;
  const list = el('ol', 'patentes-lista');
  for (const tier of [...RANK_TIERS].reverse()) {
    const item = el('li', 'patentes-item');
    item.style.setProperty('--patente', tier.primaryColor);
    if (tier.id === here) {
      item.dataset.atual = 'true';
      item.setAttribute('aria-current', 'true');
    }
    const text = el('span', 'patentes-texto');
    text.append(
      el('strong', '', tier.name),
      el('span', '', tier.title),
      el('small', '', tierRange(tier)),
    );
    item.append(
      createRankBadgeElement(tier.id, { size: 'md', showLabel: false }),
      text,
      el('span', 'patentes-premio', `${fmt(tier.seasonRewardCoins)} moedas no fim da temporada`),
    );
    if (tier.id === here) item.append(el('span', 'etiqueta', 'Você'));
    list.append(item);
  }
  const actions = el('div', 'botoes');
  const close = btn('primario', 'Fechar', () => dialog.close());
  actions.append(close);
  dialog.append(
    title,
    el('p', 'nota', 'A patente aparece depois das partidas de posicionamento.'),
    list,
    actions,
  );
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  close.focus();
}

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Resultado ranqueado: conta os pontos do valor antigo até o novo e, se subiu
 * de patente, revela a nova insígnia com scale-up e brilho.
 */
export function createRankResult(
  points: number,
  delta: number | null,
  promoted: boolean,
  demoted: boolean,
  placed: boolean,
): HTMLElement {
  const box = el('div', 'patente-resultado');
  const before = points - (delta ?? 0);
  const badge = createRankBadgeElement(placed ? points : null, {
    size: 'lg',
    showProgress: placed,
  });
  const counter = el('strong', 'patente-pontos', `${fmt(before)} pts`);
  const change = el('span', 'patente-delta');
  if (delta !== null) {
    change.textContent = `${delta >= 0 ? '+' : '−'}${fmt(Math.abs(delta))}`;
    change.dataset.sinal = delta >= 0 ? 'ganho' : 'perda';
  }
  const line = el('div', 'patente-linha');
  line.append(counter, change);
  box.append(badge, line);
  if (promoted && placed) {
    box.prepend(el('span', 'patente-aviso', 'Nova patente!'));
    box.dataset.promovido = 'true';
  } else if (demoted) {
    box.prepend(el('span', 'patente-aviso', 'Você caiu de patente'));
    box.dataset.rebaixado = 'true';
  }
  if (reducedMotion() || delta === null) {
    counter.textContent = `${fmt(points)} pts`;
    return box;
  }
  const started = performance.now();
  const step = (now: number): void => {
    const t = Math.min(1, (now - started) / 1100);
    const eased = 1 - (1 - t) ** 3;
    counter.textContent = `${fmt(Math.round(before + (points - before) * eased))} pts`;
    if (t < 1 && box.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return box;
}

/** Destaque da patente antes da fila: insígnia grande, progresso e "Ver Patentes". */
export function createRankHighlight(rating: RatingView, compact = false): HTMLElement {
  const placed = rating.division !== null;
  const box = el('div', compact ? 'online-patente compacta' : 'online-patente');
  box.append(
    createRankBadgeElement(placed ? rating.points : null, {
      size: compact ? 'md' : 'lg',
      showProgress: placed,
    }),
  );
  if (!placed && compact) {
    box
      .querySelector('.patente-nome')
      ?.append(el('small', '', `faltam ${rating.placementLeft} partidas`));
  } else if (!placed) {
    box.append(
      el(
        'p',
        'nota',
        `Faltam ${rating.placementLeft} partidas ranqueadas para a sua patente aparecer.`,
      ),
    );
  }
  const actions = el('div', 'botoes');
  actions.append(btn('', 'Ver Patentes', () => openRanksModal(placed ? rating.points : null)));
  box.append(actions);
  return box;
}
