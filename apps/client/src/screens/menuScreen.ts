import { MenuMusic } from '../audio/menuMusic';
import { refreshAccount } from '../net/account';
import { setHints, updatePilot } from '../ui/shell';
import { createShowroom } from './showroom';
import type { AppContext, GameScreen } from './types';

export type PlayIntent = 'casual' | 'ranked' | 'private';

let intent: PlayIntent | null = null;

/** Modo escolhido no menu; a tela de corrida lê uma vez ao abrir. */
export function takePlayIntent(): PlayIntent | null {
  const value = intent;
  intent = null;
  return value;
}

interface Mode {
  name: string;
  summary: string;
  description: string;
  facts: readonly string[];
  action: string;
  hash: string;
  intent: PlayIntent | null;
}

export const MODES: readonly Mode[] = [
  {
    name: 'Casual',
    summary: 'Corrida rápida online',
    description:
      'Entre numa sala e corra agora. Se faltar gente, pilotos da casa completam o grid.',
    facts: ['Online', 'Até 9 pilotos', 'Circuito da Orla'],
    action: 'Correr',
    hash: 'corrida',
    intent: 'casual',
  },
  {
    name: 'Ranqueado',
    summary: 'Vale pontos na temporada',
    description:
      'Adversários do seu nível, e cada posição conta para a sua divisão. Precisa de conta com e-mail.',
    facts: ['Online', 'Vale pontos', 'Exige conta'],
    action: 'Entrar na fila',
    hash: 'corrida',
    intent: 'ranked',
  },
  {
    name: 'Treino',
    summary: 'Você contra o relógio',
    description: 'Pista livre para aprender o traçado e baixar o seu tempo de volta, sem pressa.',
    facts: ['Sozinho', 'Sem conexão', 'Circuito da Orla'],
    action: 'Ir para a pista',
    hash: 'treino',
    intent: null,
  },
  {
    name: 'Sala privada',
    summary: 'Corra com os amigos',
    description:
      'Crie uma sala, mande o código de convite e largue quando todos estiverem prontos.',
    facts: ['Online', 'Código de convite', 'Até 9 pilotos'],
    action: 'Abrir sala',
    hash: 'corrida',
    intent: 'private',
  },
];

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text = '',
): HTMLElementTagNameMap[K] {
  const created = document.createElement(tag);
  created.className = className;
  created.textContent = text;
  return created;
}

/** Menu principal: o kart do jogador em cena e os modos de jogo em cartões. */
export function createMenuScreen(context: AppContext): GameScreen {
  const showroom = createShowroom(context);
  const music = new MenuMusic();
  const startMusic = (): void => music.start();
  window.addEventListener('pointerdown', startMusic);
  window.addEventListener('keydown', startMusic);

  const root = element('section', 'inicio');
  root.setAttribute('aria-label', 'Menu principal');
  const hero = element('div', 'inicio-heroi');
  const list = element('div', 'inicio-modos');
  root.append(hero, list);

  let selected = -1;
  const start = (mode: Mode): void => {
    intent = mode.intent;
    window.location.hash = mode.hash;
  };

  const cards = MODES.map((mode, index) => {
    const card = element('button', 'modo');
    card.type = 'button';
    card.style.setProperty('--ordem', String(index));
    card.append(
      element('span', 'modo-numero', String(index + 1).padStart(2, '0')),
      element('span', 'modo-nome', mode.name),
      element('span', 'modo-resumo', mode.summary),
    );
    card.addEventListener('pointerenter', () => select(index));
    card.addEventListener('focus', () => select(index));
    card.addEventListener('click', () => start(mode));
    list.append(card);
    return card;
  });

  function select(index: number): void {
    if (index === selected) return;
    selected = index;
    const mode = MODES[index]!;
    cards.forEach((card, at) => card.setAttribute('aria-current', String(at === index)));
    const number = `Modo ${String(index + 1).padStart(2, '0')} / ${String(MODES.length).padStart(2, '0')}`;
    const facts = element('ul', 'inicio-fatos');
    facts.append(...mode.facts.map((fact) => element('li', 'etiqueta', fact)));
    const go = element('button', 'btn btn-primario btn-g', mode.action);
    go.type = 'button';
    go.addEventListener('click', () => start(mode));
    // Bloco novo a cada troca, para a animação de entrada tocar de novo.
    const block = element('div', 'inicio-heroi');
    block.append(
      element('p', 'sobretitulo', number),
      element('h2', 'titulo-xl', mode.name),
      element('p', 'inicio-desc', mode.description),
      facts,
      go,
    );
    root.firstElementChild?.replaceWith(block);
  }

  const onKey = (event: KeyboardEvent): void => {
    const step =
      event.code === 'ArrowRight' || event.code === 'KeyD'
        ? 1
        : event.code === 'ArrowLeft' || event.code === 'KeyA'
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    cards[(selected + step + cards.length) % cards.length]!.focus();
  };
  window.addEventListener('keydown', onKey);

  context.ui.append(root);
  select(0);
  cards[0]!.focus({ preventScroll: true });
  context.setStatus('Pronto para correr');
  setHints([
    { keys: ['←', '→'], label: 'Escolher modo' },
    { keys: ['Enter'], label: 'Confirmar' },
  ]);

  refreshAccount()
    .then(updatePilot)
    .catch(() => {
      // Servidor fora do ar: o menu funciona do mesmo jeito (Treino e Garagem são locais).
    });

  return {
    scene: showroom.scene,
    camera: showroom.camera,
    update: (delta, time) => showroom.update(delta, time),
    dispose() {
      window.removeEventListener('pointerdown', startMusic);
      window.removeEventListener('keydown', startMusic);
      window.removeEventListener('keydown', onKey);
      music.dispose();
      context.ui.replaceChildren();
      showroom.dispose();
    },
  };
}
