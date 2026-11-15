import { describe, expect, it } from 'vitest';
import { SERVER_DEFAULT_PORT } from '@kart/shared';
import { resolvePort } from './config.js';

describe('porta do servidor', () => {
  it('SERVER_PORT sempre vence', () => {
    expect(resolvePort({ SERVER_PORT: '3000', PORT: '8080', NODE_ENV: 'production' })).toBe(3000);
    expect(resolvePort({ SERVER_PORT: '2567 ', PORT: '5173' })).toBe(2567);
  });

  it('PORT só vale em produção', () => {
    expect(resolvePort({ PORT: '5173' })).toBe(SERVER_DEFAULT_PORT);
    expect(resolvePort({ PORT: '8080', NODE_ENV: 'production' })).toBe(8080);
  });

  it('valor inválido cai no padrão', () => {
    expect(resolvePort({ SERVER_PORT: 'abc' })).toBe(SERVER_DEFAULT_PORT);
    expect(resolvePort({ SERVER_PORT: '' })).toBe(SERVER_DEFAULT_PORT);
    expect(resolvePort({})).toBe(SERVER_DEFAULT_PORT);
  });
});
