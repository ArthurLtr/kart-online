import type { RawInput } from '@kart/shared';
import type { TouchSize, TouchSteer } from '../settings';
import { ROTATE_EVENT, toggleFullscreen } from '../ui/mobile';

/** Ações dos botões de toque. */
type Pedal = 'throttle' | 'brake' | 'drift' | 'lookBack' | 'left' | 'right';

/** Botão extra da tela (recomeçar, menu…), além dos comandos do kart. */
export interface TouchExtra {
  label: string;
  /** Texto para o leitor de tela. */
  title: string;
  run: () => void;
}

export interface TouchOptions {
  steer: TouchSteer;
  autoAccel: boolean;
  size: TouchSize;
  swap: boolean;
  extras?: readonly TouchExtra[];
}

/** Meio curso do volante, em pixels de arrasto. */
export const STEER_RADIUS = 56;
export const STEER_DEADZONE = 0.08;

/**
 * Direção pelo arrasto horizontal do dedo (`dx` em pixels, direita positivo).
 * Devolve -1 (direita) a +1 (esquerda), como na simulação, com zona morta no
 * centro e reescalada para não dar um salto ao sair dela.
 */
export function dragSteer(dx: number, radius = STEER_RADIUS, deadzone = STEER_DEADZONE): number {
  if (!Number.isFinite(dx) || radius <= 0) return 0;
  const amount = Math.max(-1, Math.min(1, dx / radius));
  const magnitude = Math.abs(amount);
  if (magnitude <= deadzone) return 0;
  const scaled = (magnitude - deadzone) / (1 - deadzone);
  return -Math.sign(amount) * scaled;
}

/** Pedais a partir dos botões apertados; com aceleração automática, o freio corta o acelerador. */
export function touchPedals(
  held: { throttle: boolean; brake: boolean },
  autoAccel: boolean,
): { throttle: number; brake: number } {
  const brake = held.brake ? 1 : 0;
  if (autoAccel) return { throttle: brake ? 0 : 1, brake };
  return { throttle: held.throttle ? 1 : 0, brake };
}

function button(className: string, label: string, title: string): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  node.textContent = label;
  node.setAttribute('aria-label', title);
  return node;
}

const buzz = (): void => {
  try {
    navigator.vibrate?.(8);
  } catch {
    // Sem vibração: segue normal.
  }
};

/**
 * Controles na tela para jogar no celular deitado: volante de um lado
 * (arrastando o dedo ou com dois botões) e pedais do outro. Multitoque: cada
 * dedo segura a sua ação, então dá para acelerar, virar e fazer drift juntos.
 */
export class TouchControls {
  readonly root: HTMLElement;
  private steerValue = 0;
  private steerPointer: number | null = null;
  private originX = 0;
  private readonly held = new Map<number, Pedal>();
  private base: HTMLElement | null = null;
  private knob: HTMLElement | null = null;

  constructor(
    private readonly options: TouchOptions,
    private readonly onTouched: () => void,
  ) {
    const root = document.createElement('div');
    root.className = 'toque-controles';
    root.dataset.direcao = options.steer;
    root.dataset.auto = String(options.autoAccel);
    root.dataset.tamanho = options.size;
    root.dataset.invertido = String(options.swap);
    root.hidden = true;

    const wheel = document.createElement('div');
    wheel.className = 'toque-direcao';
    if (options.steer === 'arrastar') {
      wheel.setAttribute('role', 'group');
      wheel.setAttribute('aria-label', 'Direção: arraste o dedo para os lados');
      const base = document.createElement('span');
      base.className = 'toque-base';
      const knob = document.createElement('span');
      knob.className = 'toque-pino';
      base.append(knob);
      const hint = document.createElement('small');
      hint.className = 'toque-dica';
      hint.textContent = '◀ arraste ▶';
      wheel.append(base, hint);
      this.base = base;
      this.knob = knob;
      wheel.addEventListener('pointerdown', this.onSteerDown);
      wheel.addEventListener('pointermove', this.onSteerMove);
      wheel.addEventListener('pointerup', this.onSteerUp);
      wheel.addEventListener('pointercancel', this.onSteerUp);
      wheel.addEventListener('lostpointercapture', this.onSteerUp);
    } else {
      wheel.append(
        this.pedal('toque-seta', '◀', 'Virar à esquerda', 'left'),
        this.pedal('toque-seta', '▶', 'Virar à direita', 'right'),
      );
    }

    const pedals = document.createElement('div');
    pedals.className = 'toque-pedais';
    pedals.append(
      this.pedal('toque-pequeno', '↺', 'Olhar para trás', 'lookBack'),
      this.pedal('toque-drift', 'Drift', 'Drift', 'drift'),
      this.pedal(
        'toque-freio',
        options.autoAccel ? 'Freio / ré' : 'Freio',
        'Frear e dar ré',
        'brake',
      ),
    );
    if (!options.autoAccel) {
      pedals.append(this.pedal('toque-acelerar', 'Acelerar', 'Acelerar', 'throttle'));
    }

    const top = document.createElement('div');
    top.className = 'toque-topo';
    for (const extra of options.extras ?? []) {
      const node = button('toque-extra', extra.label, extra.title);
      node.addEventListener('click', extra.run);
      top.append(node);
    }
    if ('requestFullscreen' in document.documentElement) {
      const full = button('toque-extra', '⛶', 'Tela cheia');
      full.addEventListener('click', () => void toggleFullscreen());
      top.append(full);
    }

    root.append(wheel, pedals, top);
    root.addEventListener('contextmenu', (event) => event.preventDefault());
    document.body.append(root);
    this.root = root;

    // Comando preso nunca: soltou a aba, girou o aparelho ou perdeu o foco, solta tudo.
    document.addEventListener('visibilitychange', this.releaseAll);
    window.addEventListener('blur', this.releaseAll);
    window.addEventListener(ROTATE_EVENT, this.releaseAll);
  }

