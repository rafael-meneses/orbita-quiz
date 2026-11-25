# Órbita

Quiz ao vivo com ranking em tempo real. O apresentador projeta as perguntas no telão e cada pessoa responde pelo celular, sem instalar nada.

| Rota | Quem usa | Para quê |
|---|---|---|
| `/` | Jogadores | Entrar com PIN e apelido (o QR Code do telão já preenche o PIN) |
| `/host` | Apresentador | Criar a partida, mostrar PIN/QR, conduzir as perguntas, ranking, pódio e CSV |
| `/admin` | Organizador | Criar e editar quizzes (texto, imagem, V/F, tempo, pontos), importar e exportar JSON |

As alternativas são identificadas por ícones próprios do tema de exploração espacial: **foguete**, **satélite**, **planeta** e **cometa** ([`web/src/icons.jsx`](web/src/icons.jsx)).

## Deploy com Docker (GHCR + VM)

O workflow [`.github/workflows/docker.yml`](.github/workflows/docker.yml) roda a cada push na `main`, em tags `v*` e em PRs:

1. Builda a imagem e sobe o container com um teste de fumaça (30 jogadores simulados).
2. Fora de PRs, publica em `ghcr.io/<usuario>/<repo>` (amd64 + arm64) com as tags `latest`, `sha-xxxxxxx` e, em tags `v1.2.3`, `1.2.3` e `1.2`.
3. Gera também o front estático como artefato `front-dist`, para quem quiser hospedá-lo numa CDN.

Na primeira publicação o pacote nasce **privado**: em GitHub → seu perfil → *Packages* → o pacote → *Package settings* → *Change visibility* → **Public**, para a VM baixar sem login.

Na VM (com Docker, o domínio apontando para o IP dela e as portas 80 e 443 abertas):

```bash
# copie a pasta deploy/ para a VM
cd deploy
cp .env.example .env   # edite ORBITA_IMAGE, DOMAIN e ADMIN_PASSWORD
docker compose up -d
```

O Caddy emite o certificado HTTPS sozinho e encaminha o WebSocket. Quizzes e imagens ficam no volume `orbita-data`.
Para atualizar: `docker compose pull && docker compose up -d`. **Nunca durante um jogo**: as partidas em andamento ficam em memória e se perdem.

## Front numa CDN (opcional)

O front é estático (`dist/`) e pode ficar numa CDN, com o servidor só como API e tempo real.

1. Compile apontando para o servidor: `VITE_API_URL=https://api.seudominio.com npm run build` (no GitHub Actions, crie a variável de repositório `VITE_API_URL` e use o artefato `front-dist`).
2. Publique `dist/` na CDN e configure o fallback de rotas: `/host` e `/admin` devem servir `index.html`.
3. No servidor, defina `CORS_ORIGINS=https://app.seudominio.com` (domínio do front) e `PUBLIC_URL=https://app.seudominio.com` (endereço do QR Code). Se quiser que o servidor não sirva mais o front, use `SERVE_FRONT=false`.
4. Na CDN, aplique cabeçalhos de segurança equivalentes aos de [`server/security.js`](server/security.js), trocando `connect-src 'self'` por `connect-src 'self' https://api.seudominio.com wss://api.seudominio.com`.

## Rodar sem Docker

```bash
npm install
npm run build
NODE_ENV=production ADMIN_PASSWORD=uma-senha-forte PUBLIC_URL=https://orbita.seudominio.com npm start
```

| Variável | Padrão | Uso |
|---|---|---|
| `ADMIN_PASSWORD` | — | Senha do `/admin` e do `/host`. **Obrigatória** com `NODE_ENV=production` (o servidor não sobe sem ela). Em desenvolvimento, usa `admin`. |
| `PUBLIC_URL` | — | Endereço que aparece no telão e no QR. Sem ele, mostra o IP da rede local (editável na tela do lobby). |
| `CORS_ORIGINS` | — | Domínios de front hospedados fora do servidor, separados por vírgula. |
| `SERVE_FRONT` | `true` | `false` para o servidor atender só API e WebSocket. |
| `PORT` | `3000` | Porta HTTP. |
| `DATA_DIR` | `server/data` | Quizzes e imagens enviadas. Faça backup. |

Use HTTPS com proxy reverso que encaminhe WebSocket (`Upgrade`) e mantenha **uma única instância**: o estado das partidas fica em memória.

## Segurança

- O navegador recebe um token de sessão (12 h) no login; a senha nunca fica salva no navegador.
- Login bloqueado por 15 min após 8 tentativas erradas por IP; PINs errados também são limitados por IP.
- Cada conexão controla no máximo um jogador; o apresentador pode remover jogadores no lobby.
- Uploads aceitam só PNG, JPG, GIF e WEBP, conferidos pela assinatura do arquivo.
- Cabeçalhos de segurança (CSP, `frame-ancestors 'none'`, `nosniff`, HSTS atrás de HTTPS).
- `/api/info` só lista IPs da rede quando `PUBLIC_URL` não está definido.

## Desenvolvimento

```bash
npm run dev:server   # API + Socket.IO em :3000
npm run dev:web      # Vite em :5173 (proxy para :3000)
npm run test:bots -- 100 http://localhost:3000 admin   # simula 100 jogadores jogando um quiz
```

## Regras de jogo

- Acerto vale `pontos × (1 − tempo_gasto / tempo_total / 2)` (50% a 100% dos pontos) + 50 por acerto consecutivo anterior (máx. 250).
- O tempo é medido no servidor; a alternativa correta só é enviada na revelação.
- Jogadores que perdem a conexão (bloqueio de tela etc.) retomam sozinhos; o apresentador também pode recarregar a página.
- Apelidos duplicados ou ofensivos são recusados.
