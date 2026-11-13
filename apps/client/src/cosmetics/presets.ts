import type { PresetData } from '@kart/shared';
import { MAX_PRESETS, sanitizePresetName } from '@kart/shared';
import type { Loadout } from './catalog';
import { normalizeLoadout } from './catalog';
import type { KartPaint } from './paint';
import { sanitizePaint } from './paint';

/** Visual completo (itens do catálogo + pintura livre) guardado com um nome. */
export interface Preset {
  name: string;
  loadout: Loadout;
  paint: KartPaint | null;
}

/** Lê presets de qualquer origem (navegador ou conta), conferindo cada campo. */
export function toPresets(value: unknown): Preset[] {
  if (!Array.isArray(value)) return [];
  const presets: Preset[] = [];
  for (const raw of value.slice(0, MAX_PRESETS)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    presets.push({
      name: sanitizePresetName(entry.name),
      loadout: normalizeLoadout(entry.loadout),
      paint: sanitizePaint(entry.paint),
    });
  }
  return presets;
}

/** Formato que vai para a conta. */
export const presetsData = (presets: readonly Preset[]): PresetData[] =>
  presets.map((preset) => ({
    name: preset.name,
    loadout: { ...preset.loadout },
    paint: preset.paint as PresetData['paint'],
  }));

const STORAGE_KEY = 'kart-online.presets';

export function loadPresets(): Preset[] {
  try {
    return toPresets(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'));
  } catch {
    return [];
  }
}

export function savePresets(presets: readonly Preset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Sem armazenamento: os presets valem só nesta sessão.
  }
}
