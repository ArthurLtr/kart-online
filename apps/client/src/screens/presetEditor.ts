import { MAX_PRESETS, sanitizePresetName } from '@kart/shared';
import type { Preset } from '../cosmetics/presets';
import { btn, el } from '../ui/dom';
import type { CustomEditor } from './wheelEditor';
import { section } from './wheelEditor';

export interface PresetHost {
  presets(): readonly Preset[];
  /** Quantos visuais a conta pode guardar (o espaço extra aumenta). */
  limit(): number;
  /** Cores que resumem um visual, para a miniatura. */
  colors(preset: Preset): string[];
  /** O preset é igual ao que está no kart agora. */
  isCurrent(preset: Preset): boolean;
  /** Guarda o visual que está no kart com esse nome. */
  save(name: string): void;
  /** Troca o visual guardado pelo que está no kart. */
  overwrite(index: number): void;
  use(index: number): void;
  remove(index: number): void;
}

/** Painel de visuais salvos: guardar o visual atual e trocar entre os guardados. */
export function createPresetEditor(host: PresetHost): CustomEditor {
  const root = el('div', 'pin');

  const form = el('form', 'pin-preset-novo');
  const name = el('input');
  name.type = 'text';
  name.maxLength = 20;
  name.placeholder = 'Nome do visual';
  name.setAttribute('aria-label', 'Nome do visual a salvar');
  const saveButton = btn('primario', 'Salvar', () => undefined);
  saveButton.type = 'submit';
  form.append(name, saveButton);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    host.save(sanitizePresetName(name.value || `Visual ${host.presets().length + 1}`));
    name.value = '';
  });
  const limit = el('p', 'nota');

  const list = el('ol', 'pin-presets');
  const empty = el(
    'p',
    'nota',
    'Nenhum visual salvo. Monte o kart e o piloto do seu jeito e salve aqui para trocar com um clique.',
  );

  root.append(
    section('Salvar o visual atual', form, limit),
    section('Visuais salvos', list, empty),
  );

  function sync(): void {
    const presets = host.presets();
    const max = host.limit();
    const full = presets.length >= max;
    name.disabled = saveButton.disabled = full;
    limit.textContent = full
      ? `Limite de ${max} visuais. Remova ou substitua um para salvar outro${max < MAX_PRESETS ? ', ou compre o espaço extra na loja' : ''}.`
      : `${presets.length} de ${max} usados.`;
    empty.hidden = presets.length > 0;
    list.replaceChildren(
      ...presets.map((preset, index) => {
        const row = el('li', 'pin-preset');
        const current = host.isCurrent(preset);
        row.dataset.atual = String(current);
        const use = btn('pin-preset-usar', '', () => host.use(index));
        use.setAttribute('aria-pressed', String(current));
        const swatch = el('span', 'pin-preset-cores');
        for (const color of host.colors(preset).slice(0, 4)) {
          const chip = el('span');
          chip.style.background = color;
          swatch.append(chip);
        }
        const text = el('span', 'pin-preset-texto');
        const count = preset.paint?.stickers.length ?? 0;
        text.append(
          el('strong', '', preset.name),
          el(
            'small',
            '',
            current
              ? 'No kart agora'
              : preset.paint
                ? `Pintura livre${count > 0 ? ` · ${count} ${count === 1 ? 'adesivo' : 'adesivos'}` : ''}`
                : 'Pintura do catálogo',
          ),
        );
        use.append(swatch, text);
        const overwrite = btn('pin-camada-acao', '⟳', () => host.overwrite(index));
        overwrite.setAttribute('aria-label', `Substituir ${preset.name} pelo visual atual`);
        overwrite.title = 'Substituir pelo visual atual';
        overwrite.disabled = current;
        const remove = btn('pin-camada-acao', '×', () => host.remove(index));
        remove.setAttribute('aria-label', `Remover ${preset.name}`);
        remove.title = 'Remover';
        row.append(use, overwrite, remove);
        return row;
      }),
    );
  }
  sync();

  return { element: root, refresh: sync };
}
