import type { Vector3 } from 'three';
import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry } from 'three';

const vertexShader = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    // Só a rotação da câmera: o céu fica sempre centrado no observador.
    vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
    gl_Position = clip.xyww; // sempre no plano mais distante
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunColor;
  uniform vec3 uSunDirection;
  varying vec3 vDirection;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 5; i++) {
      value += amplitude * noise(p);
      p = p * 2.03 + vec2(17.0, 9.0);
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    vec3 dir = normalize(vDirection);
    float h = dir.y;
    vec3 sky = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.5));
    float sunAmount = max(dot(dir, uSunDirection), 0.0);
    sky += uSunColor * pow(sunAmount, 6.0) * 0.45; // clarão em volta do sol

    // Nuvens: ruído projetado num plano alto, iluminadas pelo lado do sol.
    if (h > 0.01) {
      vec2 plane = dir.xz / (h + 0.12);
      float density = fbm(plane * 1.3 + vec2(uTime * 0.006, 0.0));
      float cover = smoothstep(0.52, 0.78, density) * smoothstep(0.01, 0.16, h);
      vec3 lit = mix(vec3(0.72, 0.68, 0.74), uSunColor * 1.25, pow(sunAmount, 2.0) * 0.8 + 0.2);
      sky = mix(sky, lit, cover * 0.85);
    }

    vec3 color = mix(uGround, sky, smoothstep(-0.03, 0.01, h));
    color += uSunColor * pow(sunAmount, 1400.0) * 8.0; // disco do sol (HDR, entra no bloom)

    gl_FragColor = vec4(color, 1.0);
  }
`;

export interface Sky {
  mesh: Mesh;
  update(timeSeconds: number): void;
}

/** Céu de fim de tarde em gradiente, com nuvens e o sol na direção da luz direcional. */
export function createSky(sunDirection: Vector3): Sky {
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    side: BackSide,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uZenith: { value: new Color(0x3466a8) },
      uHorizon: { value: new Color(0xf7c08e) },
      uGround: { value: new Color(0x8a7f72) },
      uSunColor: { value: new Color(0xffd3a0) },
      uSunDirection: { value: sunDirection.clone() },
    },
  });
  const mesh = new Mesh(new SphereGeometry(1, 48, 24), material);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return {
    mesh,
    update(timeSeconds) {
      (material.uniforms.uTime as { value: number }).value = timeSeconds;
    },
  };
}
