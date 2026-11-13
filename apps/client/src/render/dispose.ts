import type { BufferGeometry, Material, Object3D } from 'three';
import { Mesh, Texture } from 'three';

/** Libera geometrias, materiais e texturas de toda a árvore (ao trocar de cena). */
export function disposeTree(root: Object3D): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    geometries.add(node.geometry as BufferGeometry);
    const list = (Array.isArray(node.material) ? node.material : [node.material]) as Material[];
    for (const material of list) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof Texture) value.dispose();
    }
    material.dispose();
  }
}