  private pedal(className: string, label: string, title: string, action: Pedal): HTMLButtonElement {
    const node = button(`toque-botao ${className}`, label, title);
    node.dataset.acao = action;
    node.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      node.setPointerCapture(event.pointerId);
      this.held.set(event.pointerId, action);
      node.dataset.ativo = 'true';
      this.onTouched();
      buzz();
    });
    const release = (event: PointerEvent): void => {
      this.held.delete(event.pointerId);
      if (!this.has(action)) delete node.dataset.ativo;
    };
    node.addEventListener('pointerup', release);
    node.addEventListener('pointercancel', release);
    node.addEventListener('lostpointercapture', release);
    return node;
  }

  private readonly onSteerDown = (event: PointerEvent): void => {
    if (this.steerPointer !== null) return;
    event.preventDefault();
    const zone = event.currentTarget as HTMLElement;
    zone.setPointerCapture(event.pointerId);
    this.steerPointer = event.pointerId;
    this.originX = event.clientX;
    // O volante nasce onde o dedo encostou.
    if (this.base) {
      const box = zone.getBoundingClientRect();
      this.base.style.left = `${event.clientX - box.left}px`;
      this.base.style.top = `${event.clientY - box.top}px`;
      this.base.dataset.ativo = 'true';
    }
    this.setSteer(0, 0);
    this.onTouched();
  };

  private readonly onSteerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.steerPointer) return;
    const dx = event.clientX - this.originX;
    this.setSteer(dragSteer(dx), Math.max(-STEER_RADIUS, Math.min(STEER_RADIUS, dx)));
  };

  private readonly onSteerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.steerPointer) return;
    this.steerPointer = null;
    this.setSteer(0, 0);
    if (this.base) delete this.base.dataset.ativo;
  };

  private setSteer(value: number, knobX: number): void {
    this.steerValue = value;
    if (this.knob) this.knob.style.transform = knobX ? `translateX(${knobX}px)` : '';
  }

  private has(action: Pedal): boolean {
    for (const held of this.held.values()) if (held === action) return true;
    return false;
  }

  read(started = true): { raw: RawInput; lookBack: boolean } {
    const steer =
      this.options.steer === 'arrastar'
        ? this.steerValue
        : (this.has('left') ? 1 : 0) - (this.has('right') ? 1 : 0);
    const pedals = touchPedals(
      { throttle: this.has('throttle'), brake: this.has('brake') },
      this.options.autoAccel && started,
    );
    return {
      raw: { steer, ...pedals, drift: this.has('drift') },
      lookBack: this.has('lookBack'),
    };
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  setVisible(visible: boolean): void {
    if (this.root.hidden === !visible) return;
    this.root.hidden = !visible;
    if (!visible) this.releaseAll();
  }

  /** Solta todos os comandos (o kart não segue acelerando nem virando sozinho). */
  readonly releaseAll = (): void => {
    this.held.clear();
    this.steerPointer = null;
    this.setSteer(0, 0);
    for (const node of this.root.querySelectorAll<HTMLElement>('[data-ativo]')) {
      delete node.dataset.ativo;
    }
  };

  dispose(): void {
    document.removeEventListener('visibilitychange', this.releaseAll);
    window.removeEventListener('blur', this.releaseAll);
    window.removeEventListener(ROTATE_EVENT, this.releaseAll);
    this.root.remove();
  }
}
