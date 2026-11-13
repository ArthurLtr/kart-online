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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  // O tone mapping ACES é aplicado no fim da cadeia de pós-processamento.
  renderer.toneMapping = NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  return renderer;
}
