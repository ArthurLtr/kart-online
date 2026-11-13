import type { Camera } from 'three';
import { Vector3 } from 'three';

export interface TagTarget {
  name: string;
  x: number;
  y: number;
  z: number;
}

export interface NameTags {
  /** `skip` é a vaga do próprio jogador (sem etiqueta). */
  update(targets: readonly TagTarget[], camera: Camera, skip: number): void;
  hide(): void;
  dispose(): void;
}

const MAX_DISTANCE = 70;
const HEIGHT = 1.55;

/** Nomes sobre os karts: etiquetas HTML posicionadas pela projeção da câmera. */
export function createNameTags(parent: HTMLElement): NameTags {
  const root = document.createElement('div');
  root.className = 'nomes';
  root.setAttribute('aria-hidden', 'true');
  parent.append(root);
  const tags: HTMLSpanElement[] = [];
  const point = new Vector3();
  const eye = new Vector3();

  const tag = (index: number): HTMLSpanElement => {
    let element = tags[index];
    if (!element) {
      element = document.createElement('span');
      root.append(element);
      tags[index] = element;
    }
    return element;
  };

  return {
    update(targets, camera, skip) {
      const { clientWidth: width, clientHeight: height } = root;
      camera.getWorldPosition(eye);
      targets.forEach((target, i) => {
        const element = tag(i);
        point.set(target.x, target.y + HEIGHT, target.z);
        const distance = point.distanceTo(eye);
        point.project(camera);
        const visible =
          i !== skip && distance < MAX_DISTANCE && point.z < 1 && Math.abs(point.x) < 1.1;
        element.hidden = !visible;
        if (!visible) return;
        if (element.textContent !== target.name) element.textContent = target.name;
        const x = (point.x * 0.5 + 0.5) * width;
        const y = (-point.y * 0.5 + 0.5) * height;
        element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
        element.style.opacity = Math.min(1, (MAX_DISTANCE - distance) / 20).toFixed(2);
      });
      for (let i = targets.length; i < tags.length; i++) (tags[i] as HTMLSpanElement).hidden = true;
    },
    hide() {
      for (const element of tags) element.hidden = true;
    },
    dispose() {
      root.remove();
    },
  };
}
