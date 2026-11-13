import type { NetConditions } from '../net/connection';

export interface DebugPanel {
  /** Linhas "rótulo: valor" atualizadas a cada quadro. */
  update(deltaSeconds: number, rows: Record<string, string | number>): void;
  dispose(): void;
}

/**
 * Painel de depuração (tecla F3): ping, fps, tick, correções de
 * reconciliação e controles para simular latência e perda de pacotes.
 */
export function createDebugPanel(parent: HTMLElement, conditions: NetConditions): DebugPanel {
  const root = document.createElement('section');
  root.className = 'depuracao';
  root.hidden = true;
  root.setAttribute('aria-label', 'Depuração de rede');
  const values = document.createElement('pre');
  root.append(values);

  const slider = (
    label: string,
    max: number,
    unit: string,
    apply: (value: number) => void,
  ): void => {
    const row = document.createElement('label');
    const input = document.createElement('input');
    const output = document.createElement('output');
    input.type = 'range';
    input.min = '0';
    input.max = String(max);
    input.value = '0';
    output.textContent = `0 ${unit}`;
    input.addEventListener('input', () => {
      const value = Number(input.value);
      output.textContent = `${value} ${unit}`;
      apply(value);
    });
    row.append(`${label} `, input, output);
    root.append(row);
  };
  // O atraso vale para cada sentido: 75 ms aqui somam 150 ms de ida e volta.
  slider('Latência simulada (por sentido)', 300, 'ms', (value) => {
    conditions.delayMs = value;
  });
  slider('Perda de pacotes', 30, '%', (value) => {
    conditions.loss = value / 100;
  });
  parent.append(root);

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== 'F3') return;
    event.preventDefault();
    root.hidden = !root.hidden;
  };
  window.addEventListener('keydown', onKeyDown);

  let fps = 60;
  return {
    update(deltaSeconds, rows) {
      if (deltaSeconds > 0) fps += (1 / deltaSeconds - fps) * 0.05;
      if (root.hidden) return;
      const lines = [`fps: ${fps.toFixed(0)}`];
      for (const [label, value] of Object.entries(rows)) lines.push(`${label}: ${value}`);
      const text = lines.join('\n');
      if (values.textContent !== text) values.textContent = text;
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      root.remove();
    },
  };
}
