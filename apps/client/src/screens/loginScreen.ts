import type { GoogleProfileNeeded, MeResponse } from '@kart/shared';
import {
  ApiError,
  currentAccount,
  fetchPublicConfig,
  login,
  loginWithGoogle,
  logout,
  register,
} from '../net/account';
import { btn, el } from '../ui/dom';
import { field } from '../ui/sections';
import { reopenScreen, setHints } from '../ui/shell';
import { createShowroom } from './showroom';
import type { AppContext, GameScreen } from './types';

/** A parte da API do "Entrar com Google" (Google Identity Services) que usamos. */
interface GoogleIdentityApi {
  initialize(options: {
    client_id: string;
    callback: (response: { credential?: string }) => void;
    ux_mode?: 'popup';
  }): void;
  renderButton(
    parent: HTMLElement,
    options: {
      type: 'standard';
      theme: 'filled_black';
      size: 'large';
      text: 'continue_with';
      shape: 'rectangular';
      locale: string;
      width: number;
    },
  ): void;
}

const GOOGLE_SCRIPT = 'https://accounts.google.com/gsi/client';
let googleScript: Promise<GoogleIdentityApi> | null = null;

/** Carrega o script oficial do Google uma vez só. */
function loadGoogle(): Promise<GoogleIdentityApi> {
  googleScript ??= new Promise<GoogleIdentityApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GOOGLE_SCRIPT;
    script.async = true;
    script.onload = () => {
      const api = (window as { google?: { accounts?: { id?: GoogleIdentityApi } } }).google
        ?.accounts?.id;
      if (api) resolve(api);
      else reject(new Error('Google indisponível'));
    };
    script.onerror = () => {
      googleScript = null;
      reject(new Error('Google indisponível'));
    };
    document.head.append(script);
  });
  return googleScript;
}

type Mode = 'entrar' | 'criar';

interface FieldDef {
  name: string;
  label: string;
  type: string;
  autocomplete: string;
  hint?: string;
}

const NAME: FieldDef = {
  name: 'name',
  label: 'Apelido',
  type: 'text',
  autocomplete: 'nickname',
  hint: 'É o nome que os outros pilotos veem. Até 16 caracteres.',
};
const EMAIL: FieldDef = { name: 'email', label: 'E-mail', type: 'email', autocomplete: 'email' };
const PASSWORD: FieldDef = {
  name: 'password',
  label: 'Senha',
  type: 'password',
  autocomplete: 'current-password',
};
const NEW_PASSWORD: FieldDef = {
  name: 'password',
  label: 'Senha',
  type: 'password',
  autocomplete: 'new-password',
  hint: 'Pelo menos 8 caracteres.',
};
const BIRTH: FieldDef = {
  name: 'birthDate',
  label: 'Nascimento',
  type: 'date',
  autocomplete: 'bday',
  hint: 'É preciso ter 13 anos. Menores de 18 ficam fora de qualquer compra futura.',
};

/**
 * Entrada do jogo: é a primeira tela e não dá para passar dela sem conta.
 * Entra-se com Google ou com e-mail e senha; não existe modo convidado.
 */
