# Colocar o Kart Online no ar

Em produção um **processo só** faz tudo, num endereço só:

- entrega o jogo (o cliente compilado);
- responde a API de contas, loja e fila (`/api/...`);
- mantém o WebSocket das corridas.

Por isso não há CORS para configurar nem porta extra para abrir. A imagem vem do `Dockerfile` da raiz.

## O que é preciso

| Peça                                  | Para quê                                          | Exemplos                                                  |
| ------------------------------------- | ------------------------------------------------- | --------------------------------------------------------- |
| Hospedagem de contêiner com WebSocket | roda a imagem                                     | Railway, Render, Fly.io, um VPS com Docker                |
| PostgreSQL 14 ou mais novo            | contas, partidas, loja                            | o da própria hospedagem, Neon, Supabase                   |
| Redis (recomendado)                   | fila de pareamento que sobrevive a reinícios      | o da própria hospedagem, Upstash                          |
| Domínio com HTTPS                     | o navegador só abre `wss://` em página `https://` | a hospedagem costuma dar um `*.up.railway.app` ou similar |

Rode **uma instância** do servidor. As salas de corrida vivem na memória do processo, então mais de uma instância exige o modo multi-processo do Colyseus, que este projeto ainda não usa.

## Variáveis de ambiente

Obrigatórias:

| Variável       | Valor                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` | `postgresql://usuario:senha@host:5432/banco` (com `?sslmode=require` se o provedor exigir)                                                     |
| `AUTH_SECRET`  | texto aleatório longo. Gere com `node -e "console.log(crypto.randomBytes(48).toString('base64url'))"`. Trocar depois derruba todas as sessões. |

A imagem já define `NODE_ENV=production`, `PORT=8080`, `CLIENT_DIR` e `TRUST_PROXY=1`.

Recomendadas:

| Variável                     | Valor                                   |
| ---------------------------- | --------------------------------------- |
| `REDIS_URL`                  | `redis://...` ou `rediss://...`         |
| `RANKED_MIN_PLAYERS`         | humanos mínimos no Ranqueado (padrão 2) |
| `SEASON_NAME`, `SEASON_DAYS` | nome e duração da temporada             |

Opcionais:

| Variável                                                 | Valor                                                                                                                                     |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`                                       | liga "Entrar com Google". No Google Cloud Console, ponha o endereço do jogo (`https://seu-dominio`) em "Origens JavaScript autorizadas".  |
| `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `PUBLIC_API_URL` | liga a loja de gemas por Pix. `PUBLIC_API_URL` é o próprio endereço do jogo, e o webhook fica em `<PUBLIC_API_URL>/api/webhooks/payment`. |
| `ADMIN_KEY`                                              | liga as rotas de administração                                                                                                            |
| `ALLOWED_ORIGINS`                                        | só se outro site precisar chamar a API (separe por vírgula). Sem ela, a produção só aceita o próprio endereço.                            |

## Banco: migrações

Ao ligar em produção, o servidor roda `prisma migrate deploy`. Esse comando aplica só as migrações versionadas em `apps/server/prisma/migrations` e nunca apaga dados. Com isso, o primeiro deploy já cria todas as tabelas sozinho.

Se você mudar o `schema.prisma`:

1. Com o banco de desenvolvimento no ar (`pnpm dev`), rode:

   ```bash
   pnpm --filter @kart/server db:migration nome_da_mudanca
   ```

2. Confira o SQL gerado em `apps/server/prisma/migrations/<data>_nome_da_mudanca/migration.sql` e faça o commit.
3. No próximo deploy, o servidor aplica a migração.

## Passo a passo no Railway (exemplo)

1. Em railway.com, crie um projeto com **Deploy from GitHub repo** e escolha `kart-online`. O Railway acha o `Dockerfile` sozinho.
2. No mesmo projeto, use **+ New** para adicionar **Database → PostgreSQL** e depois **Database → Redis**.
3. No serviço do jogo, abra **Variables** e preencha:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `REDIS_URL` = `${{Redis.REDIS_URL}}`
   - `AUTH_SECRET` = o texto aleatório gerado acima
4. Em **Settings → Networking**, use **Generate Domain** (ou ligue o seu domínio). A porta é `8080`.
5. Em **Settings → Deploy**, ponha `/health` no healthcheck.
6. Abra o domínio gerado: é o link do jogo para mandar aos amigos.

Em Render e Fly.io o processo é o mesmo: imagem do `Dockerfile`, Postgres, Redis, as variáveis acima, porta 8080 e healthcheck em `/health`.

## Testar a imagem localmente (com Docker)

```bash
docker compose up -d
```

```bash
docker build -t kart-online .
```

```bash
docker run --rm -p 8080:8080 -e AUTH_SECRET=teste-local-troque -e DATABASE_URL=postgresql://kart:kart_dev@host.docker.internal:5432/kart_online kart-online
```

Depois abra http://localhost:8080.

## Depois do primeiro deploy

- Crie uma conta, corra uma partida Casual e confira em `/health` se aparece `"accounts": true`.
- Ative o backup automático do Postgres no provedor.
- Os logs saem no terminal do contêiner: `[banco]`, `[fila]`, `[loja]` e `[sala ...]`.
