import express from 'express';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { createGameManager } from './game.js';
import * as store from './quizStore.js';
import * as users from './users.js';
import * as historico from './history.js';
import { ipCliente, criarLimitador, criarSessoes, cabecalhosSeguranca } from './security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRODUCAO = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter(Boolean);
const SERVIR_FRONT = process.env.SERVE_FRONT !== 'false';
const DIST = path.join(__dirname, '..', 'dist');

// ADMIN_USER/ADMIN_PASSWORD só criam o primeiro administrador (quando ainda não existe nenhum).
// Depois disso, as senhas são gerenciadas pelo painel e ficam salvas com hash em DATA_DIR/users.json.
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
if (!ADMIN_PASSWORD) {
  if (PRODUCAO) {
    console.error('[erro] Defina ADMIN_PASSWORD (variável de ambiente) para iniciar em produção.');
    process.exit(1);
  }
  ADMIN_PASSWORD = 'admin';
  console.warn('[aviso] ADMIN_PASSWORD não definida: usando "admin" (apenas desenvolvimento).');
} else if (PRODUCAO && ADMIN_PASSWORD.length < 10) {
  console.warn('[aviso] ADMIN_PASSWORD curta. Use pelo menos 10 caracteres.');
}

store.initStore();
const adminInicial = await users.initUsers({ adminUsuario: process.env.ADMIN_USER || 'admin', adminSenha: ADMIN_PASSWORD });
store.atribuirDonoPadrao(adminInicial.id);
historico.initHistorico();

const app = express();
app.disable('x-powered-by');
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 10000,
  pingTimeout: 15000,
  maxHttpBufferSize: 16 * 1024,
  cors: CORS_ORIGINS.length ? { origin: CORS_ORIGINS } : undefined,
});
const manager = createGameManager(io, { aoTerminar: historico.registrar });

// ---------- autenticação ----------
const sessoes = criarSessoes(12 * 3600 * 1000);
const limiteLogin = criarLimitador({ max: 8, janelaMs: 10 * 60_000, bloqueioMs: 15 * 60_000 }); // por IP
const limiteLoginUsuario = criarLimitador({ max: 12, janelaMs: 15 * 60_000, bloqueioMs: 10 * 60_000 }); // por login (ataque distribuído)
const limitePin = criarLimitador({ max: 30, janelaMs: 60_000, bloqueioMs: 5 * 60_000 });

const ipReq = (req) => ipCliente(req.socket.remoteAddress, req.get('x-forwarded-for'));
const ipSocket = (s) => ipCliente(s.handshake.address, s.handshake.headers['x-forwarded-for']);
const tokenReq = (req) => (req.get('authorization') || '').replace(/^Bearer\s+/i, '');

/** Usuário logado e ativo a partir do token; null se inválido. Reavalia o cadastro a cada chamada. */
function usuarioDoToken(token) {
  const id = sessoes.usuarioDe(token);
  const u = id && users.porId(id);
  return u && u.ativo ? u : null;
}

function autentica(req, res, next) {
  const u = usuarioDoToken(tokenReq(req));
  if (!u) return res.status(401).json({ erro: 'Sessão expirada. Entre novamente.' });
  req.usuario = u;
  next();
}

// quem ainda está com senha provisória só pode trocá-la
function senhaEmDia(req, res, next) {
  if (req.usuario.precisaTrocarSenha) return res.status(403).json({ erro: 'Defina uma nova senha para continuar.', trocarSenha: true });
  next();
}

function exigeAdmin(req, res, next) {
  if (req.usuario.papel !== 'admin') return res.status(403).json({ erro: 'Apenas administradores podem fazer isso.' });
  next();
}

const logado = [autentica, senhaEmDia];
const soAdmin = [autentica, senhaEmDia, exigeAdmin];

const podeAcessarQuiz = (u, quiz) => u.papel === 'admin' || quiz.dono === u.id;
const MAX_QUIZZES_POR_USUARIO = 100;

// ---------- CORS (front hospedado em outro domínio, ex.: CDN) ----------
app.use((req, res, next) => {
  const origem = req.get('origin');
  if (origem && CORS_ORIGINS.includes(origem)) {
    res.set({
      'Access-Control-Allow-Origin': origem,
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    });
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  }
  next();
});
app.use(cabecalhosSeguranca);

