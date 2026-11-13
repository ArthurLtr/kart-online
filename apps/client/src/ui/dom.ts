/** Cria um elemento com classe e texto. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const created = document.createElement(tag);
  if (className) created.className = className;
  if (text) created.textContent = text;
  return created;
}

/** Cria um botão (`type="button"`) com classe, rótulo e ação. */
export function btn(className: string, label: string, onClick: () => void): HTMLButtonElement {
  const created = el('button', className, label);
  created.type = 'button';
  created.addEventListener('click', onClick);
  return created;
}
