// Teste de fumaça de contas e Ranqueado contra o servidor de verdade (pnpm dev):
// convidado, cadastro, login, inventário, loadout, fila e uma partida ranqueada
// de 2 contas que termina com o rating gravado no banco.
// Uso: node tools/account-smoke.mjs [http://localhost:2567] [--sem-corrida]
/* global fetch, setInterval, clearInterval, setTimeout */
import { randomBytes } from 'node:crypto';
import { Client } from 'colyseus.js';
import * as kart from '../packages/shared/dist/index.js';

const base =
  process.argv.find((arg) => arg.startsWith('http')) ??
  `http://localhost:${kart.SERVER_DEFAULT_PORT}`;
const skipRace = process.argv.includes('--sem-corrida');
const track = kart.getCircuitoDaOrla();
const problems = [];
const check = (ok, what) => {
  console.log(`${ok ? '  ok ' : 'FALHA'} ${what}`);
  if (!ok) problems.push(what);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(method, path, { token, body } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json() };
}

const tag = randomBytes(4).toString('hex');
const password = randomBytes(9).toString('base64url');
const account = (n) => ({
  email: `piloto-${tag}-${n}@teste.local`,
  password,
  name: `Teste ${n}`,
  birthDate: '1998-03-10',
});

// Convidado
const guest = await api('POST', '/api/auth/guest', { body: { name: 'Visitante' } });
check(guest.status === 200 && guest.data.user.guest === true, 'convidado entra só com apelido');
const guestMe = await api('GET', '/api/me', { token: guest.data.token });
const starters = kart.COSMETIC_ITEMS.filter((item) => item.starter).length;
check(
  guestMe.data.inventory?.length === starters,
  `convidado recebe os ${starters} itens iniciais`,
);
const guestQueue = await api('POST', '/api/queue/join', { token: guest.data.token });
check(guestQueue.status === 403, 'convidado não entra no Ranqueado');

// Cadastro e login
const child = await api('POST', '/api/auth/register', {
  body: { ...account(0), birthDate: '2020-01-01' },
});
check(child.status === 403, 'menor de 13 não cria conta');
const first = await api('POST', '/api/auth/register', { body: account(1) });
check(first.status === 200 && first.data.user.guest === false, 'cadastro com e-mail');
const repeated = await api('POST', '/api/auth/register', { body: account(1) });
check(repeated.status === 409, 'e-mail repetido é recusado');
const wrong = await api('POST', '/api/auth/login', {
  body: { email: account(1).email, password: 'errada-123' },
});
check(wrong.status === 401, 'senha errada é recusada');
const login = await api('POST', '/api/auth/login', { body: account(1) });
check(
  login.status === 200 && login.data.user.id === first.data.user.id,
  'login devolve a mesma conta',
);
check((await api('GET', '/api/me')).status === 401, 'sem sessão não há perfil');
const promoted = await api('POST', '/api/auth/register', {
  token: guest.data.token,
  body: account(2),
});
check(promoted.data.user?.id === guest.data.user.id, 'convidado vira conta sem perder o perfil');

// Inventário e loadout
const tokenA = login.data.token;
const tokenB = promoted.data.token;
const owned = await api('PUT', '/api/loadout', {
  token: tokenA,
  body: {
    loadout: {
      livery: 'vermelho',
      suit: 'mare',
      gloves: 'pretas',
      rim: 'grafite',
      trail: 'branca',
    },
  },
});
check(owned.status === 200, 'equipa itens que possui');
const locked = await api('PUT', '/api/loadout', {
  token: tokenA,
  body: { loadout: { livery: 'verde' } },
});
check(locked.status === 403, 'não equipa item que não possui');
const me = await api('GET', '/api/me', { token: tokenA });
check(me.data.loadout?.livery === 'vermelho', 'loadout fica gravado na conta');
check(
  me.data.rating?.division === null && me.data.rating?.placementLeft === 5,
  'conta nova está em posicionamento',
);
const grant = await api('POST', '/api/admin/grant', {
  body: { user: account(1).email, item: 'livery:verde' },
});
check(grant.status === 403, 'concessão exige chave de administrador');
check(
  (await api('POST', '/api/payments/webhook')).status === 501,
  'webhook de pagamento é só um stub',
);

