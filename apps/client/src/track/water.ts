import type { Vector3 } from 'three';
import { Color, Mesh, PlaneGeometry, ShaderMaterial } from 'three';
import { SEA_Z } from './surface';

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uShore;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uSky;
  varying vec3 vWorld;

  // Inclinação da superfície pela soma de ondas senoidais em direções diferentes.
  vec2 slope(vec2 p, float t) {
    vec2 s = vec2(0.0);
    s += vec2(0.80, 0.60) * cos(dot(p, vec2(0.80, 0.60)) * 0.35 + t * 1.1) * 0.10;
    s += vec2(-0.50, 0.87) * cos(dot(p, vec2(-0.50, 0.87)) * 0.62 + t * 1.5) * 0.07;
    s += vec2(0.20, -0.98) * cos(dot(p, vec2(0.20, -0.98)) * 1.30 + t * 2.1) * 0.05;
    s += vec2(0.95, 0.30) * cos(dot(p, vec2(0.95, 0.30)) * 2.70 + t * 2.8) * 0.03;
    return s;
  }

  void main() {
    vec2 s = slope(vWorld.xz, uTime);
    vec3 normal = normalize(vec3(-s.x, 1.0, -s.y));
    vec3 view = normalize(cameraPosition - vWorld);

    float offshore = clamp((uShore - vWorld.z) / 500.0, 0.0, 1.0);
    vec3 color = mix(uShallow, uDeep, smoothstep(0.0, 0.5, offshore));

    float fresnel = pow(1.0 - max(dot(normal, view), 0.0), 4.0);
    color = mix(color, uSky, fresnel * 0.75);

    // Reflexo do sol poente (HDR: os brilhos mais fortes entram no bloom).
    float glint = pow(max(dot(reflect(-view, normal), uSunDirection), 0.0), 180.0);
    color += uSunColor * glint * 4.0;

    // Espuma na arrebentação.
    float edge = uShore - vWorld.z;
    float foam = smoothstep(7.0, 0.0, edge + sin(uTime * 0.9 + vWorld.x * 0.08) * 2.0);
    color = mix(color, vec3(0.95), foam * 0.7);

    gl_FragColor = vec4(color, 1.0);
  }
`;

export interface Water {
  mesh: Mesh;
  update(timeSeconds: number): void;
}

/** Mar ao fundo, do lado -Z da pista, com ondas, reflexo do sol e espuma. */
export function createWater(sunDirection: Vector3): Water {
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uShore: { value: SEA_Z + 4 },
      uSunDirection: { value: sunDirection.clone() },
      uSunColor: { value: new Color(0xffc98a) },
      uDeep: { value: new Color(0x0b3a5c) },
      uShallow: { value: new Color(0x2f8f9d) },
      uSky: { value: new Color(0xf0b98a) },
    },
  });
  const depth = 2400;
  const mesh = new Mesh(
    new PlaneGeometry(4000, depth).rotateX(-Math.PI / 2).translate(0, -0.7, SEA_Z + 12 - depth / 2),
    material,
  );
  mesh.name = 'sea';
  return {
    mesh,
    update(timeSeconds) {
      (material.uniforms.uTime as { value: number }).value = timeSeconds;
    },
  };
}
