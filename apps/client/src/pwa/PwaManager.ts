import { enterLandscapeFullscreen } from '../ui/mobile';

/** Evento do Chrome/Android que permite mostrar o "Instalar app" quando quisermos. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'kart-online.pwa-dispensado';
/** Fechou o convite: some por uma semana. */
const DISMISS_DAYS = 7;

/** Já está aberto como app instalado (tela de início), e não numa aba do navegador. */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** iPhone ou iPad no Safari: não tem instalação automática, só "Adicionar à Tela de Início". */
export function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  const ios =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // Chrome, Firefox e Edge no iOS também não instalam: só o Safari tem a opção no "Compartilhar".
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(at) && Date.now() - at < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

function rememberDismiss(): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // Sem armazenamento: o convite volta na próxima visita.
  }
}

/**
 * PWA: registra o service worker (só no build de produção, para não brigar
 * com o recarregamento do Vite), guarda o pedido de instalação do Chrome e
 * mostra um convite discreto na tela de entrada e no menu.
 */
export class PwaManager {
  private deferred: BeforeInstallPromptEvent | null = null;
  private readonly banner: HTMLElement;
  private readonly text: HTMLElement;
  private readonly install: HTMLButtonElement;

  constructor() {
    this.banner = document.createElement('aside');
    this.banner.className = 'pwa-convite';
    this.banner.setAttribute('aria-label', 'Instalar o jogo');
    this.banner.hidden = true;
    this.text = document.createElement('p');
    this.install = document.createElement('button');
    this.install.type = 'button';
    this.install.className = 'primario';
    this.install.textContent = 'Instalar app';
    this.install.addEventListener('click', () => void this.promptInstall());
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'pwa-fechar';
    close.textContent = '✕';
    close.setAttribute('aria-label', 'Fechar convite de instalação');
    close.addEventListener('click', () => {
      rememberDismiss();
      this.hide();
    });
    this.banner.append(this.text, this.install, close);
    document.body.append(this.banner);
  }

  start(): void {
    this.registerServiceWorker();
    if (isStandalone()) return;

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.deferred = event as BeforeInstallPromptEvent;
      this.show('Jogue em tela cheia, direto da tela inicial.', true);
    });
    window.addEventListener('appinstalled', () => {
      this.deferred = null;
      this.hide();
    });
    if (isIosSafari()) {
      this.show(
        'Para jogar em tela cheia, toque em Compartilhar e depois em "Adicionar à Tela de Início".',
        false,
      );
    }
  }

  /** Abre o diálogo de instalação do navegador (Android e Chrome no computador). */
  async promptInstall(): Promise<boolean> {
    const prompt = this.deferred;
    if (!prompt) return false;
    this.deferred = null;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'dismissed') rememberDismiss();
    this.hide();
    return outcome === 'accepted';
  }

  private show(message: string, installable: boolean): void {
    if (dismissedRecently()) return;
    this.text.textContent = message;
    this.install.hidden = !installable;
    this.banner.hidden = false;
  }

  private hide(): void {
    this.banner.hidden = true;
  }

  private registerServiceWorker(): void {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    // HTTPS ou localhost: o navegador recusa o registro em http comum.
    if (!window.isSecureContext) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((erro: unknown) => {
        console.warn('[pwa] service worker não registrado', erro);
      });
    });
  }
}

/** Tela cheia deitada ao começar a jogar no celular (precisa vir de um toque do jogador). */
export function fullscreenForRace(): void {
  if (isStandalone()) return;
  void enterLandscapeFullscreen();
}

export function setupPwa(): PwaManager {
  const manager = new PwaManager();
  manager.start();
  return manager;
}
