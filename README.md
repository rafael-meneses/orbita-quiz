# Órbita

Quiz ao vivo com ranking em tempo real. O apresentador projeta as perguntas no telão e cada pessoa responde pelo celular, sem instalar nada.

| Rota | Quem usa | Para quê |
|---|---|---|
| `/` | Jogadores | Entrar com PIN e apelido (o QR Code do telão já preenche o PIN) |
| `/host` | Apresentador | Entrar com usuário e senha, criar a partida, mostrar PIN/QR, conduzir as perguntas, ranking, pódio e CSV |
| `/admin` | Apresentador e administrador | Painel: quizzes (texto, imagem, V/F, tempo, pontos, duplicar, importar/exportar JSON), troca de senha e, para administradores, cadastro de apresentadores |

As alternativas são identificadas por ícones próprios do tema de exploração espacial: **foguete**, **satélite**, **planeta** e **cometa** ([`web/src/icons.jsx`](web/src/icons.jsx)).

## Usuários e permissões

- **Administrador:** gerencia apresentadores (criar, desativar, redefinir senha, trocar papel, excluir) e enxerga e edita os quizzes de todos.
- **Apresentador:** cria, edita, duplica e conduz **apenas os próprios quizzes**. Os de outras pessoas nem aparecem para ele.
- O primeiro administrador é criado automaticamente na primeira inicialização, com `ADMIN_USER` (padrão `admin`) e `ADMIN_PASSWORD`. Depois disso essas variáveis **não alteram mais nada**: as senhas passam a ser gerenciadas pelo painel.
- Ao criar ou redefinir um usuário, o administrador define uma **senha provisória**, que o usuário é obrigado a trocar no primeiro acesso.
- Excluir um usuário transfere os quizzes dele para quem o excluiu. Quizzes criados antes do cadastro de usuários passam a ser do primeiro administrador.
- **Esqueceu a senha do administrador?** Com acesso ao servidor: `docker compose exec orbita node server/reset-senha.js admin` (informe a nova senha como segundo argumento ou em `NOVA_SENHA`) e depois `docker compose restart orbita`.

## Iniciar partida e histórico

- No painel, cada quiz tem **▶ Iniciar partida**: abre o `/host` já com a partida daquele quiz criada (lobby com PIN e QR Code).
- A aba **Histórico** lista as partidas por mês, com vencedor, número de jogadores e duração. O detalhe mostra o ranking completo, a taxa de acerto e a distribuição das respostas de cada pergunta, e permite baixar o CSV.
- Apresentadores veem as partidas que conduziram; administradores veem todas (e o espaço ocupado).
- Uma partida entra no histórico ao chegar ao pódio, ou como **interrompida** se for encerrada, expirar ou o servidor for desligado depois de pelo menos uma pergunta.

**Como o histórico economiza espaço** ([`server/history.js`](server/history.js)):

- Uma linha JSON por partida, num arquivo por mês (`DATA_DIR/historico/AAAA-MM.jsonl`). Gravar é só acrescentar uma linha.
- Guarda apenas totais: por pergunta, quantas pessoas escolheram cada alternativa; por jogador, posição, apelido, pontos, acertos e tempo médio. A resposta de cada jogador em cada pergunta (que cresce jogadores × perguntas) não é guardada.
- Meses encerrados são comprimidos com gzip (`AAAA-MM.jsonl.gz`), e meses além de `HISTORY_RETENTION_MONTHS` (padrão 24) são apagados.
- Referência medida: partida com 50 jogadores e 5 perguntas ≈ 2,3 KB em texto e ≈ 1 KB comprimida.

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
| `ADMIN_USER` | `admin` | Login do primeiro administrador (só vale na primeira inicialização). |
| `ADMIN_PASSWORD` | — | Senha do primeiro administrador (só vale na primeira inicialização). **Obrigatória** com `NODE_ENV=production`. Em desenvolvimento, usa `admin`. |
| `PUBLIC_URL` | — | Endereço que aparece no telão e no QR. Sem ele, mostra o IP da rede local (editável na tela do lobby). |
| `CORS_ORIGINS` | — | Domínios de front hospedados fora do servidor, separados por vírgula. |
| `SERVE_FRONT` | `true` | `false` para o servidor atender só API e WebSocket. |
| `PORT` | `3000` | Porta HTTP. |
| `HISTORY_RETENTION_MONTHS` | `24` | Meses de histórico mantidos; os mais antigos são apagados. |
| `DATA_DIR` | `server/data` | Usuários (`users.json`, com senhas em hash), quizzes, imagens enviadas e histórico de partidas. Faça backup. |

Use HTTPS com proxy reverso que encaminhe WebSocket (`Upgrade`) e mantenha **uma única instância**: o estado das partidas fica em memória.

## Segurança

- Senhas salvas com hash (scrypt) e sal por usuário; o navegador guarda só um token de sessão (12 h), nunca a senha.
- Trocar a senha, desativar ou excluir um usuário encerra as sessões dele na hora.
- Login limitado por IP (8 erros bloqueiam por 15 min) e por usuário; a resposta de erro não revela se o usuário existe. PINs errados também são limitados por IP.
- Cada apresentador só acessa os próprios quizzes (os de outros respondem 404); o limite é de 100 quizzes por usuário.
- Cada conexão controla no máximo um jogador; o apresentador pode remover jogadores no lobby.
- Uploads aceitam só PNG, JPG, GIF e WEBP, conferidos pela assinatura do arquivo.
- Cabeçalhos de segurança (CSP, `frame-ancestors 'none'`, `nosniff`, HSTS atrás de HTTPS).
- `/api/info` só lista IPs da rede quando `PUBLIC_URL` não está definido.

## Desenvolvimento

```bash
npm run dev:server   # API + Socket.IO em :3000
npm run dev:web      # Vite em :5173 (proxy para :3000)
npm run test:bots -- 100 http://localhost:3000 admin   # simula 100 jogadores jogando um quiz (senha do admin)
npm run test:permissoes -- http://localhost:3000 admin  # testa usuários, papéis e donos de quiz
```

## Regras de jogo

- Acerto vale `pontos × (1 − tempo_gasto / tempo_total / 2)` (50% a 100% dos pontos) + 50 por acerto consecutivo anterior (máx. 250).
- O tempo é medido no servidor; a alternativa correta só é enviada na revelação.
- Jogadores que perdem a conexão (bloqueio de tela etc.) retomam sozinhos; o apresentador também pode recarregar a página.
- Apelidos duplicados ou ofensivos são recusados.