if (!skipRace) {
  // Fila ranqueada: com 2 na fila a partida sai depois de 60 s.
  console.log('fila ranqueada: esperando a partida (cerca de 1 min)…');
  await api('POST', '/api/queue/join', { token: tokenA });
  await api('POST', '/api/queue/join', { token: tokenB });
  const reservations = [];
  for (const token of [tokenA, tokenB]) {
    let status;
    for (let i = 0; i < 90; i++) {
      status = (await api('GET', '/api/queue/status', { token })).data;
      if (status.state !== 'waiting') break;
      await sleep(1000);
    }
    reservations.push(status?.reservation);
  }
  check(reservations.every(Boolean), 'a fila formou a partida para as duas contas');

  const intruder = await new Client(base.replace('http', 'ws'))
    .joinById(reservations[0].room.roomId, { mode: 'ranked', ticket: 'falso' })
    .then(
      () => true,
      () => false,
    );
  check(!intruder, 'sem bilhete da fila ninguém entra na sala ranqueada');
  const fake = await new Client(base.replace('http', 'ws'))
    .create(kart.ROOM_NAME, { mode: 'ranked', tickets: { x: first.data.user.id } })
    .then(
      () => true,
      () => false,
    );
  check(!fake, 'cliente não consegue criar sala ranqueada');

  const results = await Promise.all(
    reservations.map(async (reservation, index) => {
      const room = await new Client(base.replace('http', 'ws')).consumeSeatReservation(reservation);
      const plan = kart.createBotPlan(track, 0.8 - index * 0.25);
      let you = -1;
      let snapshot = null;
      let seq = 0;
      room.onMessage(kart.MESSAGES.snapshot, (message) => (snapshot = message));
      room.onMessage(kart.MESSAGES.pong, () => {});
      room.send(kart.MESSAGES.ready, { ready: true });
      const timer = setInterval(() => {
        const own = snapshot?.karts[you];
        if (!own) return;
        const input =
          snapshot.tick < snapshot.goTick ? kart.NO_INPUT : kart.botInput(own, track, plan);
        room.send(kart.MESSAGES.input, { seq: seq++, ...input });
      }, 1000 / kart.SIM_HZ);
      return new Promise((resolve) => {
        room.onMessage(kart.MESSAGES.room, (message) => {
          you = message.you;
          if (message.results) {
            clearInterval(timer);
            resolve({ you, results: message.results, mode: message.mode });
          }
        });
      });
    }),
  );
  check(
    results[0].mode === 'ranked' && results[0].results.length === 2,
    'corrida ranqueada só com humanos',
  );
  await sleep(1500);

  const after = await Promise.all(
    [tokenA, tokenB].map((token) => api('GET', '/api/me', { token })),
  );
  const positions = results.map((r) => r.results.find((entry) => entry.slot === r.you).position);
  after.forEach((profile, i) => {
    const last = profile.data.history[0];
    console.log(
      `  conta ${i + 1}: ${positions[i]}º, ${profile.data.rating.points} pts, variação ${last?.pointsDelta}`,
    );
    check(
      profile.data.rating.matches === 1 && profile.data.rating.placementLeft === 4,
      `conta ${i + 1}: partida contou no rating`,
    );
    check(
      last?.mode === 'ranked' && last.position === positions[i],
      `conta ${i + 1}: histórico bate com o resultado do servidor`,
    );
  });
  const winner = positions.indexOf(1);
  check(
    after[winner].data.rating.points >= after[1 - winner].data.rating.points,
    'quem venceu tem mais pontos',
  );
  const ranking = (await api('GET', '/api/ranking')).data.ranking;
  check(
    ranking.some((row) => row.name === `Teste ${winner + 1}`),
    'vencedor aparece no ranking da temporada',
  );
}

if (problems.length > 0) {
  console.error(`FALHOU: ${problems.length} problema(s)`);
  process.exit(1);
}
console.log('OK: contas, inventário e Ranqueado funcionando.');
process.exit(0);
