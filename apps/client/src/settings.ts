/** Preferências do jogador (gráficos, áudio e teclas), guardadas no navegador. */

export type Action = 'throttle' | 'brake' | 'left' | 'right' | 'drift' | 'lookBack';
export type KeyMap = Record<Action, readonly string[]>;

export const ACTIONS: readonly { action: Action; label: string }[] = [
  { action: 'throttle', label: 'Acelerar' },
  { action: 'brake', label: 'Frear / ré' },
  { action: 'left', label: 'Virar à esquerda' },
  { action: 'right', label: 'Virar à direita' },
  { action: 'drift', label: 'Drift' },
  { action: 'lookBack', label: 'Olhar para trás' },
];

/** Teclas padrão de cada ação (KeyboardEvent.code). */
export const DEFAULT_KEYS: KeyMap = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  drift: ['Space'],
  lookBack: ['ShiftLeft', 'ShiftRight'],
};

export const QUALITY_NAMES = ['baixo', 'medio', 'alto', 'ultra'] as const;
export type Quality = (typeof QUALITY_NAMES)[number];

export interface QualityPreset {
  label: string;
  /** Lado do mapa de sombra em pixels; 0 desliga as sombras. */
  shadowMap: number;
  /** Peças de kart adversário menores que isto (raio, m) não projetam sombra. */
  shadowMinRadius: number;
  /** 'basico' só faz o tone mapping; 'completo' soma bloom, vinheta, borrão e SMAA. */
  postfx: 'basico' | 'completo';
  /** Fração de árvores, postes e torcida que entra em cena. */
  scenery: number;
  /** Teto da resolução de renderização (multiplica os pixels CSS). */
  pixelRatio: number;
}

export const QUALITY: Record<Quality, QualityPreset> = {
  baixo: {
    label: 'Baixo',
    shadowMap: 0,
    shadowMinRadius: Infinity,
    postfx: 'basico',
    scenery: 0.4,
    pixelRatio: 0.75,
  },
  medio: {
    label: 'Médio',
    shadowMap: 1024,
    shadowMinRadius: 0.3,
    postfx: 'completo',
    scenery: 0.7,
    pixelRatio: 1,
  },
  alto: {
    label: 'Alto',
    shadowMap: 2048,
    shadowMinRadius: 0.18,
    postfx: 'completo',
    scenery: 1,
    pixelRatio: 1.5,
  },
  ultra: {
    label: 'Ultra',
    shadowMap: 4096,
    shadowMinRadius: 0.1,
    postfx: 'completo',
    scenery: 1,
    pixelRatio: 2,
  },
};

export interface Settings {
  quality: Quality;
  /** Volume geral, 0 a 1. */
  volume: number;
  music: boolean;
  motionBlur: boolean;
  nameTags: boolean;
  keys: KeyMap;
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'medio',
  volume: 0.8,
  music: true,
  motionBlur: true,
  nameTags: true,
  keys: DEFAULT_KEYS,
};

const STORAGE_KEY = 'kart-online.config';

/** Aceita qualquer coisa vinda do armazenamento e devolve preferências válidas. */
export function sanitizeSettings(value: unknown): Settings {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const rawKeys = (typeof raw.keys === 'object' && raw.keys !== null ? raw.keys : {}) as Record<
    string,
    unknown
  >;
  const keys = {} as Record<Action, readonly string[]>;
  for (const { action } of ACTIONS) {
    const codes = rawKeys[action];
    const valid = Array.isArray(codes)
      ? codes.filter((code): code is string => typeof code === 'string' && code.length > 0)
      : [];
    keys[action] = valid.length > 0 ? valid.slice(0, 2) : DEFAULT_KEYS[action];
  }
  const flag = (name: keyof Settings): boolean =>
    typeof raw[name] === 'boolean' ? raw[name] : (DEFAULT_SETTINGS[name] as boolean);
  return {
    quality: QUALITY_NAMES.includes(raw.quality as Quality)
      ? (raw.quality as Quality)
      : DEFAULT_SETTINGS.quality,
    volume:
      typeof raw.volume === 'number' && Number.isFinite(raw.volume)
        ? Math.min(1, Math.max(0, raw.volume))
        : DEFAULT_SETTINGS.volume,
    music: flag('music'),
    motionBlur: flag('motionBlur'),
    nameTags: flag('nameTags'),
    keys,
  };
}

