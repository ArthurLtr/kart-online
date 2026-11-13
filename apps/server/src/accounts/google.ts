import { createRemoteJWKSet, jwtVerify } from 'jose';
import { HttpError } from './auth.js';

/** O que interessa do token de identidade do Google. */
export interface GoogleIdentity {
  /** Identificador estável da conta Google. */
  sub: string;
  email: string;
  name: string;
}

export type GoogleVerifier = (credential: unknown) => Promise<GoogleIdentity>;

const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/** Confere os campos do token já verificado; separado para poder ser testado sem rede. */
export function identityFromClaims(claims: Record<string, unknown>): GoogleIdentity {
  const { sub, email, name } = claims;
  if (typeof sub !== 'string' || !sub || typeof email !== 'string' || !email) {
    throw new HttpError(401, 'Login do Google inválido.');
  }
  // E-mail não confirmado no Google não serve para identificar ninguém.
  if (claims.email_verified !== true && claims.email_verified !== 'true') {
    throw new HttpError(403, 'Confirme o e-mail da sua conta Google antes de entrar.');
  }
  return { sub, email: email.trim().toLowerCase(), name: typeof name === 'string' ? name : '' };
}

/**
 * Verificador do "Entrar com Google": confere a assinatura do token com as
 * chaves públicas do Google, o emissor, a validade e se o token foi emitido
 * para o nosso Client ID. O servidor nunca vê a senha do Google.
 */
export function createGoogleVerifier(clientId: string | undefined): GoogleVerifier {
  if (!clientId) {
    return async () => {
      throw new HttpError(503, 'Login com Google não está configurado neste servidor.');
    };
  }
  const keys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
  return async (credential) => {
    if (typeof credential !== 'string' || credential.length > 4096) {
      throw new HttpError(400, 'Login do Google inválido.');
    }
    try {
      const { payload } = await jwtVerify(credential, keys, {
        issuer: ISSUERS,
        audience: clientId,
      });
      return identityFromClaims(payload);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(401, 'Não consegui confirmar o login do Google. Tente de novo.');
    }
  };
}
