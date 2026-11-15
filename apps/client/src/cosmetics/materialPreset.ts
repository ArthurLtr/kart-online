import type { MeshStandardMaterial, Texture } from 'three';
import { Color } from 'three';
import type { MaterialPreset } from './catalog';

interface Baseline {
  metalness: number;
  roughness: number;
  emissive: number;
  emissiveIntensity: number;
  emissiveMap: Texture | null;
}

/**
 * Aplica o material de um item da temporada (metal, rugosidade e brilho).
 * Guarda os valores originais do material na primeira vez, para que trocar
 * para um item comum (sem preset) volte exatamente ao que era.
 * O brilho usa a própria textura como máscara: só as partes claras acendem
 * (no aro, o metal brilha e o pneu preto continua escuro).
 */
export function applyMaterialPreset(
  material: MeshStandardMaterial,
  preset: MaterialPreset | undefined,
): void {
  let base = material.userData.presetBase as Baseline | undefined;
  if (!base) {
    if (!preset) return;
    base = {
      metalness: material.metalness,
      roughness: material.roughness,
      emissive: material.emissive.getHex(),
      emissiveIntensity: material.emissiveIntensity,
      emissiveMap: material.emissiveMap,
    };
    material.userData.presetBase = base;
  }
  material.metalness = preset?.metalness ?? base.metalness;
  material.roughness = preset?.roughness ?? base.roughness;
  if (preset?.emissive) {
    material.emissive = new Color(preset.emissive);
    material.emissiveIntensity = preset.emissiveIntensity ?? 1;
    material.emissiveMap = material.map ?? base.emissiveMap;
  } else {
    material.emissive.setHex(base.emissive);
    material.emissiveIntensity = base.emissiveIntensity;
    material.emissiveMap = base.emissiveMap;
  }
  material.needsUpdate = true;
}
