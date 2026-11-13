import { quality } from '../settings';
import { NoToneMapping, PCFSoftShadowMap, SRGBColorSpace, WebGLRenderer } from 'three';

export function createRenderer(canvas: HTMLCanvasElement): WebGLRenderer {
  const renderer = new WebGLRenderer({
    canvas,
    // O antialias fica por conta do SMAA no pós-processamento.
    antialias: false,
    stencil: false,
    depth: false,
    powerPreference: 'high-performance',
  });
  applyRendererQuality(renderer);
  renderer.outputColorSpace = SRGBColorSpace;
  // O tone mapping ACES é aplicado no fim da cadeia de pós-processamento.
  renderer.toneMapping = NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  return renderer;
}

/** Resolução de renderização do preset gráfico atual. */
export function applyRendererQuality(renderer: WebGLRenderer): void {
  const preset = quality();
  // No Baixo renderiza abaixo da resolução da tela, mesmo em monitores comuns.
  const ratio =
    preset.pixelRatio < 1
      ? preset.pixelRatio
      : Math.min(window.devicePixelRatio, preset.pixelRatio);
  renderer.setPixelRatio(ratio);
}
