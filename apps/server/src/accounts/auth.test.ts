import { COSMETIC_ITEMS, filterOwnedCosmetics } from '@kart/shared';
import { describe, expect, it } from 'vitest';
import {
  ageOn,
  hashPassword,
  HttpError,
  parseBirthDate,
  parseRegistration,
  signToken,
  verifyPassword,
  verifyToken,
} from './auth.js';
import { createGoogleVerifier, identityFromClaims } from './google.js';

const NOW = new Date('2026-11-12T12:00:00Z');
const form = (extra: Record<string, unknown> = {}) => ({
  email: ' Piloto@Exemplo.com ',
  password: 'kart-teste-123',
  birthDate: '2000-05-20',
  ...extra,
});
const statusOf = (run: () => unknown): number => {
  try {
    run();
  } catch (error) {
    return error instanceof HttpError ? error.status : -1;
  }
  return 200;
};

describe('senha e sessão', () => {
  it('a senha é guardada só como hash e confere', () => {
    const stored = hashPassword('kart-teste-123');
    expect(stored).not.toContain('kart-teste-123');
    expect(hashPassword('kart-teste-123')).not.toBe(stored); // sal aleatório
    expect(verifyPassword('kart-teste-123', stored)).toBe(true);
    expect(verifyPassword('kart-teste-124', stored)).toBe(false);
    expect(verifyPassword('x', 'lixo')).toBe(false);
  });

  it('token assinado: aceita o verdadeiro, recusa adulterado, vencido ou de outro segredo', () => {
    const token = signToken('user-1', 'segredo', NOW.getTime());
    expect(verifyToken(token, 'segredo', NOW.getTime())).toBe('user-1');
    expect(verifyToken(token, 'outro', NOW.getTime())).toBeNull();
    const forged = Buffer.from(JSON.stringify({ sub: 'admin', exp: 9e15 })).toString('base64url');
    expect(verifyToken(`${forged}.${token.split('.')[1]}`, 'segredo', NOW.getTime())).toBeNull();
    expect(verifyToken(token, 'segredo', NOW.getTime() + 31 * 86_400_000)).toBeNull();
    expect(verifyToken(undefined, 'segredo')).toBeNull();
  });
});

describe('cadastro e regras de idade', () => {
  it('normaliza o e-mail e aceita maiores de 13', () => {
    const parsed = parseRegistration(form(), NOW);
    expect(parsed.email).toBe('piloto@exemplo.com');
    expect(ageOn(parsed.birthDate, NOW)).toBe(26);
  });

  it('idade conta o aniversário', () => {
    expect(ageOn(new Date('2013-11-12T00:00:00Z'), NOW)).toBe(13);
    expect(ageOn(new Date('2013-11-13T00:00:00Z'), NOW)).toBe(12);
  });

  it('menor de 13 não cria conta; dados ruins são recusados', () => {
    expect(statusOf(() => parseRegistration(form({ birthDate: '2013-11-13' }), NOW))).toBe(403);
    expect(statusOf(() => parseRegistration(form({ birthDate: '2013-11-12' }), NOW))).toBe(200);
    expect(statusOf(() => parseRegistration(form({ birthDate: '2030-01-01' }), NOW))).toBe(400);
    expect(statusOf(() => parseRegistration(form({ birthDate: '12/05/2000' }), NOW))).toBe(400);
    expect(statusOf(() => parseRegistration(form({ email: 'sem-arroba' }), NOW))).toBe(400);
    expect(statusOf(() => parseRegistration(form({ password: 'curta' }), NOW))).toBe(400);
  });
});

describe('inventário', () => {
  it('o seed tem os 12 cosméticos pedidos', () => {
    const count = (slot: string) => COSMETIC_ITEMS.filter((item) => item.slot === slot).length;
    expect(COSMETIC_ITEMS).toHaveLength(12);
    expect([
      count('helmetPaint'),
      count('livery'),
      count('suit'),
      count('rim'),
      count('trail'),
    ]).toEqual([3, 3, 2, 2, 2]);
    expect(new Set(COSMETIC_ITEMS.map((item) => item.id)).size).toBe(12);
  });

  it('item de catálogo que o jogador não possui sai do loadout; o básico fica', () => {
    const owned = new Set(['livery:vermelho']);
    const wanted = { livery: 'vermelho', suit: 'largada', trail: 'azul', gloves: 'pretas' };
    expect(filterOwnedCosmetics(wanted, owned)).toEqual({ livery: 'vermelho', gloves: 'pretas' });
  });
});

describe('entrar com Google', () => {
  const claims = { sub: '123', email: 'Ana@Gmail.com ', email_verified: true, name: 'Ana' };

  it('aproveita só o identificador, o e-mail normalizado e o nome', () => {
    expect(identityFromClaims(claims)).toEqual({ sub: '123', email: 'ana@gmail.com', name: 'Ana' });
  });

  it('recusa token sem identificador, sem e-mail ou com e-mail não confirmado', () => {
    expect(() => identityFromClaims({ ...claims, sub: '' })).toThrow(HttpError);
    expect(() => identityFromClaims({ ...claims, email: undefined })).toThrow(HttpError);
    expect(() => identityFromClaims({ ...claims, email_verified: false })).toThrow(HttpError);
  });

  it('sem Client ID configurado, o login Google responde que está desligado', async () => {
    await expect(createGoogleVerifier(undefined)('qualquer')).rejects.toMatchObject({
      status: 503,
    });
  });

  it('data de nascimento: recusa menor de 13 e data inválida', () => {
    const now = new Date('2026-06-01T12:00:00Z');
    expect(parseBirthDate('2000-01-01', now).getUTCFullYear()).toBe(2000);
    expect(() => parseBirthDate('2020-01-01', now)).toThrow(HttpError);
    expect(() => parseBirthDate('ontem', now)).toThrow(HttpError);
  });
});
