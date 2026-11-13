import type { KartPaint } from '../cosmetics/paint';
import { clonePaint, FINISHES } from '../cosmetics/paint';
import { createColorPicker } from '../ui/colorPicker';
import { btn, el } from '../ui/dom';

/** O que os editores de rodas e de adesivos precisam da Garagem. */
export interface CustomHost {
  /** A pintura em edição (partindo da pintura pronta, se ainda não houver uma livre). */
  paint(): KartPaint;
  /** @param final falso enquanto o controle ainda está sendo arrastado */
  setPaint(paint: KartPaint, final: boolean): void;
}

export interface CustomEditor {
  element: HTMLElement;
  /** Redesenha a partir do estado da Garagem. */
  refresh(): void;
}

export function section(title: string, ...children: HTMLElement[]): HTMLElement {
  const block = el('section', 'pin-secao');
  block.append(el('h3', 'pin-rotulo', title), ...children);
  return block;
}

const DEFAULT_RIM = '#c9ccd2';
const DEFAULT_STRIPE = '#dcff2e';

/** Editor das rodas: cor livre e acabamento do aro, faixa colorida no pneu. */
export function createWheelEditor(host: CustomHost): CustomEditor {
  const root = el('div', 'pin');
  let target: 'rim' | 'stripe' = 'rim';
  let fromPicker = false;

  const edit = (change: (paint: KartPaint) => void, final = true): void => {
    const paint = clonePaint(host.paint());
    change(paint);
    host.setPaint(paint, final);
    sync();
  };

  const targetRow = el('div', 'botoes pin-alvo');
  const rimTarget = btn('', 'Aro', () => {
    target = 'rim';
    sync();
  });
  const stripeTarget = btn('', 'Faixa do pneu', () => {
    target = 'stripe';
    sync();
  });
  targetRow.append(rimTarget, stripeTarget);
  const picker = createColorPicker((color, final) => {
    fromPicker = true;
    edit((paint) => {
      if (target === 'rim') paint.wheels.color = color;
      else paint.wheels.stripe = color;
    }, final);
    fromPicker = false;
  });
  const clear = btn('pin-limpar', '', () =>
    edit((paint) => {
      if (target === 'rim') paint.wheels.color = null;
      else paint.wheels.stripe = null;
    }),
  );

  const finishRow = el('div', 'botoes');
  const finishButtons = FINISHES.map((item) => {
    const button = btn('', item.label, () =>
      edit((paint) => {
        // O acabamento só aparece com cor própria: parte da cor atual do aro.
        paint.wheels.color ??= DEFAULT_RIM;
        paint.wheels.finish = item.id;
      }),
    );
    finishRow.append(button);
    return { id: item.id, button };
  });

  root.append(
    section('Cor livre', targetRow, picker.element, clear),
    section('Acabamento do aro', finishRow),
  );

  function sync(): void {
    const { wheels } = host.paint();
    rimTarget.setAttribute('aria-pressed', String(target === 'rim'));
    stripeTarget.setAttribute('aria-pressed', String(target === 'stripe'));
    const value = target === 'rim' ? wheels.color : wheels.stripe;
    if (!fromPicker) picker.set(value ?? (target === 'rim' ? DEFAULT_RIM : DEFAULT_STRIPE));
    clear.textContent = target === 'rim' ? 'Usar o aro do catálogo' : 'Tirar a faixa';
    clear.disabled = value === null;
    for (const item of finishButtons)
      item.button.setAttribute(
        'aria-pressed',
        String(wheels.color !== null && wheels.finish === item.id),
      );
  }
  sync();

  return { element: root, refresh: sync };
}
