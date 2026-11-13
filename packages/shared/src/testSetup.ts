import { initPhysics } from './sim/physics.js';

// O WASM do Rapier precisa estar carregado antes de qualquer colisão (inclusive no topo dos testes).
await initPhysics();
