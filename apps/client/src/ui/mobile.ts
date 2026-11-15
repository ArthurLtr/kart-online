/**
 * Celular e tablet: o jogo inteiro é só na horizontal. Em pé, um aviso cobre
 * tudo; deitado, a interface usa o modo compacto (classe `toque` no <html>).
 * No computador nada disto liga.
 */

/** Aparelho de toque como principal (celular, tablet). */
export const isTouchDevice = (): boolean =>
  window.matchMedia('(pointer: coarse)').matches ||
  (navigator.maxTouchPoints > 0 && window.matchMedia('(hover: none)').matches);

const portrait = (): boolean => window.matchMedia('(orientation: portrait)').matches;

/** Evento disparado ao girar o aparelho: quem segura comandos solta tudo. */
export const ROTATE_EVENT = 'kart:girou';

/** Tela cheia e, quando o navegador deixa, trava na horizontal. */
export async function enterLandscapeFullscreen(): Promise<void> {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (kind: string) => Promise<void>;
    };
    await orientation.lock?.('landscape');
  } catch {
    // iPhone e alguns navegadores não deixam: vale o aviso de girar.
  }
}

export async function toggleFullscreen(): Promise<void> {
  if (document.fullscreenElement) {
    await document.exitFullscreen().catch(() => undefined);
    return;
  }
  await enterLandscapeFullscreen();
}

/** Liga o modo celular: classe no <html>, aviso de girar e tela cheia no primeiro toque. */
export function setupMobile(): void {
  if (!isTouchDevice()) return;
  const root = document.documentElement;
  root.classList.add('toque');

  const cover = document.createElement('div');
  cover.className = 'girar';
  cover.setAttribute('role', 'alertdialog');
  cover.setAttribute('aria-modal', 'true');
  cover.setAttribute('aria-labelledby', 'girar-texto');
  const icon = document.createElement('span');
  icon.className = 'girar-icone';
  icon.setAttribute('aria-hidden', 'true');
  const text = document.createElement('p');
  text.id = 'girar-texto';
  text.textContent = 'Gire o celular para jogar deitado';
  cover.append(icon, text);
  document.body.append(cover);

  const sync = (): void => {
    const standing = portrait();
    root.dataset.retrato = String(standing);
    // Em pé nada por trás do aviso recebe foco ou toque.
    document.querySelector('#ui')?.toggleAttribute('inert', standing);
    window.dispatchEvent(new Event(ROTATE_EVENT));
  };
  window.matchMedia('(orientation: portrait)').addEventListener('change', sync);
  sync();

  // Navegadores só deixam pedir tela cheia a partir de um gesto do jogador.
  const first = (event: PointerEvent): void => {
    // Campos de texto abrem o teclado virtual: tela cheia ali atrapalha.
    if (event.target instanceof HTMLInputElement) return;
    window.removeEventListener('pointerup', first);
    void enterLandscapeFullscreen();
  };
  window.addEventListener('pointerup', first);
}