// ---------- API ----------
app.get('/api/info', (_req, res) => {
  // IPs da rede só são úteis (e só são expostos) quando não há endereço público configurado
  const lan = [];
  if (!PUBLIC_URL) {
    for (const lista of Object.values(os.networkInterfaces())) {
      for (const i of lista || []) if (i.family === 'IPv4' && !i.internal) lan.push(`http://${i.address}:${PORT}`);
    }
  }
  res.json({ publicUrl: PUBLIC_URL, lan });
});

const handler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- sessão e conta ----------
app.post(
  '/api/login',
  express.json({ limit: '2kb' }),
  handler(async (req, res) => {
    const ip = ipReq(req);
    const login = users.normalizaLogin(req.body?.usuario).slice(0, 40);
    const chaveUsuario = `u:${login}`;
    if (limiteLogin.bloqueado(ip) || limiteLoginUsuario.bloqueado(chaveUsuario)) {
      return res.status(429).json({ erro: 'Muitas tentativas. Aguarde alguns minutos.' });
    }
    const u = await users.autenticar(login, req.body?.senha);
    if (!u) {
      limiteLogin.falha(ip);
      limiteLoginUsuario.falha(chaveUsuario);
      return res.status(401).json({ erro: 'Usuário ou senha incorretos.' });
    }
    limiteLogin.sucesso(ip);
    limiteLoginUsuario.sucesso(chaveUsuario);
    res.json({ token: sessoes.criar(u.id), usuario: users.publico(u) });
  })
);

app.post('/api/logout', (req, res) => {
  sessoes.remover(tokenReq(req));
  res.json({ ok: true });
});

app.get('/api/eu', autentica, (req, res) => res.json(users.publico(req.usuario)));

app.post(
  '/api/eu/senha',
  autentica,
  express.json({ limit: '2kb' }),
  handler(async (req, res) => {
    const chave = `u:${req.usuario.usuario}`;
    if (limiteLoginUsuario.bloqueado(chave)) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde alguns minutos.' });
    const r = await users.trocarSenha(req.usuario.id, req.body?.atual, req.body?.nova);
    if (r.erro) {
      if (r.erro.includes('atual está incorreta')) limiteLoginUsuario.falha(chave);
      return res.status(400).json(r);
    }
    sessoes.removerDoUsuario(req.usuario.id, tokenReq(req)); // desconecta os outros dispositivos
    res.json(r.usuario);
  })
);

// ---------- usuários (somente administradores) ----------
app.get('/api/usuarios', ...soAdmin, (_req, res) => res.json(users.listar()));

app.post(
  '/api/usuarios',
  ...soAdmin,
  express.json({ limit: '4kb' }),
  handler(async (req, res) => {
    const r = await users.criar({ ...req.body, papel: req.body?.papel || 'apresentador' });
    if (r.erro) return res.status(400).json(r);
    res.status(201).json(r.usuario);
  })
);

app.put(
  '/api/usuarios/:id',
  ...soAdmin,
  express.json({ limit: '4kb' }),
  handler(async (req, res) => {
    const { nome, papel, ativo, senha } = req.body || {};
    const r = await users.atualizar(req.params.id, { nome, papel, ativo, senha }, { quemId: req.usuario.id });
    if (r.erro) return res.status(r.erro === 'Usuário não encontrado.' ? 404 : 400).json(r);
    if (r.sessoesInvalidas) sessoes.removerDoUsuario(req.params.id, req.params.id === req.usuario.id ? tokenReq(req) : undefined);
    res.json(r.usuario);
  })
);

app.delete('/api/usuarios/:id', ...soAdmin, (req, res) => {
  const r = users.remover(req.params.id, { quemId: req.usuario.id });
  if (r.erro) return res.status(r.erro === 'Usuário não encontrado.' ? 404 : 400).json(r);
  sessoes.removerDoUsuario(req.params.id);
  const transferidos = store.transferirQuizzes(req.params.id, req.usuario.id); // não perde os quizzes
  res.json({ ok: true, quizzesTransferidos: transferidos });
});

// ---------- histórico de partidas (apresentador vê as que conduziu; administrador vê todas) ----------
const podeVerPartida = (u, r) => u.papel === 'admin' || r.apresentador?.id === u.id;

