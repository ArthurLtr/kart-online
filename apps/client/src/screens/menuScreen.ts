import { MenuMusic } from '../audio/menuMusic';
import { currentAccount, refreshAccount } from '../net/account';
import { createShowroom } from './showroom';
import type { AppContext, GameScreen } from './types';
import { button } from './types';

export type PlayIntent = 'casual' | 'ranked' | 'private';

let intent: PlayIntent | null = null;

/** Modo escolhido no menu; a tela de corrida lê uma vez ao abrir. */
export function takePlayIntent(): PlayIntent | null {
  const value = intent;
  intent = null;
  return value;
}

/** Menu principal: o kart do jogador girando ao fundo e os botões do jogo. */
export function createMenuScreen(context: AppContext): GameScreen {
  const showroom = createShowroom(context);
  const music = new MenuMusic();
  const startMusic = (): void => music.start();
  window.addEventListener('pointerdown', startMusic);
  window.addEventListener('keydown', startMusic);

  const menu = document.createElement('nav');
  menu.className = 'menu';
  menu.setAttribute('aria-label', 'Menu principal');
  const greeting = document.createElement('p');
  greeting.className = 'menu-piloto';
  menu.append(greeting);

  const main = document.createElement('div');
  main.className = 'botoes menu-botoes';
  const play = document.createElement('div');
  play.className = 'botoes menu-botoes';
  play.hidden = true;
  menu.append(main, play);

  const go = (hash: string, mode: PlayIntent | null = null): void => {
    intent = mode;
    window.location.hash = hash;
  };
  const showPlay = (visible: boolean): void => {
    play.hidden = !visible;
    main.hidden = visible;
    (visible ? play : main).querySelector('button')?.focus();
  };

  button(main, 'Jogar', () => showPlay(true)).className = 'primario';
  button(main, 'Garagem', () => go('garagem'));
  button(main, 'Perfil', () => go('conta'));
  button(main, 'Configurações', () => go('config'));

  button(play, 'Casual', () => go('corrida', 'casual')).className = 'primario';
  button(play, 'Ranqueado', () => go('corrida', 'ranked'));
  button(play, 'Treino', () => go('treino'));
  button(play, 'Sala privada', () => go('corrida', 'private'));
  button(play, 'Voltar', () => showPlay(false));

  context.ui.append(menu);
  context.setStatus('Menu principal');

  let disposed = false;
  const greet = (): void => {
    const me = currentAccount();
    if (!me) {
      greeting.textContent = 'Entre em Perfil para guardar seu progresso.';
      return;
    }
    const { rating } = me;
    const rank = rating.division
      ? `${rating.division} · ${rating.points} pts`
      : `posicionamento: faltam ${rating.placementLeft} partidas`;
    greeting.textContent = me.user.guest
      ? `${me.user.name} (convidado)`
      : `${me.user.name} · ${rank}`;
  };
  greet();
  refreshAccount()
    .then(() => {
      if (!disposed) greet();
    })
    .catch(() => {
      // Servidor fora do ar: o menu funciona do mesmo jeito (Treino e Garagem são locais).
    });

  return {
    scene: showroom.scene,
    camera: showroom.camera,
    update: (delta, time) => showroom.update(delta, time),
    dispose() {
      disposed = true;
      window.removeEventListener('pointerdown', startMusic);
      window.removeEventListener('keydown', startMusic);
      music.dispose();
      context.ui.replaceChildren();
      showroom.dispose();
    },
  };
}
