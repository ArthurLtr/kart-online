# Kart Online

Jogo de corrida de kart multiplayer para navegador: 9 pilotos por corrida, uma pista (Circuito da Orla), física simcade e servidor autoritativo. Sem itens, power-ups ou boost — ganha quem pilota melhor. Cosméticos nunca mudam a física.

## Como rodar

Requisitos: Node 20+ e pnpm 9.

```bash
pnpm install
```

```bash
pnpm assets
```

```bash
pnpm dev
```

- `pnpm assets` converte os modelos de `referencias/` para GLB em `apps/client/public/assets` (a pasta `referencias/` nunca entra no build).
- `pnpm dev` sobe o cliente em http://localhost:5173 e o servidor em http://localhost:2567. Sem Docker, o servidor inicia sozinho um PostgreSQL embutido (dados em `apps/server/.data/pg`; `pnpm db:stop` desliga). Com Docker, `pnpm db:up` sobe Postgres e Redis do `docker-compose.yml`.
- Copie `.env.example` para `.env` para mudar porta, banco, Redis, segredo de sessão e regras do Ranqueado. Sem `REDIS_URL` a fila fica na memória do servidor.

Outros comandos:

| Comando                                        | O que faz                                                               |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| `pnpm test`                                    | Testes (Vitest) de simulação, rede, contas, ranqueado e UI              |
| `pnpm lint` / `pnpm format`                    | ESLint e Prettier                                                       |
| `pnpm build`                                   | Cliente estático em `apps/client/dist` e servidor em `apps/server/dist` |
| `node tools/net-smoke.mjs`                     | 9 clientes de verdade correndo contra o servidor local                  |
| `node tools/account-smoke.mjs [--sem-corrida]` | Contas, inventário e uma partida ranqueada completa                     |
| `node tools/sim-report.mjs`                    | Números da física (velocidade máxima, tempo de volta dos bots)          |

## Como testar o jogo

1. Abra http://localhost:5173. O menu mostra o seu kart girando; **Jogar** abre Casual, Ranqueado, Treino e Sala privada.
2. **Treino**: sozinho contra o relógio. `P` liga o piloto automático, `R` recomeça, `Esc` volta ao menu.
3. **Casual**: entra numa sala e completa o grid com bots. Para testar 9 jogadores, abra 9 abas.
4. **Sala privada**: cria uma sala com código de convite.
5. **Ranqueado**: exige conta com e-mail (aba Perfil). Com 2 contas na fila a partida sai em 60 s.
6. Na corrida, `F3` abre o painel de rede (ping, correções, draw calls) com simulação de latência e perda.
7. **Configurações**: preset gráfico (Baixo/Médio/Alto/Ultra, com sugestão pela placa de vídeo), volume, música e remapeamento de teclas. Gamepad funciona pelo layout padrão (analógico vira, RT acelera, LT freia, A drift, RB olha para trás).

Controles padrão: `W`/`↑` acelera, `S`/`↓` freia e dá ré, `A` `D`/`←` `→` vira, `Espaço` drift, `Shift` olha para trás.

## Arquitetura

```
packages/shared   Simulação determinística (60 Hz), pista, regras, bots, protocolo de rede
apps/server       Colyseus + Express + Prisma: salas, contas, ranqueado, matchmaking
apps/client       Three.js + Vite: telas, renderização, predição e interpolação
tools/            Conversão de assets e testes de fumaça
docs/             Inventário da pasta referencias/
```

**`packages/shared`** é a única fonte da verdade da corrida. `stepRace` avança todos os karts um tick, a partir das entradas, sem relógio nem aleatoriedade fora da semente. O servidor e o cliente rodam exatamente o mesmo código. A simulação não recebe cosméticos: um teste prova que dois karts com visuais diferentes produzem estados idênticos.

**`apps/server`**

- `rooms/RaceRoom.ts` + `game/RaceSession.ts`: sala de 9, lobby → corrida → resultado → pódio, bots, reconexão em 30 s. O servidor simula a 60 Hz e envia snapshots a 30 Hz; a classificação é sempre a dele.
- `accounts/`: convidado, cadastro com e-mail (idade mínima 13), senha com scrypt, sessão por token HMAC.
- `ranked/`: rating OpenSkill, divisões, temporadas e fila por faixa de pontos (Redis ou memória). Só o servidor cria salas ranqueadas; entra-se com bilhete de uso único.
- `http/api.ts`: rotas REST de conta, loadout, ranking e fila. `payments/` é só a interface e o webhook stub.
- `prisma/schema.prisma`: usuários, ratings, partidas, voltas, cosméticos e inventário.

