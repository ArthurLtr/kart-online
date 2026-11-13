/**
 * Navegação por setas dentro de um contêiner: ↑/← foca o botão anterior,
 * ↓/→ o próximo. Devolve a função que desliga.
 */
export function arrowNavigation(container: HTMLElement): () => void {
  const onKey = (event: KeyboardEvent): void => {
    const step =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? -1
          : 0;
    if (step === 0) return;
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    buttons[(index + step + buttons.length) % buttons.length]?.focus();
  };
  container.addEventListener('keydown', onKey);
  return () => container.removeEventListener('keydown', onKey);
}
