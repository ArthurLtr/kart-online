import type { RawInput } from '@kart/shared';
import type { TouchSize } from '../settings';
import { MOBILE_STEER_ATTACK_RATE, MOBILE_STEER_RELEASE_RATE } from '../settings';
import { ROTATE_EVENT, toggleFullscreen } from '../ui/mobile';

/** Botão extra da tela (recomeçar, menu…), além dos comandos do kart. */
export interface TouchExtra {
  label: string;
  /** Texto para o leitor de tela. */
  title: string;
  run: () => void;
}

export interface MobileArcadeOptions {
  size: TouchSize;
  /** Canhotos: pedais à esquerda e setas à direita. */
  swap: boolean;
  extras?: readonly TouchExtra[];
}

type Pedal = 'throttle' | 'brake' | 'drift' | 'lookBack';
type Arrow = -1 | 0 | 1;

/**
 * Rampa da direção: as setas são liga/desliga, mas o volante gira rápido e
 * não aos trancos. Vai ao alvo na taxa de ataque e volta ao centro (ou cruza
 * para o outro lado) na taxa de retorno, mais rápida. Taxas em cursos/segundo.
 */
export function rampSteer(
  current: number,
  target: number,
  dt: number,
  attack = MOBILE_STEER_ATTACK_RATE,
  release = MOBILE_STEER_RELEASE_RATE,
): number {
  if (!(dt > 0)) return current;
  let value = current;
  let time = dt;
  // Soltou, ou trocou de lado: primeiro volta ao centro na taxa de retorno.
  if (target === 0 || value * target < 0) {
    const toCenter = Math.abs(value) / release;
    if (toCenter >= time) return value - Math.sign(value) * release * time;
    value = 0;
    time -= toCenter;
    if (target === 0) return 0;
  }
  // Mesmo lado (ou do centro): vai ao alvo na taxa de ataque, com o tempo que sobrou.
  const step = attack * time;
  const diff = target - value;
  return Math.abs(diff) <= step ? target : value + Math.sign(diff) * step;
}

/**
 * Qual seta está sob o dedo. Entre as duas, vale a mais próxima; assim o
 * polegar desliza de uma para a outra sem levantar e sem "zona morta".
 * Devolve +1 (esquerda, como na simulação) ou -1 (direita).
 */
export function arrowAt(x: number, left: DOMRectReadOnly, right: DOMRectReadOnly): Arrow {
  const leftCenter = left.left + left.width / 2;
  const rightCenter = right.left + right.width / 2;
  return Math.abs(x - leftCenter) <= Math.abs(x - rightCenter) ? 1 : -1;
}

function button(className: string, label: string, title: string): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  node.setAttribute('aria-label', title);
  node.append(label);
  return node;
}

const buzz = (): void => {
  try {
    navigator.vibrate?.(12);
  } catch {
    // Sem vibração: segue normal.
  }
};

/**
 * Controles de corrida no celular, no estilo dos jogos de direção mobile:
 * setas ← → no canto esquerdo (o polegar desliza entre elas sem levantar) e
 * pedais no direito, freio/ré menor ao lado do acelerador grande, drift acima,
 * no arco do polegar. Multitoque: cada dedo segura a sua ação.
 */
export class MobileArcadeControls {
  readonly root: HTMLElement;
  private readonly held = new Map<number, Pedal>();
  private steerPointer: number | null = null;
  private arrow: Arrow = 0;
  private steer = 0;
  private lastRead = performance.now();
  private readonly left: HTMLButtonElement;
  private readonly right: HTMLButtonElement;