app.get('/api/historico/meses', ...logado, (req, res) => {
  res.json({
    meses: historico.meses((r) => podeVerPartida(req.usuario, r)),
    bytes: req.usuario.papel === 'admin' ? historico.tamanho() : undefined,
  });
});

app.get('/api/historico', ...logado, (req, res) => {
  const mes = String(req.query.mes || '');
  res.json(historico.listarMes(mes, (r) => podeVerPartida(req.usuario, r)));
});

app.get('/api/historico/:id', ...logado, (req, res) => {
  const r = historico.obter(req.params.id);
  if (!r || !podeVerPartida(req.usuario, r)) return res.status(404).json({ erro: 'Partida não encontrada.' });
  res.json(r);
});

// ---------- quizzes (cada apresentador vê só os seus; administradores veem todos) ----------
app.get('/api/quizzes', ...logado, (req, res) => {
  const todos = req.usuario.papel === 'admin';
  const lista = store.listQuizzes((q) => todos || q.dono === req.usuario.id);
  res.json(
    lista.map((q) => ({ ...q, donoNome: users.porId(q.dono)?.nome || null, meu: q.dono === req.usuario.id }))
  );
});

app.get('/api/quizzes/:id', ...logado, (req, res) => {
  const q = store.getQuiz(req.params.id);
  // 404 (e não 403) para quizzes de outras pessoas: não revela que existem
  if (!q || !podeAcessarQuiz(req.usuario, q)) return res.status(404).json({ erro: 'Quiz não encontrado.' });
  res.json(q);
});

app.post('/api/quizzes', ...logado, express.json({ limit: '1mb' }), (req, res) => {
  const { quiz, erro } = store.validarQuiz(req.body);
  if (erro) return res.status(400).json({ erro });
  if (store.listQuizzes((q) => q.dono === req.usuario.id).length >= MAX_QUIZZES_POR_USUARIO) {
    return res.status(400).json({ erro: `Limite de ${MAX_QUIZZES_POR_USUARIO} quizzes por usuário atingido.` });
  }
  res.json(store.saveQuiz(store.novoId(quiz.titulo), quiz, req.usuario.id));
});

app.put('/api/quizzes/:id', ...logado, express.json({ limit: '1mb' }), (req, res) => {
  const atual = store.getQuiz(req.params.id);
  if (!atual || !podeAcessarQuiz(req.usuario, atual)) return res.status(404).json({ erro: 'Quiz não encontrado.' });
  const { quiz, erro } = store.validarQuiz(req.body);
  if (erro) return res.status(400).json({ erro });
  res.json(store.saveQuiz(req.params.id, quiz, atual.dono)); // o dono nunca muda por edição
});

app.delete('/api/quizzes/:id', ...logado, (req, res) => {
  const atual = store.getQuiz(req.params.id);
  if (!atual || !podeAcessarQuiz(req.usuario, atual)) return res.status(404).json({ erro: 'Quiz não encontrado.' });
  store.deleteQuiz(req.params.id);
  res.json({ ok: true });
});

