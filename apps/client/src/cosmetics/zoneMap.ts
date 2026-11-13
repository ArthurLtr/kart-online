/**
 * Mapa de zonas do atlas do kart: para cada pixel da textura, a zona de pintura
 * e o ponto do kart (em metros) que ele cobre. Sai das UVs do modelo, então
 * acompanha qualquer GLB que cumpra o contrato de nomes. Sem dependência de DOM.
 */

/** `blocked` marca peças que não são pintura (rodas): a sangria das zonas não entra nelas. */
export const ZONE = {
  none: 0,
  fairing: 1,
  seat: 2,
  floor: 3,
  details: 4,
  /** Aro e faixa do pneu: saem dos pixels das rodas, não entram no mapa rasterizado. */
  rim: 5,
  tire: 6,
  blocked: 255,
} as const;

type Vec3 = readonly [number, number, number];

export interface ZonePart {
  /** xyz por vértice, no espaço do kart (metros). */
  positions: ArrayLike<number>;
  /** uv por vértice, 0–1, com v=0 na primeira linha da imagem. */
  uvs: ArrayLike<number>;
  indices: ArrayLike<number>;
  /** Zona de cada triângulo. */
  zones: ArrayLike<number>;
}

export interface ZoneMap {
  size: number;
  zone: Uint8Array;
  /** xyz por pixel. */
  position: Float32Array;
  /** Normal da face por pixel, cada eixo de -127 a 127. */
  normal: Int8Array;
}

/**
 * Agrupa os triângulos em peças soltas (ligadas por vértices na mesma posição)
 * e devolve, por triângulo, a zona escolhida para a peça dele.
 */
export function zonesByComponent(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  classify: (min: Vec3, max: Vec3) => number,
): Uint8Array {
  const vertexCount = positions.length / 3;
  const parent = new Int32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) parent[i] = i;
  const find = (start: number): number => {
    let node = start;
    while (parent[node] !== node) {
      parent[node] = parent[parent[node]!]!;
      node = parent[node]!;
    }
    return node;
  };
  // Vértices duplicados nas costuras de UV contam como um só.
  const welded = new Map<string, number>();
  for (let i = 0; i < vertexCount; i++) {
    const key = `${Math.round(positions[i * 3]! * 2000)},${Math.round(positions[i * 3 + 1]! * 2000)},${Math.round(positions[i * 3 + 2]! * 2000)}`;
    const first = welded.get(key);
    if (first === undefined) welded.set(key, i);
    else parent[find(i)] = find(first);
  }
  for (let t = 0; t < indices.length; t += 3) {
    const root = find(indices[t]!);
    parent[find(indices[t + 1]!)] = root;
    parent[find(indices[t + 2]!)] = root;
  }
  const boxes = new Map<number, { min: [number, number, number]; max: [number, number, number] }>();
  for (let i = 0; i < vertexCount; i++) {
    const root = find(i);
    let box = boxes.get(root);
    if (!box) {
      box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      boxes.set(root, box);
    }
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[i * 3 + axis]!;
      if (value < box.min[axis]!) box.min[axis] = value;
      if (value > box.max[axis]!) box.max[axis] = value;
    }
  }
  const zoneOf = new Map<number, number>();
  for (const [root, box] of boxes) zoneOf.set(root, classify(box.min, box.max));
  const zones = new Uint8Array(indices.length / 3);
  for (let t = 0; t < zones.length; t++) zones[t] = zoneOf.get(find(indices[t * 3]!)) ?? 0;
  return zones;
}

/** Zona de uma peça solta do corpo do kart, pelo tamanho dela. */
export function bodyZone(min: Vec3, max: Vec3): number {
  const width = max[0] - min[0];
  const height = max[1] - min[1];
  const length = max[2] - min[2];
  if (height < 0.1 && length > 0.6) return ZONE.floor;
  if (width > 0.5 && height > 0.3) return ZONE.seat;
  return ZONE.details;
}