  constructor(
    options: MobileArcadeOptions,
    private readonly onTouched: () => void,
  ) {
    const root = document.createElement('div');
    root.className = 'toque-controles';
    root.dataset.tamanho = options.size;
    root.dataset.invertido = String(options.swap);
    root.hidden = true;

    const arrows = document.createElement('div');
    arrows.className = 'toque-setas';
    arrows.setAttribute('role', 'group');
    arrows.setAttribute('aria-label', 'Direção');
    this.left = button('toque-botao toque-seta', '◀', 'Virar à esquerda');
    this.right = button('toque-botao toque-seta', '▶', 'Virar à direita');
    arrows.append(this.left, this.right);
    // A captura fica no grupo das setas: o mesmo dedo pode passar de uma para a outra.
    arrows.addEventListener('pointerdown', this.onArrowDown);
    arrows.addEventListener('pointermove', this.onArrowMove);
    arrows.addEventListener('pointerup', this.onArrowUp);
    arrows.addEventListener('pointercancel', this.onArrowUp);
    arrows.addEventListener('lostpointercapture', this.onArrowUp);

    const pedals = document.createElement('div');
    pedals.className = 'toque-pedais';
    pedals.append(
      this.pedal('toque-pequeno', '↺', 'Olhar para trás', 'lookBack'),
      this.pedal('toque-drift', 'Drift', 'Drift', 'drift'),
      this.pedal('toque-freio', 'Freio\nRé', 'Frear e dar ré', 'brake'),
      this.pedal('toque-acelerar', 'Acelerar', 'Acelerar', 'throttle'),
    );

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

    root.append(arrows, pedals, top);
    root.addEventListener('contextmenu', (event) => event.preventDefault());
    document.body.append(root);
    this.root = root;

    // Botão preso nunca: aba escondida, janela sem foco ou aparelho girado soltam tudo.
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
      node.classList.add('is-pressed');
      this.onTouched();
      buzz();
    });
    const release = (event: PointerEvent): void => {
      this.held.delete(event.pointerId);
      if (!this.has(action)) node.classList.remove('is-pressed');
    };
    node.addEventListener('pointerup', release);
    node.addEventListener('pointercancel', release);
    node.addEventListener('lostpointercapture', release);
    return node;
  }

  private readonly onArrowDown = (event: PointerEvent): void => {
    if (this.steerPointer !== null) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.steerPointer = event.pointerId;
    this.setArrow(this.pick(event.clientX));
    this.onTouched();
    buzz();
  };

  private readonly onArrowMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.steerPointer) return;
    const next = this.pick(event.clientX);
    if (next !== this.arrow) {
      this.setArrow(next);
      buzz();
    }
  };

  private readonly onArrowUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.steerPointer) return;
    this.steerPointer = null;
    this.setArrow(0);
  };

  private pick(x: number): Arrow {
    return arrowAt(x, this.left.getBoundingClientRect(), this.right.getBoundingClientRect());
  }

  private setArrow(arrow: Arrow): void {
    this.arrow = arrow;
    this.left.classList.toggle('is-pressed', arrow === 1);
    this.right.classList.toggle('is-pressed', arrow === -1);
  }

  private has(action: Pedal): boolean {
    for (const held of this.held.values()) if (held === action) return true;
    return false;
  }

  /** Comandos de agora; a direção anda pela rampa desde a leitura anterior. */
  read(): { raw: RawInput; lookBack: boolean } {
    const now = performance.now();
    // Leituras no mesmo quadro (simulação e câmera) não aceleram a rampa; pausa longa não dá salto.
    const dt = Math.min(0.1, (now - this.lastRead) / 1000);
    this.lastRead = now;
    this.steer = rampSteer(this.steer, this.arrow, dt);
    return {
      raw: {
        steer: this.steer,
        throttle: this.has('throttle') ? 1 : 0,
        brake: this.has('brake') ? 1 : 0,
        drift: this.has('drift'),
      },
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
    this.steer = 0;
    this.setArrow(0);
    for (const node of this.root.querySelectorAll('.is-pressed'))
      node.classList.remove('is-pressed');
  };

  dispose(): void {
    document.removeEventListener('visibilitychange', this.releaseAll);
    window.removeEventListener('blur', this.releaseAll);
    window.removeEventListener(ROTATE_EVENT, this.releaseAll);
    this.root.remove();
  }
}
