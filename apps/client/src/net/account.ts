import type {
  AuthResponse,
  Cosmetics,
  Currency,
  CustomPaint,
  GoogleProfileNeeded,
  MeResponse,
  OrderView,
  PublicConfig,
  QueueKind,
  QueueStatus,
  RankingEntry,
} from '@kart/shared';
import { DEFAULT_ITEM_IDS, SERVER_DEFAULT_PORT } from '@kart/shared';
import type { Loadout } from '../cosmetics/catalog';
import { CATALOG, DEFAULT_LOADOUT, loadLoadout, saveLoadout } from '../cosmetics/catalog';
import type { KartPaint } from '../cosmetics/paint';
import { sanitizePaint, savePaint } from '../cosmetics/paint';
import type { Preset } from '../cosmetics/presets';
import { presetsData, savePresets, toPresets } from '../cosmetics/presets';

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

/** Antes do kart inicial, valem os itens básicos; depois, só o inventário. */
const usable = (): readonly string[] => (me && me.user.onboarded ? me.inventory : DEFAULT_ITEM_IDS);

/** A conta pode usar este item do catálogo (id "slot:chave"). */
export const ownsItem = (itemId: string): boolean => usable().includes(itemId);

/** Falso para item que a conta não possui (ou, no kart inicial, que não é básico). */
export const isUnlocked = (slot: string, id: string): boolean => ownsItem(`${slot}:${id}`);

/** Verdadeiro enquanto a conta ainda não confirmou o kart inicial. */
export const needsOnboarding = (): boolean => me !== null && !me.user.guest && !me.user.onboarded;

/** O loadout da conta passa a valer neste navegador também (treino, garagem). */
function adoptLoadout(remote: Cosmetics): void {
  const loadout = loadLoadout();
  for (const slot of Object.keys(loadout) as (keyof Loadout)[]) {
    const id = remote[slot];
    if (id && CATALOG[slot].some((item) => item.id === id)) loadout[slot] = id;
    if (!isUnlocked(slot, loadout[slot])) loadout[slot] = DEFAULT_LOADOUT[slot];
  }
  saveLoadout(loadout);
}

/** Recarrega o perfil. Sessão vencida ou inválida é descartada. */
export async function refreshAccount(): Promise<MeResponse | null> {
  if (!token) return null;
  try {
    me = await request<MeResponse>('GET', '/api/me');
    adoptLoadout(me.loadout);
    if (me.paint !== undefined) {
      savePaint(sanitizePaint(me.paint));
      savePresets(toPresets(me.presets));
    }
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

/** Verdadeiro com conta completa (e-mail ou Google). Sem isso não se passa da tela de entrada. */
export const hasAccount = (): boolean => me !== null && !me.user.guest;

let publicConfig: Promise<PublicConfig> | null = null;
/** Configuração pública do servidor (Client ID do Google). */
export function fetchPublicConfig(): Promise<PublicConfig> {
  publicConfig ??= request<PublicConfig>('GET', '/api/config').catch((error: unknown) => {
    publicConfig = null;
    throw error;
  });
  return publicConfig;
}

/**
 * Entrar com Google. `credential` é o token de identidade que o botão do Google
 * devolve; o servidor confere a assinatura. Em conta nova o servidor pede
 * apelido e nascimento (`needsProfile`) e a chamada é repetida com `profile`.
 */
export async function loginWithGoogle(
  credential: string,
  profile: Record<string, string> = {},
): Promise<MeResponse | GoogleProfileNeeded | null> {
  const result = await request<AuthResponse | GoogleProfileNeeded>('POST', '/api/auth/google', {
    ...profile,
    credential,
  });
  if ('needsProfile' in result) return result;
  setToken(result.token);
  return refreshAccount();
}

/** Compra um item com moedas ou gemas e recarrega o perfil. */
export async function purchaseItem(itemId: string, currency: Currency): Promise<MeResponse | null> {
  await request('POST', '/api/garage/purchase', { itemId, currency });
  return refreshAccount();
}

/** Confirma o kart inicial (só itens básicos): o servidor entrega os itens e grava o visual. */
export async function confirmStarterKart(
  loadout: Loadout,
  paint: KartPaint | null,
): Promise<MeResponse | null> {
  await request('POST', '/api/garage/onboarding', { loadout, paint });
  return refreshAccount();
}

/** Pede um Pix para um pacote de gemas. */
export const createGemOrder = (packageId: string): Promise<OrderView> =>
  request('POST', '/api/store/create-order', { packageId });

/** Estado de um pedido de gemas; quando sai pago, o perfil é recarregado. */
export async function fetchGemOrder(orderId: string): Promise<OrderView> {
  const order = await request<OrderView>(
    'GET',
    `/api/store/order?id=${encodeURIComponent(orderId)}`,
  );
  if (order.status === 'PAID') await refreshAccount();
  return order;
}

/** Só no servidor de desenvolvimento (Pix de mentira): marca o pedido como pago. */
export async function devPayOrder(orderId: string): Promise<OrderView> {
  const order = await request<OrderView>('POST', '/api/store/dev-pay', { orderId });
  if (order.status === 'PAID') await refreshAccount();
  return order;
}

export const login = (form: Record<string, string>): Promise<MeResponse | null> =>
  enter('/api/auth/login', form);
/** Cria conta com e-mail; conta antiga de convidado é promovida e mantém o progresso. */
export const register = (form: Record<string, string>): Promise<MeResponse | null> =>
  enter('/api/auth/register', form);

export function logout(): void {
  setToken(null);
}

/**
 * Grava na conta o visual aplicado (loadout e pintura livre) e os presets.
 * O servidor recusa item que a conta não possui.
 */
export async function saveAccountLook(
  loadout: Loadout,
  paint: KartPaint | null,
  presets: readonly Preset[],
): Promise<void> {
  if (!token) return;
  const data = presetsData(presets);
  await request('PUT', '/api/loadout', { loadout, paint, presets: data });
  if (me) {
    me.loadout = { ...loadout };
    me.paint = paint as CustomPaint | null;
    me.presets = data;
  }
}

export const fetchRanking = async (): Promise<RankingEntry[]> =>
  (await request<{ ranking: RankingEntry[] }>('GET', '/api/ranking')).ranking;

export const queue = {
  join: (kind: QueueKind): Promise<QueueStatus> =>
    request('POST', '/api/queue/join', { queue: kind }),
  status: (): Promise<QueueStatus> => request('GET', '/api/queue/status'),
  leave: (): Promise<unknown> => request('POST', '/api/queue/leave'),
};