// confere a assinatura do arquivo, não só o Content-Type declarado
const ASSINATURAS = [
  { ext: 'png', ok: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'jpg', ok: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'gif', ok: (b) => b.subarray(0, 4).toString('latin1') === 'GIF8' },
  { ext: 'webp', ok: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];
app.post(
  '/api/upload',
  ...logado,
  express.raw({ type: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'], limit: '5mb' }),
  (req, res) => {
    const tipo = Buffer.isBuffer(req.body) && req.body.length > 12 ? ASSINATURAS.find((a) => a.ok(req.body)) : null;
    if (!tipo) return res.status(400).json({ erro: 'Envie uma imagem PNG, JPG, GIF ou WEBP de até 5 MB.' });
    const nome = `${crypto.randomBytes(8).toString('hex')}.${tipo.ext}`;
    fs.writeFileSync(path.join(store.UPLOAD_DIR, nome), req.body);
    res.json({ url: `/uploads/${nome}` });
  }
);

app.use(
  '/uploads',
  express.static(store.UPLOAD_DIR, {
    maxAge: '7d',
    setHeaders: (res) => res.set({ 'Cross-Origin-Resource-Policy': 'cross-origin', 'Content-Disposition': 'inline' }),
  })
);

app.use('/api', (_req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

// erros da API (JSON inválido, corpo grande demais, falhas inesperadas) sempre em JSON, sem detalhes internos
// eslint-disable-next-line no-unused-vars
app.use('/api', (err, _req, res, _next) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ erro: 'Conteúdo grande demais.' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido.' });
  console.error('[erro] API:', err);
  res.status(500).json({ erro: 'Erro interno.' });
});

// ---------- Front (build de produção) ----------
if (SERVIR_FRONT && fs.existsSync(DIST)) {
  app.use(express.static(DIST, { index: false, maxAge: '1y', immutable: true, setHeaders: (res, p) => p.endsWith('.html') && res.set('Cache-Control', 'no-cache') }));
  app.use((req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path.startsWith('/socket.io')) return next();
    res.set('Cache-Control', 'no-cache').sendFile(path.join(DIST, 'index.html'));
  });
}

// ---------- Tempo real ----------
io.on('connection', (socket) => {
  const ip = ipSocket(socket);
  const on = (evento, fn) =>
    socket.on(evento, (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        fn(payload && typeof payload === 'object' ? payload : {}, reply);
      } catch (e) {
        console.error(`[erro] ${evento}:`, e);
        reply({ erro: 'Erro interno.' });
      }
    });

  on('host:criar', ({ token, quizId }, reply) => {
    const u = usuarioDoToken(token);
    if (!u) return reply({ erro: 'Sessão expirada. Entre novamente.', sessao: false });
    if (u.precisaTrocarSenha) return reply({ erro: 'Defina uma nova senha antes de criar partidas.', sessao: false });
    const quiz = store.getQuiz(quizId);
    if (!quiz || !podeAcessarQuiz(u, quiz)) return reply({ erro: 'Quiz não encontrado.' });
    const { pin, hostToken } = manager.criar(quiz, { id: u.id, nome: u.nome });
    manager.hostEntrar(socket, pin, hostToken);
    reply({ pin, hostToken });
  });

  on('host:retomar', ({ pin, hostToken }, reply) => {
    reply(manager.hostEntrar(socket, String(pin), String(hostToken)) ? { ok: true } : { erro: 'Partida não encontrada.' });
  });

  on('host:avancar', (_p, reply) => reply(manager.avancar(socket)));
  on('host:expulsar', ({ id }, reply) => reply(manager.expulsar(socket, String(id))));
  on('host:encerrar', (_p, reply) => reply(manager.encerrar(socket)));
  on('host:csv', (_p, reply) => reply(manager.csv(socket)));

  on('jogador:entrar', ({ pin, apelido }, reply) => {
    if (limitePin.bloqueado(ip)) return reply({ erro: 'Muitas tentativas. Aguarde alguns minutos.' });
    const r = manager.jogadorEntrar(socket, pin, apelido);
    if (r.pinInvalido) limitePin.falha(ip);
    delete r.pinInvalido;
    reply(r);
  });
  on('jogador:retomar', ({ pin, token }, reply) => {
    if (limitePin.bloqueado(ip)) return reply({ erro: 'Muitas tentativas. Aguarde alguns minutos.' });
    const r = manager.jogadorRetomar(socket, pin, String(token));
    if (r.erro) limitePin.falha(ip);
    reply(r);
  });
  on('jogador:responder', ({ opcao }, reply) => reply(manager.responder(socket, opcao)));

  socket.on('disconnect', () => manager.desconectar(socket));
});

// encerra limpo no `docker stop` (SIGTERM) em vez de esperar o SIGKILL
for (const sinal of ['SIGTERM', 'SIGINT']) {
  process.on(sinal, () => {
    console.log(`${sinal} recebido, encerrando…`);
    manager.registrarPendentes(); // partidas em andamento entram no histórico como interrompidas
    io.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}

server.listen(PORT, () => {
  console.log(`Órbita rodando em http://localhost:${PORT}`);
  if (CORS_ORIGINS.length) console.log(`  CORS liberado para: ${CORS_ORIGINS.join(', ')}`);
  if (SERVIR_FRONT && fs.existsSync(DIST)) console.log('  /  jogadores   /host  apresentador   /admin  editor de quizzes');
});
