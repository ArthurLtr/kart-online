import type { Group } from 'three';
import type { ModelId } from '@kart/shared';

/**
 * Fonte de modelos 3D. Toda a cena pede modelos por aqui, então trocar um
 * procedural por um GLB (ou o contrário) não muda nenhuma outra linha.
 *
 * Contrato do Group devolvido: escala em metros, frente para +Z e partes
 * nomeadas (KART_PARTS, PILOT_PARTS, HELMET_PARTS). Pivôs: kart no chão, no
 * centro do eixo traseiro; piloto no chão, entre os pés; capacete no centro
 * da cabeça.
 */
export interface ModelProvider {
  readonly name: string;
  /**
   * Devolve uma instância nova e independente do modelo. `variant` escolhe uma
   * variação de forma (ex.: modelo do capacete). Rejeita se não tiver o modelo.
   */
  load(id: ModelId, variant?: string): Promise<Group>;
  dispose(): void;
}

/** Tenta cada provider em ordem (GLB primeiro, procedural como fallback). */
export class FallbackModelProvider implements ModelProvider {
  readonly name = 'fallback';

  constructor(private readonly providers: readonly ModelProvider[]) {}

  async load(id: ModelId, variant?: string): Promise<Group> {
    const erros: string[] = [];
    for (const provider of this.providers) {
      try {
        const group = await provider.load(id, variant);
        group.userData.provider = provider.name;
        return group;
      } catch (erro) {
        erros.push(`${provider.name}: ${erro instanceof Error ? erro.message : String(erro)}`);
      }
    }
    throw new Error(`Nenhum provider tem o modelo "${id}" (${erros.join('; ')})`);
  }

  dispose(): void {
    for (const provider of this.providers) provider.dispose();
  }
}
