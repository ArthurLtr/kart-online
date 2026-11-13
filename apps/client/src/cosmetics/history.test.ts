import { describe, expect, it } from 'vitest';
import { createHistory } from './history';

const history = () => createHistory<number>(0, (a, b) => a === b, 3);

describe('desfazer e refazer', () => {
  it('desfaz e refaz na ordem', () => {
    const h = history();
    h.push(1);
    h.push(2);
    expect(h.undo()).toBe(1);
    expect(h.undo()).toBe(0);
    expect(h.undo()).toBeNull();
    expect(h.redo()).toBe(1);
    expect(h.redo()).toBe(2);
    expect(h.redo()).toBeNull();
  });

  it('estado igual ao atual não entra na pilha', () => {
    const h = history();
    h.push(0);
    expect(h.canUndo()).toBe(false);
  });

  it('uma mudança nova depois de desfazer apaga o refazer', () => {
    const h = history();
    h.push(1);
    h.undo();
    h.push(5);
    expect(h.canRedo()).toBe(false);
    expect(h.undo()).toBe(0);
  });

  it('guarda só os últimos passos', () => {
    const h = history();
    for (let i = 1; i <= 6; i++) h.push(i);
    expect([h.undo(), h.undo(), h.undo(), h.undo()]).toEqual([5, 4, 3, null]);
  });

  it('recomeçar limpa as duas pilhas', () => {
    const h = history();
    h.push(1);
    h.undo();
    h.reset(9);
    expect(h.canUndo() || h.canRedo()).toBe(false);
    h.push(10);
    expect(h.undo()).toBe(9);
  });
});
