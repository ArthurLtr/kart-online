import type { Material, Texture } from 'three';
import {
  CircleGeometry,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Path,
  Shape,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
} from 'three';
import { CURRENCY_GLB_URLS } from './GlbModelProvider';
import { loadGlb } from './glb';

export type CurrencyKind = 'coin' | 'gem';

/** Ícones 2D gerados por `pnpm assets currency` (também viram a face dos modelos de reserva). */
export const CURRENCY_ICONS: Record<CurrencyKind, string> = {
  coin: '/assets/currency/icon_coin.webp',
  gem: '/assets/currency/icon_gem.webp',
};

/** Nomes das malhas da gema: giram separadas. */
export const GEM_PARTS = { rim: 'Gem_Rim', core: 'Gem_Core' } as const;

const COIN_MATERIAL = { metalness: 0.85, roughness: 0.25 };
const RIM_MATERIAL = { metalness: 0.8, roughness: 0.3 };

let textures: TextureLoader | undefined;
const textureCache = new Map<string, Texture>();
function icon(url: string): Texture {
  let texture = textureCache.get(url);
  if (!texture) {
    textures ??= new TextureLoader();
    texture = textures.load(url);
    texture.colorSpace = SRGBColorSpace;
    textureCache.set(url, texture);
  }
  return texture;
}

/** Ajusta o PBR do GLB para o brilho arcade da garagem. */
function tune(kind: CurrencyKind, group: Group): void {
  group.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const material = node.material as Material;
    if (!(material instanceof MeshStandardMaterial)) return;
    // Material próprio por instância: o pulso do brilho não vaza para outras cópias.
    const own = material.clone();
    node.material = own;
    const part = node.name || node.parent?.name || '';
    if (kind === 'coin') Object.assign(own, COIN_MATERIAL);
    else if (part.startsWith(GEM_PARTS.rim)) Object.assign(own, RIM_MATERIAL);
    else if (part.startsWith(GEM_PARTS.core)) {
      if (own.emissive.getHex() === 0) own.emissive.set('#00b8ff');
      own.emissiveIntensity = 0.8;
    }
  });
}

// --- modelos de reserva (enquanto os .glb não existem) ---------------------------

function proceduralCoin(): Group {
  const group = new Group();
  // Perfil da borda serrilhada com aro levantado (raio 0.5, espessura 0.12).
  const profile = [
    [0, 0.045],
    [0.4, 0.045],
    [0.43, 0.06],
    [0.49, 0.06],
    [0.5, 0.045],
    [0.5, -0.045],
    [0.49, -0.06],
    [0.43, -0.06],
    [0.4, -0.045],
    [0, -0.045],
  ].map(([x, y]) => new Vector2(x, y));
  const edge = new Mesh(
    new LatheGeometry(profile, 64),
    new MeshStandardMaterial({ color: '#d9a43a', ...COIN_MATERIAL }),
  );
  edge.rotation.x = Math.PI / 2; // eixo da moeda em Z: a face olha para a câmera
  const faceMaterial = new MeshStandardMaterial({
    map: icon(CURRENCY_ICONS.coin),
    transparent: true,
    alphaTest: 0.4,
    ...COIN_MATERIAL,
    roughness: 0.35,
  });
  const face = new CircleGeometry(0.5, 64);
  const front = new Mesh(face, faceMaterial);
  front.position.z = 0.062;
  const back = new Mesh(face, faceMaterial);
  back.position.z = -0.062;
  back.rotation.y = Math.PI;
  group.add(edge, front, back);
  group.name = 'kart_coin';
  return group;
}

/** Hexágono de ponta em cima, `w` de largura e `h` de altura. */
function hexagon(w: number, h: number, target: Path = new Shape()): Path {
  const x = w / 2;
  const y = h / 2;
  target.moveTo(0, y);
  target.lineTo(x, y * 0.5);
  target.lineTo(x, -y * 0.5);
  target.lineTo(0, -y);
  target.lineTo(-x, -y * 0.5);
  target.lineTo(-x, y * 0.5);
  target.closePath();
  return target;
}

function proceduralGem(): Group {
  const group = new Group();
  const W = 0.8;
  const H = 1;
  const inner = 0.76;
  const rimShape = hexagon(W, H) as Shape;
  rimShape.holes.push(hexagon(W * inner, H * inner, new Path()));
  const rimGeometry = new ExtrudeGeometry(rimShape, {
    depth: 0.12,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.025,
    bevelSegments: 2,
  });
  rimGeometry.center();
  const rim = new Mesh(
    rimGeometry,
    new MeshStandardMaterial({ color: '#aeb6c2', ...RIM_MATERIAL }),
  );
  rim.name = GEM_PARTS.rim;

  const coreW = W * inner * 0.97;
  const coreH = H * inner * 0.97;
  const coreGeometry = new ExtrudeGeometry(hexagon(coreW, coreH) as Shape, {
    depth: 0.06,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.02,
    bevelSegments: 3,
  });
  coreGeometry.center();
  // A face usa o miolo da arte da gema (o aro da arte fica por baixo do aro 3D).
  const map = icon(CURRENCY_ICONS.gem).clone();
  map.repeat.set(0.62 / coreW, 0.74 / coreH);
  map.offset.set(0.5, 0.5);
  map.needsUpdate = true;
  const crystal = { emissive: '#00b8ff', emissiveIntensity: 0.8, roughness: 0.12, metalness: 0 };
  const face = new MeshPhysicalMaterial({ map, clearcoat: 1, ...crystal });
  const side = new MeshPhysicalMaterial({ color: '#2fd8ff', clearcoat: 1, ...crystal });
  const core = new Mesh(coreGeometry, [face, side]);
  core.name = GEM_PARTS.core;
  group.add(rim, core);
  group.name = 'turbo_gem';
  return group;
}

/**
 * Modelo 3D da moeda ou da gema, com ~1 unidade de altura e centrado na origem.
 * Tenta o GLB (cacheado por URL) e cai no procedural se ele ainda não existir.
 */
export async function loadCurrencyModel(kind: CurrencyKind): Promise<Group> {
  try {
    const gltf = await loadGlb(CURRENCY_GLB_URLS[kind]);
    const group = gltf.scene.clone(true);
    tune(kind, group);
    return group;
  } catch {
    return kind === 'coin' ? proceduralCoin() : proceduralGem();
  }
}
