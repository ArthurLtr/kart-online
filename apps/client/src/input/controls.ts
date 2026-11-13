import type { AssistSettings, RawInput } from '@kart/shared';
import { GAMEPAD_ASSISTS, KEYBOARD_ASSISTS } from '@kart/shared';

export type Action = 'throttle' | 'brake' | 'left' | 'right' | 'drift' | 'lookBack';

/** Teclas de cada ação (KeyboardEvent.code). O remapeamento pela interface entra na etapa 7. */
export const DEFAULT_KEYS: Record<Action, readonly string[]> = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  drift: ['Space'],
  lookBack: ['ShiftLeft', 'ShiftRight'],
};

/** Botões do gamepad no layout padrão (Gamepad API "standard"). */
const PAD = { drift: 0, lookBack: 5, brake: 6, throttle: 7 } as const;
const DEADZONE = 0.12;

export interface ControlState {
  raw: RawInput;
  lookBack: boolean;
  device: 'keyboard' | 'gamepad';
  /** Assistências adequadas ao dispositivo em uso. */
  assists: AssistSettings;
}

/** Lê teclado e gamepad e entrega o que o jogador está pedindo agora. */
export class Controls {
  private readonly down = new Set<string>();
  private readonly gameKeys: Set<string>;
  private device: 'keyboard' | 'gamepad' = 'keyboard';

  constructor(private readonly keys: Record<Action, readonly string[]> = DEFAULT_KEYS) {
    this.gameKeys = new Set(Object.values(keys).flat());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.gameKeys.has(event.code)) return;
    // Digitando num campo de texto (apelido, código): as teclas são do campo, não do kart.
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }
    // Espaço e setas não podem rolar a página nem acionar o botão em foco.
    event.preventDefault();
    this.down.add(event.code);
    this.device = 'keyboard';
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.down.delete(event.code);
  };

  /** Perdeu o foco com tecla apertada: solta tudo para o kart não seguir acelerando. */
  private readonly onBlur = (): void => {
    this.down.clear();
  };

  private held(action: Action): boolean {
    return this.keys[action].some((code) => this.down.has(code));
  }

  read(): ControlState {
    const pad = navigator.getGamepads?.().find((candidate) => candidate?.connected) ?? null;
    if (pad) {
      const stick = pad.axes[0] ?? 0;
      const throttle = pad.buttons[PAD.throttle]?.value ?? 0;
      const brake = pad.buttons[PAD.brake]?.value ?? 0;
      const active = Math.abs(stick) > DEADZONE || throttle > 0.05 || brake > 0.05;
      if (active) this.device = 'gamepad';
      if (this.device === 'gamepad') {
        const magnitude = Math.max(0, Math.abs(stick) - DEADZONE) / (1 - DEADZONE);
        return {
          raw: {
            // Analógico para a esquerda é negativo; na simulação esquerda é positivo.
            steer: -Math.sign(stick) * magnitude,
            throttle,
            brake,
            drift: pad.buttons[PAD.drift]?.pressed ?? false,
          },
          lookBack: pad.buttons[PAD.lookBack]?.pressed ?? false,
          device: 'gamepad',
          assists: GAMEPAD_ASSISTS,
        };
      }
    }
    return {
      raw: {
        steer: (this.held('left') ? 1 : 0) - (this.held('right') ? 1 : 0),
        throttle: this.held('throttle') ? 1 : 0,
        brake: this.held('brake') ? 1 : 0,
        drift: this.held('drift'),
      },
      lookBack: this.held('lookBack'),
      device: 'keyboard',
      assists: KEYBOARD_ASSISTS,
    };
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
