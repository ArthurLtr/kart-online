import type { AuthResponse, Cosmetics, MeResponse, QueueStatus, RankingEntry } from '@kart/shared';
import { COSMETIC_ITEMS, SERVER_DEFAULT_PORT } from '@kart/shared';
import type { Loadout } from '../cosmetics/catalog';
import { CATALOG, loadLoadout, saveLoadout } from '../cosmetics/catalog';

const TOKEN_KEY = 'kart-online.token';

function apiUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (configured) return configured.replace(/^ws/, 'http');
  return `${window.location.protocol}//${window.location.hostname}:${SERVER_DEFAULT_PORT}`;
}

let token: string | null = null;
try {
  token = localStorage.getItem(TOKEN_KEY);
} catch {
  // Sem armazenamento: a sessão vale só enquanto a aba estiver aberta.
}
let me: MeResponse | null = null;

function setToken(value: string | null): void {
  token = value;
  if (!value) me = null;
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // idem
  }
}

/** Erro da API com a mensagem que o servidor mandou para o jogador. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl() + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, 'Não consegui falar com o servidor. Ele está rodando (pnpm dev)?');
  }
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new ApiError(response.status, data.error ?? 'Erro no servidor.');
  return data as T;
}

/** Sessão guardada neste navegador, para entrar nas salas. */
export const sessionToken = (): string | null => token;
/** Último perfil carregado (ou `null` sem sessão). */
export const currentAccount = (): MeResponse | null => me;

const STARTERS = new Set(COSMETIC_ITEMS.filter((item) => item.starter).map((item) => item.id));
const ITEM_IDS = new Set(COSMETIC_ITEMS.map((item) => item.id));

/** Falso para item de catálogo que a conta não possui. Sem conta, valem os itens iniciais. */
export function isUnlocked(slot: string, id: string): boolean {
  const itemId = `${slot}:${id}`;
  if (!ITEM_IDS.has(itemId)) return true;
  return me ? me.inventory.includes(itemId) : STARTERS.has(itemId);
}

/** O loadout da conta passa a valer neste navegador também (treino, garagem). */
function adoptLoadout(remote: Cosmetics): void {
  const loadout = loadLoadout();
  for (const slot of Object.keys(loadout) as (keyof Loadout)[]) {
    const id = remote[slot];
    if (id && CATALOG[slot].some((item) => item.id === id)) loadout[slot] = id;
    if (!isUnlocked(slot, loadout[slot])) loadout[slot] = (CATALOG[slot][0] as { id: string }).id;
  }
  saveLoadout(loadout);
}

/** Recarrega o perfil. Sessão vencida ou inválida é descartada. */
export async function refreshAccount(): Promise<MeResponse | null> {
  if (!token) return null;
  try {
    me = await request<MeResponse>('GET', '/api/me');
    adoptLoadout(me.loadout);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) setToken(null);
    else throw error;
  }
  return me;
}

async function enter(path: string, body: unknown): Promise<MeResponse | null> {
  const session = await request<AuthResponse>('POST', path, body);
  setToken(session.token);
  return refreshAccount();
}

export const loginAsGuest = (name: string): Promise<MeResponse | null> =>
  enter('/api/auth/guest', { name });
export const login = (form: Record<string, string>): Promise<MeResponse | null> =>
  enter('/api/auth/login', form);
/** Cria conta com e-mail; se a sessão atual é de convidado, ela é promovida. */
export const register = (form: Record<string, string>): Promise<MeResponse | null> =>
  enter('/api/auth/register', form);

export function logout(): void {
  setToken(null);
}

/** Grava o loadout na conta. O servidor recusa item que a conta não possui. */
export async function saveAccountLoadout(loadout: Loadout): Promise<void> {
  if (!token) return;
  await request('PUT', '/api/loadout', { loadout });
  if (me) me.loadout = { ...loadout };
}

export const fetchRanking = async (): Promise<RankingEntry[]> =>
  (await request<{ ranking: RankingEntry[] }>('GET', '/api/ranking')).ranking;

export const queue = {
  join: (): Promise<QueueStatus> => request('POST', '/api/queue/join'),
  status: (): Promise<QueueStatus> => request('GET', '/api/queue/status'),
  leave: (): Promise<unknown> => request('POST', '/api/queue/leave'),
};
