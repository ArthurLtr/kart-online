import { BufferAttribute, BufferGeometry } from 'three';
import type { Track } from '@kart/shared';
import { pointAt, pointAtSample } from '@kart/shared';

/** Ponto do perfil transversal: [distância lateral d, elevação acima do terreno]. */
export type ProfilePoint = readonly [d: number, lift: number];

export interface RibbonOptions {
  /** Primeira amostra da pista (pode ser negativa; dá a volta). */
  from: number;
  /** Quantidade de fileiras de vértices ao longo da pista. */
  rows: number;
  /** Amostras puladas entre fileiras (1 = cada metro). */
  stride?: number;
  /**
   * Perfil transversal de cada fileira, com `d` crescente (da esquerda para a
   * direita) e sempre a mesma quantidade de pontos.
   */
  profile: (sampleIndex: number, row: number) => readonly ProfilePoint[];
  /**
   * 'world': UV em metros / `tile` (texturas que repetem no chão).
   * 'across': U de 0 a 1 atravessando a faixa, V em metros / largura.
   */
  uv?: 'world' | 'across';
  tile?: number;
}

/**
 * Faixa de malha que acompanha a pista (asfalto, linhas, grama, guard-rail…).
 * Segue o banking e o relevo do terreno; normais para cima.
 */
export function ribbonGeometry(track: Track, options: RibbonOptions): BufferGeometry {
  const { from, rows, profile } = options;
  const stride = options.stride ?? 1;
  const tile = options.tile ?? 4;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let columns = 0;

  for (let row = 0; row < rows; row++) {
    const sampleIndex = from + row * stride;
    const points = profile(sampleIndex, row);
    columns = points.length;
    const first = (points[0] as ProfilePoint)[0];
    const span = (points[columns - 1] as ProfilePoint)[0] - first || 1;
    const along = sampleIndex * track.step;
    for (const [d, lift] of points) {
      const p = pointAtSample(track, sampleIndex, d);
      positions.push(p.x, p.y + lift, p.z);
      if (options.uv === 'across') uvs.push((d - first) / span, along / span);
      else uvs.push(d / tile, along / tile);
    }
  }

  for (let row = 0; row < rows - 1; row++) {
    for (let column = 0; column < columns - 1; column++) {
      const a = row * columns + column;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Faixa que dá a volta completa na pista. */
export function loopRibbon(
  track: Track,
  profile: RibbonOptions['profile'],
  options: Partial<RibbonOptions> = {},
): BufferGeometry {
  const stride = options.stride ?? 2;
  const rows = Math.ceil(track.samples.length / stride) + 1;
  return ribbonGeometry(track, { from: 0, rows, stride, profile, ...options });
}

/** Retângulo pintado no chão entre (s0, d0) e (s1, d1), acompanhando o relevo. */
export function groundQuad(
  track: Track,
  s0: number,
  s1: number,
  d0: number,
  d1: number,
  lift = 0.02,
): BufferGeometry {
  const corners = [
    pointAt(track, s0, d0),
    pointAt(track, s0, d1),
    pointAt(track, s1, d0),
    pointAt(track, s1, d1),
  ];
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(corners.flatMap((p) => [p.x, p.y + lift, p.z])), 3),
  );
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2));
  geometry.setIndex([0, 1, 2, 1, 3, 2]);
  geometry.computeVertexNormals();
  return geometry;
}
