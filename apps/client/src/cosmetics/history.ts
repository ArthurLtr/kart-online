/** Pilha de desfazer/refazer de um estado imutável. */
export interface History<T> {
  /** Registra o estado atual; igual ao anterior não conta. Limpa o refazer. */
  push(state: T): void;
  /** Volta um passo e devolve o estado a mostrar (`null` se não há o que desfazer). */
  undo(): T | null;
  redo(): T | null;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Recomeça a partir de um estado (por exemplo, ao carregar o visual da conta). */
  reset(state: T): void;
}

export function createHistory<T>(
  initial: T,
  same: (a: T, b: T) => boolean,
  limit = 60,
): History<T> {
  let past: T[] = [];
  let current = initial;
  let future: T[] = [];
  return {
    push(state) {
      if (same(state, current)) return;
      past.push(current);
      if (past.length > limit) past.shift();
      current = state;
      future = [];
    },
    undo() {
      const previous = past.pop();
      if (previous === undefined) return null;
      future.push(current);
      current = previous;
      return current;
    },
    redo() {
      const next = future.pop();
      if (next === undefined) return null;
      past.push(current);
      current = next;
      return current;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    reset(state) {
      past = [];
      future = [];
      current = state;
    },
  };
}