export function createLoginScreen(context: AppContext): GameScreen {
  const showroom = createShowroom(context);
  let disposed = false;
  let mode: Mode = 'entrar';
  /** Login Google de conta nova: falta apelido e nascimento. */
  let pendingGoogle: { credential: string; suggestedName: string } | null = null;

  const root = el('section', 'entrada');
  const card = el('div', 'entrada-cartao');
  const heading = el('header', 'gar-itens-topo');
  const body = el('div', 'entrada-corpo');
  card.append(heading, body);
  root.append(card);
  context.ui.append(root);

  const done = (): void => {
    if (disposed) return;
    context.setStatus('Conta conectada');
    reopenScreen();
  };

  const message = (reason: unknown): string =>
    reason instanceof ApiError || reason instanceof Error ? reason.message : 'Algo deu errado.';

  function form(
    fields: readonly FieldDef[],
    submitLabel: string,
    submit: (values: Record<string, string>) => Promise<unknown>,
    values: Record<string, string> = {},
  ): HTMLFormElement {
    const node = el('form', 'formulario');
    for (const item of fields) {
      const input = el('input');
      input.name = item.name;
      input.type = item.type;
      input.required = true;
      input.setAttribute('autocomplete', item.autocomplete);
      if (item.name === 'name') input.maxLength = 16;
      if (item.autocomplete === 'new-password') input.minLength = 8;
      if (values[item.name]) input.value = values[item.name] as string;
      node.append(field(item.label, input, item.hint ?? ''));
    }
    const error = el('p', 'erro');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    const actions = el('div', 'botoes');
    const send = el('button', 'primario', submitLabel);
    send.type = 'submit';
    actions.append(send);
    node.append(error, actions);
    node.addEventListener('submit', (event) => {
      event.preventDefault();
      const data: Record<string, string> = {};
      for (const [key, value] of new FormData(node)) data[key] = String(value);
      send.disabled = true;
      send.textContent = 'Enviando…';
      error.hidden = true;
      submit(data)
        .then(done)
        .catch((reason: unknown) => {
          if (disposed) return;
          send.disabled = false;
          send.textContent = submitLabel;
          error.hidden = false;
          error.textContent = message(reason);
        });
    });
    return node;
  }

  /** Botão do Google: o oficial quando o servidor tem Client ID; senão, um aviso. */
  function googleBlock(): HTMLElement {
    const block = el('div', 'entrada-google');
    const slot = el('div', 'entrada-google-botao');
    const note = el('p', 'nota', 'Carregando o login do Google…');
    const error = el('p', 'erro');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    block.append(slot, note, error);

    const onCredential = (credential: string | undefined): void => {
      if (!credential || disposed) return;
      error.hidden = true;
      note.textContent = 'Confirmando com o Google…';
      loginWithGoogle(credential)
        .then((result: MeResponse | GoogleProfileNeeded | null) => {
          if (disposed) return;
          if (result && 'needsProfile' in result) {
            pendingGoogle = { credential, suggestedName: result.suggestedName };
            render();
          } else {
            done();
          }
        })
        .catch((reason: unknown) => {
          if (disposed) return;
          note.textContent = '';
          error.hidden = false;
          error.textContent = message(reason);
        });
    };

    fetchPublicConfig()
      .then(async (config) => {
        if (disposed) return;
        if (!config.googleClientId) {
          const off = btn('', 'Continuar com Google', () => undefined);
          off.disabled = true;
          const row = el('div', 'botoes');
          row.append(off);
          slot.append(row);
          note.textContent =
            'O login com Google ainda não foi configurado neste servidor. Use e-mail e senha.';
          return;
        }
        const google = await loadGoogle();
        if (disposed) return;
        google.initialize({
          client_id: config.googleClientId,
          callback: (response) => onCredential(response.credential),
          ux_mode: 'popup',
        });
        google.renderButton(slot, {
          type: 'standard',
          theme: 'filled_black',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          locale: 'pt-BR',
          width: Math.min(360, Math.max(200, slot.clientWidth || 320)),
        });
        note.textContent = '';
      })
      .catch(() => {
        if (disposed) return;
        note.textContent = 'Não consegui carregar o login do Google. Use e-mail e senha.';
      });
    return block;
  }

  function render(): void {
    const legacyGuest = currentAccount()?.user.guest === true;
    body.replaceChildren();

    if (pendingGoogle) {
      const { credential, suggestedName } = pendingGoogle;
      heading.replaceChildren(
        el('p', 'sobretitulo', 'Conta Google'),
        el('h2', 'gar-titulo', 'Falta pouco'),
        el('p', 'nota', 'Escolha o seu apelido e informe a data de nascimento para criar a conta.'),
      );
      const back = el('div', 'botoes');
      back.append(
        btn('', 'Voltar', () => {
          pendingGoogle = null;
          render();
        }),
      );
      body.append(
        form([NAME, BIRTH], 'Criar conta', (values) => loginWithGoogle(credential, values), {
          name: suggestedName,
        }),
        back,
      );
      body.querySelector('input')?.focus({ preventScroll: true });
      return;
    }

    heading.replaceChildren(
      el('p', 'sobretitulo', 'Bem-vindo'),
      el('h2', 'entrada-titulo', mode === 'entrar' ? 'Entre para correr' : 'Crie a sua conta'),
      el(
        'p',
        'nota',
        legacyGuest
          ? 'Não dá mais para jogar como convidado. Crie a sua conta: o que você já conquistou continua com você.'
          : 'A conta guarda o seu nível, as moedas, os desbloqueios e o visual do kart.',
      ),
    );

    const tabs = el('div', 'botoes seg entrada-abas');
    tabs.setAttribute('role', 'group');
    tabs.setAttribute('aria-label', 'Entrar ou criar conta');
    for (const [id, label] of [
      ['entrar', 'Já tenho conta'],
      ['criar', 'Criar conta'],
    ] as const) {
      const tab = btn('', label, () => {
        mode = id;
        render();
        body.querySelector<HTMLElement>(`[data-aba="${id}"]`)?.focus();
      });
      tab.dataset.aba = id;
      tab.setAttribute('aria-pressed', String(mode === id));
      tabs.append(tab);
    }

    body.append(
      googleBlock(),
      el('p', 'entrada-ou', 'ou com e-mail'),
      tabs,
      mode === 'entrar'
        ? form([EMAIL, PASSWORD], 'Entrar', login)
        : form([NAME, EMAIL, NEW_PASSWORD, BIRTH], 'Criar conta', register),
    );
    if (legacyGuest) {
      const out = el('div', 'botoes');
      out.append(
        btn('', 'Sair da conta de convidado', () => {
          logout();
          render();
        }),
      );
      body.append(out);
    }
  }

  // Conta antiga de convidado só precisa terminar o cadastro.
  if (currentAccount()?.user.guest) mode = 'criar';
  render();
  context.setStatus('Entre ou crie a sua conta para jogar');
  setHints([
    { keys: ['Tab'], label: 'Próximo campo' },
    { keys: ['Enter'], label: 'Enviar' },
  ]);

  return {
    scene: showroom.scene,
    camera: showroom.camera,
    update(delta, time) {
      showroom.update(delta, time);
    },
    dispose() {
      disposed = true;
      root.remove();
      context.ui.replaceChildren();
      showroom.dispose();
    },
  };
}