/**
 * Troca a tecla de uma ação. A tecla sai de qualquer outra ação que a usava,
 * para nunca ficarem duas ações no mesmo botão.
 */
export function remapKey(keys: KeyMap, action: Action, index: 0 | 1, code: string): KeyMap {
  const own = keys[action].filter((existing) => existing !== code);
  const slot = Math.min(index, own.length);
  const displaced = own[slot];
  own[slot] = code;
  const result = { ...keys, [action]: own } as Record<Action, readonly string[]>;
  const used = new Set(ACTIONS.flatMap((entry) => result[entry.action]));
  for (const { action: other } of ACTIONS) {
    if (other === action) continue;
    const codes = keys[other].filter((existing) => existing !== code);
    if (codes.length === 0) {
      // Ficou sem tecla: herda a que a ação remapeada largou, ou uma padrão livre.
      const spare = [displaced, ...DEFAULT_KEYS[other], ...Object.values(DEFAULT_KEYS).flat()].find(
        (candidate) => candidate !== undefined && !used.has(candidate),
      );
      if (spare) {
        codes.push(spare);
        used.add(spare);
      }
    }
    result[other] = codes;
  }
  return result;
}

/** Sugere um preset pelo nome da GPU informado pelo navegador. */
export function suggestQuality(gpuName: string, cores: number): Quality {
  const gpu = gpuName.toLowerCase();
  if (/swiftshader|llvmpipe|software|basic render/.test(gpu)) return 'baixo';
  if (/rtx|radeon rx|arc\(tm\) a\d|apple m\d|geforce gtx 1[06-9]|rx \d{4}/.test(gpu)) return 'alto';
  if (/intel|uhd|iris|hd graphics|mali|adreno|powervr|vega/.test(gpu)) {
    return /iris\(r\) xe|iris xe|arc/.test(gpu) && cores >= 8 ? 'medio' : 'baixo';
  }
  return cores >= 8 ? 'medio' : 'baixo';
}

/** Nome da GPU via WEBGL_debug_renderer_info ('' se o navegador esconder). */
export function gpuName(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name: unknown = gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
  return typeof name === 'string' ? name : '';
}

/** Nome legível de uma tecla ("KeyW" → "W"). */
export function keyLabel(code: string): string {
  const names: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Space: 'Espaço',
    ShiftLeft: 'Shift esq.',
    ShiftRight: 'Shift dir.',
    ControlLeft: 'Ctrl esq.',
    ControlRight: 'Ctrl dir.',
    AltLeft: 'Alt esq.',
    AltRight: 'Alt dir.',
    Enter: 'Enter',
  };
  return names[code] ?? code.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'Num ');
}

let current: Settings | undefined;
/** `true` enquanto o jogador nunca escolheu a qualidade (vale a sugestão pela GPU). */
let untouched = true;
const listeners = new Set<(settings: Settings) => void>();

export function getSettings(): Settings {
  if (!current) {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      untouched = stored === null;
      current = sanitizeSettings(stored ? (JSON.parse(stored) as unknown) : null);
    } catch {
      current = sanitizeSettings(null);
    }
  }
  return current;
}

export function isFirstRun(): boolean {
  getSettings();
  return untouched;
}

export function quality(): QualityPreset {
  return QUALITY[getSettings().quality];
}

export function updateSettings(patch: Partial<Settings>, persist = true): Settings {
  current = sanitizeSettings({ ...getSettings(), ...patch });
  if (persist) {
    untouched = false;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
      // Sem armazenamento: as preferências valem só nesta sessão.
    }
  }
  for (const listener of listeners) listener(current);
  return current;
}

export function onSettingsChange(listener: (settings: Settings) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
