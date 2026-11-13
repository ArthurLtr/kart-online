import type { WebGLRenderer } from 'three';
import { GlbModelProvider } from './GlbModelProvider';
import type { ModelProvider } from './ModelProvider';
import { FallbackModelProvider } from './ModelProvider';
import { ProceduralModelProvider } from './ProceduralModelProvider';

export type { ModelProvider } from './ModelProvider';

/** GLB primeiro, procedural como fallback. */
export function createModelProvider(renderer: WebGLRenderer): ModelProvider {
  return new FallbackModelProvider([new GlbModelProvider(renderer), new ProceduralModelProvider()]);
}
