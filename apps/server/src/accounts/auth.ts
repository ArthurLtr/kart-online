import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** Erro com código HTTP e mensagem que pode ser mostrada ao jogador. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const KEY_LENGTH = 64;

/** Senha nunca é guardada: só o resultado do scrypt com sal aleatório. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${scryptSync(password, salt, KEY_LENGTH).toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

const TOKEN_DAYS = 30;
const sign = (payload: string, secret: string): string =>
  createHmac('sha256', secret).update(payload).digest('base64url');

/** Sessão sem estado: id do usuário e validade, assinados com HMAC. */
export function signToken(userId: string, secret: string, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: userId, exp: now + TOKEN_DAYS * 86_400_000 }),
  ).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

/** Devolve o id do usuário, ou `null` se o token é inválido ou venceu. */
export function verifyToken(token: unknown, secret: string, now = Date.now()): string | null {
  if (typeof token !== 'string' || token.length > 512) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      sub?: unknown;
      exp?: unknown;
    };
    if (typeof data.sub !== 'string' || typeof data.exp !== 'number' || data.exp < now) return null;
    return data.sub;
  } catch {
    return null;
  }
}

/** Idade mínima para ter conta com e-mail. */
export const MIN_ACCOUNT_AGE = 13;

/** Idade em anos completos. */
export function ageOn(birthDate: Date, now: Date): number {
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < birthDate.getUTCMonth() ||
    (now.getUTCMonth() === birthDate.getUTCMonth() && now.getUTCDate() < birthDate.getUTCDate());
  if (beforeBirthday) age--;
  return age;
}

export interface Registration {
  email: string;
  password: string;
  birthDate: Date;
}

/** Valida o cadastro; lança HttpError com a mensagem para o jogador. */
export function parseRegistration(body: Record<string, unknown>, now = new Date()): Registration {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'E-mail inválido.');
  }
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < 8 || password.length > 128) {
    throw new HttpError(400, 'A senha precisa ter de 8 a 128 caracteres.');
  }
  const raw = typeof body.birthDate === 'string' ? body.birthDate : '';
  const birthDate = new Date(`${raw}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(birthDate.getTime()) || birthDate > now) {
    throw new HttpError(400, 'Data de nascimento inválida.');
  }
  const age = ageOn(birthDate, now);
  if (age > 120) throw new HttpError(400, 'Data de nascimento inválida.');
  if (age < MIN_ACCOUNT_AGE) {
    throw new HttpError(
      403,
      `É preciso ter ${MIN_ACCOUNT_AGE} anos para criar conta. Você pode jogar como convidado.`,
    );
  }
  return { email, password, birthDate };
}