/** Desenha os triângulos de cada parte no atlas, gravando zona, posição e normal por pixel. */
export function rasterizeZones(parts: readonly ZonePart[], size: number): ZoneMap {
  const zone = new Uint8Array(size * size);
  const position = new Float32Array(size * size * 3);
  const normal = new Int8Array(size * size * 3);
  for (const part of parts) {
    const { positions, uvs, indices, zones } = part;
    for (let t = 0; t < indices.length; t += 3) {
      const id = zones[t / 3]!;
      if (id === 0) continue;
      const a = indices[t]!;
      const b = indices[t + 1]!;
      const c = indices[t + 2]!;
      const ax = uvs[a * 2]! * size;
      const ay = uvs[a * 2 + 1]! * size;
      const bx = uvs[b * 2]! * size;
      const by = uvs[b * 2 + 1]! * size;
      const cx = uvs[c * 2]! * size;
      const cy = uvs[c * 2 + 1]! * size;
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (area === 0) continue;
      // Normal da face (triângulos anti-horários vistos de fora).
      const e1x = positions[b * 3]! - positions[a * 3]!;
      const e1y = positions[b * 3 + 1]! - positions[a * 3 + 1]!;
      const e1z = positions[b * 3 + 2]! - positions[a * 3 + 2]!;
      const e2x = positions[c * 3]! - positions[a * 3]!;
      const e2y = positions[c * 3 + 1]! - positions[a * 3 + 1]!;
      const e2z = positions[c * 3 + 2]! - positions[a * 3 + 2]!;
      let nx = e1y * e2z - e1z * e2y;
      let ny = e1z * e2x - e1x * e2z;
      let nz = e1x * e2y - e1y * e2x;
      const length = Math.hypot(nx, ny, nz) || 1;
      nx = Math.round((nx / length) * 127);
      ny = Math.round((ny / length) * 127);
      nz = Math.round((nz / length) * 127);
      const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
      const maxX = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
      const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
      const maxY = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5;
          const py = y + 0.5;
          // Pesos baricêntricos; a folga cobre o meio pixel das bordas da ilha.
          const wa = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
          const wb = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
          const wc = 1 - wa - wb;
          if (wa < -0.03 || wb < -0.03 || wc < -0.03) continue;
          const pixel = y * size + x;
          zone[pixel] = id;
          normal[pixel * 3] = nx;
          normal[pixel * 3 + 1] = ny;
          normal[pixel * 3 + 2] = nz;
          for (let axis = 0; axis < 3; axis++) {
            position[pixel * 3 + axis] =
              wa * positions[a * 3 + axis]! +
              wb * positions[b * 3 + axis]! +
              wc * positions[c * 3 + axis]!;
          }
        }
      }
    }
  }
  return { size, zone, position, normal };
}

/**
 * Espalha as zonas para os pixels pintáveis vizinhos que ficaram fora das
 * ilhas de UV (a sangria da textura), para não sobrar borda na cor original.
 */
export function floodZones(map: ZoneMap, paintable: (pixel: number) => boolean): void {
  const { size, zone, position, normal } = map;
  const queue = new Int32Array(size * size);
  let head = 0;
  let tail = 0;
  for (let pixel = 0; pixel < zone.length; pixel++) if (zone[pixel] !== 0) queue[tail++] = pixel;
  const visit = (from: number, to: number): void => {
    if (zone[to] !== 0 || !paintable(to)) return;
    zone[to] = zone[from]!;
    position[to * 3] = position[from * 3]!;
    position[to * 3 + 1] = position[from * 3 + 1]!;
    position[to * 3 + 2] = position[from * 3 + 2]!;
    normal[to * 3] = normal[from * 3]!;
    normal[to * 3 + 1] = normal[from * 3 + 1]!;
    normal[to * 3 + 2] = normal[from * 3 + 2]!;
    queue[tail++] = to;
  };
  while (head < tail) {
    const pixel = queue[head++]!;
    const x = pixel % size;
    if (x > 0) visit(pixel, pixel - 1);
    if (x < size - 1) visit(pixel, pixel + 1);
    if (pixel >= size) visit(pixel, pixel - size);
    if (pixel < zone.length - size) visit(pixel, pixel + size);
  }
}