**`apps/client`**

- `screens/`: uma tela ativa por vez (`menu`, `treino`, `corrida`, `garagem`, `conta`, `config`, `pista`), escolhida pelo hash da URL. Cada tela entrega cena, câmera, `update` e `dispose`.
- `game/raceView.ts`: tudo o que aparece numa corrida. Não sabe de onde vêm os estados — o Treino usa a simulação local e a corrida online usa `net/prediction.ts` (kart próprio, com reconciliação) e `net/interpolation.ts` (os outros, 100 ms atrás).
- `track/`: pista montada a partir do spline de `shared` (piso, barreiras, cenário, mar).
- `models/`: de onde vêm os modelos 3D (ver abaixo). `cosmetics/`: catálogo e aplicação do loadout.
- `render/`: renderizador, luz, céu, pós-processamento e estúdio da garagem. `settings.ts`: presets gráficos, áudio e teclas.
- `ui/`: HUD (posição, volta, tempos, velocímetro, conta-giros, minimapa do spline), nomes sobre os karts e painel de rede.

### Desempenho

- Presets em `apps/client/src/settings.ts`: sombras, pós-processamento, densidade do cenário e resolução de renderização.
- Cenário repetido usa `InstancedMesh`; a geometria estática da pista é mesclada e tem as matrizes congeladas.
- Peças pequenas dos karts adversários não projetam sombra (cada uma custava um draw call).
- Medido com 9 karts no grid, preset Alto: 269 draw calls (meta: menos de 300).
- Toda tela libera geometrias, materiais e texturas no `dispose`.

## Como trocar um modelo procedural por GLB

A cena nunca cria modelos diretamente: pede ao `ModelProvider` (`apps/client/src/models/`). O provider padrão tenta o GLB primeiro e cai no procedural se o arquivo não existir. Hoje o kart é GLB (convertido de `referencias/`); piloto e capacete são procedurais, mas a bota e a luva do piloto (`pilot_gear.glb`) e as árvores da pista (`trees.glb`) também vêm de `referencias/`. `node tools/assets/convert.mjs gear trees` reconverte só essas peças.

Para trocar, por exemplo, o piloto procedural por um modelo:

1. Coloque o modelo original (FBX, OBJ ou GLB) em `referencias/`.
2. Registre a conversão em `tools/assets/convert.mjs`, seguindo o que já existe para o kart, e rode `pnpm assets`. O GLB sai em `apps/client/public/assets/models/`.
3. O GLB precisa cumprir o contrato descrito em `models/ModelProvider.ts`:
   - escala em metros e frente para **+Z**;
   - pivô do kart no chão, no centro do eixo traseiro; do piloto no chão, entre os pés; do capacete no centro da cabeça;
   - partes com os nomes de `KART_PARTS`, `PILOT_PARTS` ou `HELMET_PARTS` (em `packages/shared`), porque rodas, volante e cosméticos encontram as peças pelo nome.
4. Acrescente o arquivo à lista do `GlbModelProvider.ts`. Nenhuma outra linha muda: enquanto o GLB existir ele é usado; se for apagado, o procedural volta sozinho.
5. Atualize `docs/inventario-assets.md` com a origem e a licença do modelo e confira o resultado na Garagem, que mostra as imagens de referência ao lado em desenvolvimento.

## Limitações conhecidas

- A pista, o corpo do piloto e o capacete são procedurais porque `referencias/` não tem modelo dessas peças (motivos no inventário). Bota, luva e árvores são modelos convertidos.
- As licenças da bota, da luva e das árvores em `referencias/` também precisam ser confirmadas antes de uso público.
- A licença do modelo do kart em `referencias/` precisa ser confirmada antes de qualquer uso público.
- A fila em Redis foi testada com `ioredis-mock`, não com um Redis de verdade.
- Texturas ainda não usam KTX2; o som é todo sintetizado em WebAudio (não há arquivos de áudio).
- Não há loja: o inventário é concedido por seed ou pela rota de administração.
