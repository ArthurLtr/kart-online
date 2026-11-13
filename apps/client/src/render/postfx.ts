import type { Camera, Scene, WebGLRenderer } from 'three';
import { HalfFloatType, Uniform } from 'three';
import {
  BloomEffect,
  Effect,
  EffectAttribute,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';

export interface PostFx {
  render(deltaSeconds: number): void;
  setSize(width: number, height: number): void;
  /** Borrão de velocidade: 0 desliga, 1 é o máximo (velocidade máxima do kart). */
  setMotionBlur(amount: number): void;
  dispose(): void;
}

const speedBlurShader = /* glsl */ `
  uniform float strength;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    // Borra na direção radial, mais forte nas bordas; o centro (o kart) fica nítido.
    vec2 fromCenter = uv - vec2(0.5, 0.46);
    float amount = strength * dot(fromCenter, fromCenter);
    vec4 color = inputColor;
    for (int i = 1; i < 8; i++) {
      color += texture2D(inputBuffer, uv - fromCenter * amount * float(i) / 7.0);
    }
    outputColor = color / 8.0;
  }
`;

/** Motion blur leve e barato: amostras ao longo da direção radial da tela. */
class SpeedBlurEffect extends Effect {
  constructor() {
    super('SpeedBlurEffect', speedBlurShader, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map([['strength', new Uniform(0)]]),
    });
  }

  set strength(value: number) {
    (this.uniforms.get('strength') as Uniform<number>).value = value;
  }
}

/**
 * Cadeia: cena (HDR) → borrão de velocidade → bloom só em emissivos →
 * tone mapping ACES → vinheta → SMAA.
 */
export function createPostFx(renderer: WebGLRenderer, scene: Scene, camera: Camera): PostFx {
  const composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType });
  composer.addPass(new RenderPass(scene, camera));

  const speedBlur = new SpeedBlurEffect();
  const blurPass = new EffectPass(camera, speedBlur);
  blurPass.enabled = false; // só custa quando está em uso
  composer.addPass(blurPass);

  // Limiar acima de 1: só o que emite luz (semáforo, lanternas) passa para o bloom.
  const bloom = new BloomEffect({
    luminanceThreshold: 1.0,
    luminanceSmoothing: 0.1,
    intensity: 0.6,
    mipmapBlur: true,
  });
  const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
  const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.4 });
  const smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });

  composer.addPass(new EffectPass(camera, bloom, toneMapping, vignette));
  composer.addPass(new EffectPass(camera, smaa));

  return {
    render: (deltaSeconds) => composer.render(deltaSeconds),
    setSize: (width, height) => composer.setSize(width, height),
    setMotionBlur(amount) {
      const clamped = Math.min(1, Math.max(0, amount));
      blurPass.enabled = clamped > 0.02;
      speedBlur.strength = clamped * 0.22;
    },
    dispose: () => composer.dispose(),
  };
}
