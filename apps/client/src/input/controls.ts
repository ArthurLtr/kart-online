import type { AssistSettings, RawInput } from '@kart/shared';
import { GAMEPAD_ASSISTS, KEYBOARD_ASSISTS, TOUCH_ASSISTS } from '@kart/shared';
import type { Action, KeyMap } from '../settings';
import { getSettings } from '../settings';
import { isTouchDevice } from '../ui/mobile';
import type { TouchExtra } from './touch';
import { TouchControls } from './touch';

/** Botões do gamepad no layout padrão (Gamepad API "standard"). */
const PAD = { drift: 0, lookBack: 5, brake: 6, throttle: 7 } as const;
const DEADZONE = 0.12;

export interface ControlState {
  raw: RawInput;
  lookBack: boolean;
  device: Device;
  /** Assistências adequadas ao dispositivo em uso. */
  assists: AssistSettings;
}

type Device = 'keyboard' | 'gamepad' | 'touch';

export interface ControlsOptions {
  keys?: KeyMap;
  /** Botões extras da tela de toque (recomeçar, menu…). */
  touchExtras?: readonly TouchExtra[];
}

/**
 * Lê teclado, gamepad e (no celular) os controles de toque e entrega o que o
 * jogador está pedindo agora. Vale o último dispositivo usado.
 */
export class Controls {
  private readonly down = new Set<string>();
  private readonly gameKeys: Set<string>;
  private readonly keys: KeyMap;
  private readonly touch: TouchControls | null;
  private device: Device;

  constructor(options: ControlsOptions = {}) {
    this.keys = options.keys ?? getSettings().keys;
    this.gameKeys = new Set(Object.values(this.keys).flat());
    const settings = getSettings();
    this.touch = isTouchDevice()
      ? new TouchControls(
          {
            steer: settings.touchSteer,
            autoAccel: settings.touchAutoAccel,
            size: settings.touchSize,
            swap: settings.touchSwap,
            extras: options.touchExtras ?? [],
          },
          () => {
            this.device = 'touch';
          },
        )
      : null;
    this.device = this.touch ? 'touch' : 'keyboard';
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

  /**
   * `started`: a largada já foi dada. Antes do verde a aceleração automática
   * do toque fica parada, senão o kart queima a largada sozinho.
   */
  read(started = true): ControlState {
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
    if (this.device === 'touch' && this.touch) {
      const { raw, lookBack } = this.touch.visible
        ? this.touch.read(started)
        : { raw: { steer: 0, throttle: 0, brake: 0, drift: false }, lookBack: false };
      return {
        raw,
        lookBack,
        device: 'touch',
        // Arrastar é analógico; com botões a direção é digital como no teclado.
        assists: getSettings().touchSteer === 'arrastar' ? TOUCH_ASSISTS : KEYBOARD_ASSISTS,
      };
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

  /** Controles de toque na tela (só existem no celular): mostrar na corrida, esconder fora dela. */
  setTouchVisible(visible: boolean): void {
    this.touch?.setVisible(visible);
  }

  /** Há controles de toque (aparelho de toque). */
  get hasTouch(): boolean {
    return this.touch !== null;
  }

  dispose(): void {
    this.touch?.dispose();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
