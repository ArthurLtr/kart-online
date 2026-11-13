import { initPhysics } from '@kart/shared';

// O WASM do Rapier precisa estar carregado antes de qualquer colisão (inclusive no topo dos testes).
await initPhysics();
