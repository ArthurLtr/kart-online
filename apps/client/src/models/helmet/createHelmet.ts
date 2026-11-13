import type { BufferGeometry } from 'three';
import {
  BufferAttribute,
  BufferGeometry as Geometry,
  CanvasTexture,
  CatmullRomCurve3,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Shape,
  SRGBColorSpace,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { HelmetModel, HelmetPaint } from '../../cosmetics/catalog';

export const HELMET_PARTS = {
  shell: 'helmet_shell',
  visor: 'helmet_visor',
  trim: 'helmet_trim',
} as const;

// Meias-medidas do casco (m) e limites em coordenadas esféricas:
// theta = azimute a partir da frente (+Z) para +X; phi = ângulo a partir do topo.
const RX = 0.125;
const RY = 0.137;
const RZ = 0.152;
const PHI_MAX = Math.PI * 0.82; // abertura do pescoço
const VISOR = { theta: 1.05, phiCenter: Math.PI * 0.47, phiHalf: Math.PI * 0.085 };

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Raio do casco numa direção: ovoide com queixeira saliente e base fechando para dentro. */
function shellRadius(theta: number, phi: number): number {
  const sx = Math.sin(phi) * Math.sin(theta);
  const sy = Math.cos(phi);
  const sz = Math.sin(phi) * Math.cos(theta);
  let radius = 1 / Math.sqrt((sx / RX) ** 2 + (sy / RY) ** 2 + (sz / RZ) ** 2);
  const front = Math.max(0, Math.cos(theta));
  radius *= 1 + 0.13 * front * front * smoothstep(Math.PI * 0.52, Math.PI * 0.7, phi);
  radius *= 1 - 0.22 * smoothstep(Math.PI * 0.72, PHI_MAX, phi);
  return radius;
}

function surfacePoint(theta: number, phi: number, offset = 0, out = new Vector3()): Vector3 {
  const radius = shellRadius(theta, phi) + offset;
  return out.set(
    radius * Math.sin(phi) * Math.sin(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.cos(theta),
  );
}

/** Referencial tangente ao casco: Y = para fora, Z = descendo pelo casco, X = Y × Z. */
function surfaceFrame(theta: number, phi: number, offset = 0): Matrix4 {
  const origin = surfacePoint(theta, phi, offset);
  const down = surfacePoint(theta, phi + 0.01)
    .sub(surfacePoint(theta, phi - 0.01))
    .normalize();
  const around = surfacePoint(theta + 0.01, phi)
    .sub(surfacePoint(theta - 0.01, phi))
    .normalize();
  const normal = new Vector3().crossVectors(down, around).normalize();
  if (normal.dot(origin) < 0) normal.negate();
  const x = new Vector3().crossVectors(normal, down).normalize();
  const z = new Vector3().crossVectors(x, normal);
  return new Matrix4().makeBasis(x, normal, z).setPosition(origin);
}

/** Dentro do recorte da viseira (retângulo arredondado em theta/phi)? */
function insideVisor(theta: number, phi: number, grow = 1): boolean {
  const a = theta / (VISOR.theta * grow);
  const b = (phi - VISOR.phiCenter) / (VISOR.phiHalf * grow);
  return a ** 4 + b ** 4 < 1;
}

/** Casco ovoide com o recorte da viseira aberto. UV: u = 0,5 na frente, v = 1 no topo. */
function shellGeometry(): BufferGeometry {
  const columns = 72;
  const rows = 44;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const point = new Vector3();
  for (let j = 0; j <= rows; j++) {
    const phi = Math.max(1e-3, (j / rows) * PHI_MAX);
    for (let i = 0; i <= columns; i++) {
      const theta = (i / columns - 0.5) * Math.PI * 2;
      surfacePoint(theta, phi, 0, point);
      positions.push(point.x, point.y, point.z);
      uvs.push(i / columns, 1 - j / rows);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      const theta = ((i + 0.5) / columns - 0.5) * Math.PI * 2;
      const phi = ((j + 0.5) / rows) * PHI_MAX;
      if (insideVisor(theta, phi)) continue;
      const a = j * (columns + 1) + i;
      const b = a + 1;
      const c = a + columns + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new Geometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Une as normais da emenda de trás (colunas 0 e `columns` são o mesmo meridiano).
  const normal = geometry.getAttribute('normal');
  for (let j = 0; j <= rows; j++) {
    const first = j * (columns + 1);
    const last = first + columns;
    const n = new Vector3(
      normal.getX(first) + normal.getX(last),
      normal.getY(first) + normal.getY(last),
      normal.getZ(first) + normal.getZ(last),
    ).normalize();
    normal.setXYZ(first, n.x, n.y, n.z);
    normal.setXYZ(last, n.x, n.y, n.z);
  }
  return geometry;
}

/** Ponto do contorno da viseira para o ângulo `psi`, com folga `grow`. */
function visorOutline(psi: number, grow: number): { theta: number; phi: number } {
  const shape = (value: number): number => Math.sign(value) * Math.sqrt(Math.abs(value));
  return {
    theta: VISOR.theta * grow * shape(Math.cos(psi)),
    phi: VISOR.phiCenter + VISOR.phiHalf * grow * shape(Math.sin(psi)),
  };
}

/** Viseira curva separada, um pouco maior que o recorte e por fora do casco. */
function visorGeometry(): BufferGeometry {
  const rings = 10;
  const spokes = 72;
  const positions: number[] = [];
  const indices: number[] = [];
  const point = new Vector3();
  for (let r = 0; r <= rings; r++) {
    for (let s = 0; s <= spokes; s++) {
      const outline = visorOutline((s / spokes) * Math.PI * 2, 1.1);
      const k = r / rings;
      surfacePoint(
        outline.theta * k,
        VISOR.phiCenter + (outline.phi - VISOR.phiCenter) * k,
        0.004,
        point,
      );
      positions.push(point.x, point.y, point.z);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < spokes; s++) {
      const a = r * (spokes + 1) + s;
      const b = a + 1;
      const c = a + spokes + 1;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new Geometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Borrachas, entrada de ar, pivôs da viseira e (no modelo aero) o aerofólio traseiro. */
function trimGeometry(model: HelmetModel['id']): BufferGeometry {
  const parts: BufferGeometry[] = [];

  const visorRim: Vector3[] = [];
  for (let s = 0; s < 64; s++) {
    const outline = visorOutline((s / 64) * Math.PI * 2, 1.1);
    visorRim.push(surfacePoint(outline.theta, outline.phi, 0.004));
  }
  parts.push(new TubeGeometry(new CatmullRomCurve3(visorRim, true), 128, 0.0045, 6, true));

  const neckRim: Vector3[] = [];
  for (let s = 0; s < 48; s++) {
    neckRim.push(surfacePoint((s / 48 - 0.5) * Math.PI * 2, PHI_MAX, 0.001));
  }
  parts.push(new TubeGeometry(new CatmullRomCurve3(neckRim, true), 96, 0.008, 6, true));

  // Entrada de ar superior: tomada baixa de cantos arredondados.
  const intake = new Shape();
  intake.moveTo(-0.022, -0.02);
  intake.quadraticCurveTo(0, -0.03, 0.022, -0.02);
  intake.lineTo(0.016, 0.03);
  intake.quadraticCurveTo(0, 0.036, -0.016, 0.03);
  intake.closePath();
  const bevel = { bevelEnabled: true, bevelSegments: 4, bevelSize: 0.003, bevelThickness: 0.003 };
  parts.push(
    new ExtrudeGeometry(intake, { depth: 0.007, curveSegments: 8, ...bevel })
      // O contorno (XY) deita sobre o casco e a extrusão (Z) sai para fora.
      .rotateX(-Math.PI / 2)
      .applyMatrix4(surfaceFrame(0, Math.PI * 0.2, 0.001)),
  );

  // Pivôs da viseira: discos abaulados dos dois lados.
  const pivot = new LatheGeometry(
    [
      new Vector2(0, 0.006),
      new Vector2(0.008, 0.005),
      new Vector2(0.013, 0.002),
      new Vector2(0.014, 0),
    ],
    16,
  );
  for (const side of [-1, 1]) {
    parts.push(
      pivot
        .clone()
        .applyMatrix4(surfaceFrame(side * (VISOR.theta * 1.1 + 0.05), VISOR.phiCenter, 0.004)),
    );
  }
  pivot.dispose();

  if (model === 'aero') {
    // Aerofólio: lâmina fina no plano central, na parte de trás do casco.
    const fin = new Shape();
    fin.moveTo(-0.07, 0);
    fin.quadraticCurveTo(-0.01, 0.012, 0.05, 0.03);
    fin.quadraticCurveTo(0.065, 0.02, 0.06, 0);
    fin.closePath();
    const thickness = 0.012;
    const frame = surfaceFrame(Math.PI, Math.PI * 0.36, -0.002);
    const x = new Vector3();
    const y = new Vector3();
    const z = new Vector3();
    frame.extractBasis(x, y, z);
    // Contorno: X ao longo do casco (descendo), Y para fora; espessura no eixo lateral.
    const placement = new Matrix4().makeBasis(z, y, x.clone().negate()).copyPosition(frame);
    parts.push(
      new ExtrudeGeometry(fin, { depth: thickness, curveSegments: 10, ...bevel })
        .translate(0, 0, -thickness / 2)
        .applyMatrix4(placement),
    );
  }

  const sources = parts.map((part) => {
    const flat = part.index ? part.toNonIndexed() : part;
    flat.deleteAttribute('uv');
    return flat;
  });
  const merged = mergeGeometries(sources, false);
  if (!merged) throw new Error('falha ao mesclar os detalhes do capacete');
  for (const geometry of new Set([...parts, ...sources])) geometry.dispose();
  return merged;
}

const paintCache = new Map<string, CanvasTexture>();

/** Pintura do casco: base, faixa central de largura constante, flâmulas laterais e barra inferior. */
export function helmetPaintTexture(paint: HelmetPaint): CanvasTexture {
  const cached = paintCache.get(paint.id);
  if (cached) return cached;
  const width = 1024;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2D indisponível');
  const xOf = (theta: number): number => (theta / (Math.PI * 2) + 0.5) * width;
  const yOf = (phi: number): number => (phi / PHI_MAX) * height;

  ctx.fillStyle = paint.base;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = paint.lower;
  ctx.fillRect(0, yOf(Math.PI * 0.66), width, height);

  // Flâmulas laterais que sobem da queixeira para trás.
  ctx.fillStyle = paint.accent;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(xOf(side * 1.25), yOf(Math.PI * 0.66));
    ctx.quadraticCurveTo(
      xOf(side * 1.9),
      yOf(Math.PI * 0.42),
      xOf(side * 2.75),
      yOf(Math.PI * 0.3),
    );
    ctx.quadraticCurveTo(
      xOf(side * 2.2),
      yOf(Math.PI * 0.52),
      xOf(side * 1.7),
      yOf(Math.PI * 0.66),
    );
    ctx.closePath();
    ctx.fill();
  }

  // Faixa central: largura constante em metros, então em theta ela alarga perto do topo.
  const stripe = (halfWidth: number, color: string): void => {
    ctx.fillStyle = color;
    for (let y = 0; y < height; y++) {
      const phi = Math.max(1e-3, (y / height) * PHI_MAX);
      const span = Math.asin(Math.min(1, halfWidth / (RX * Math.sin(phi))));
      const half = (span / (Math.PI * 2)) * width;
      ctx.fillRect(width / 2 - half, y, half * 2, 1); // frente
      ctx.fillRect(0, y, half, 1); // costas (emenda)
      ctx.fillRect(width - half, y, half, 1);
    }
  };
  stripe(0.03, paint.accent);
  stripe(0.022, paint.stripe);

  ctx.fillStyle = paint.base;
  ctx.font = 'italic 900 30px system-ui, "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const side of [-1, 1]) ctx.fillText('ORLA', xOf(side * 1.75), yOf(Math.PI * 0.73));

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  paintCache.set(paint.id, texture);
  return texture;
}

const geometryCache = new Map<
  string,
  { shell: BufferGeometry; visor: BufferGeometry; trim: BufferGeometry }
>();

/**
 * Capacete integral de kart: casco ovoide com recorte, viseira curva separada
 * e reflexiva, entrada de ar no topo, borrachas e faixa decorativa (na pintura).
 * As cores seguem os capacetes das imagens de referência; o formato fechado é
 * o do prompt (as referências mostram um capacete aberto de rali).
 *
 * Contrato: origem no centro da cabeça, frente para +Z, partes HELMET_PARTS.
 */
export function createHelmet(model: HelmetModel['id'] = 'integral'): Group {
  let geometry = geometryCache.get(model);
  if (!geometry) {
    const base = geometryCache.values().next().value;
    geometry = {
      shell: base?.shell ?? shellGeometry(),
      visor: base?.visor ?? visorGeometry(),
      trim: trimGeometry(model),
    };
    geometryCache.set(model, geometry);
  }

  const group = new Group();
  group.name = 'helmet';
  group.userData.model = model;

  const shell = new Mesh(
    geometry.shell,
    new MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.32,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
    }),
  );
  shell.name = HELMET_PARTS.shell;
  shell.castShadow = true;

  const visor = new Mesh(
    geometry.visor,
    new MeshPhysicalMaterial({
      color: 0x20242b,
      metalness: 1,
      roughness: 0.06,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      envMapIntensity: 1.6,
    }),
  );
  visor.name = HELMET_PARTS.visor;

  const trim = new Mesh(
    geometry.trim,
    new MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.55 }),
  );
  trim.name = HELMET_PARTS.trim;

  group.add(shell, visor, trim);
  return group;
}
