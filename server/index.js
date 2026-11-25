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

const app = express();
app.disable('x-powered-by');
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 10000,
  pingTimeout: 15000,
  maxHttpBufferSize: 16 * 1024,
  cors: CORS_ORIGINS.length ? { origin: CORS_ORIGINS } : undefined,
});
const manager = createGameManager(io);

// ---------- autenticação ----------
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const senhaOk = (s) => crypto.timingSafeEqual(sha(s), sha(ADMIN_PASSWORD));
const sessoes = criarSessoes(12 * 3600 * 1000);
const limiteLogin = criarLimitador({ max: 8, janelaMs: 10 * 60_000, bloqueioMs: 15 * 60_000 });
const limitePin = criarLimitador({ max: 30, janelaMs: 60_000, bloqueioMs: 5 * 60_000 });

const ipReq = (req) => ipCliente(req.socket.remoteAddress, req.get('x-forwarded-for'));
const ipSocket = (s) => ipCliente(s.handshake.address, s.handshake.headers['x-forwarded-for']);
const tokenReq = (req) => (req.get('authorization') || '').replace(/^Bearer\s+/i, '');

function exigeAdmin(req, res, next) {
  if (!sessoes.valido(tokenReq(req))) return res.status(401).json({ erro: 'Sessão expirada. Entre novamente.' });
  next();
}

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

app.post('/api/login', express.json({ limit: '2kb' }), (req, res) => {
  const ip = ipReq(req);
  if (limiteLogin.bloqueado(ip)) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde alguns minutos.' });
  if (!senhaOk(req.body?.senha || '')) {
    limiteLogin.falha(ip);
    return res.status(401).json({ erro: 'Senha incorreta.' });
  }
  limiteLogin.sucesso(ip);
  res.json({ token: sessoes.criar() });
});

app.post('/api/logout', (req, res) => {
  sessoes.remover(tokenReq(req));
  res.json({ ok: true });
});

app.get('/api/sessao', exigeAdmin, (_req, res) => res.json({ ok: true }));

app.get('/api/quizzes', exigeAdmin, (_req, res) => res.json(store.listQuizzes()));

app.get('/api/quizzes/:id', exigeAdmin, (req, res) => {
  const q = store.getQuiz(req.params.id);
  if (!q) return res.status(404).json({ erro: 'Quiz não encontrado.' });
  res.json(q);
});

app.post('/api/quizzes', exigeAdmin, express.json({ limit: '1mb' }), (req, res) => {
  const { quiz, erro } = store.validarQuiz(req.body);
  if (erro) return res.status(400).json({ erro });
  res.json(store.saveQuiz(store.novoId(quiz.titulo), quiz));
});

app.put('/api/quizzes/:id', exigeAdmin, express.json({ limit: '1mb' }), (req, res) => {
  if (!store.getQuiz(req.params.id)) return res.status(404).json({ erro: 'Quiz não encontrado.' });
  const { quiz, erro } = store.validarQuiz(req.body);
  if (erro) return res.status(400).json({ erro });
  res.json(store.saveQuiz(req.params.id, quiz));
});

app.delete('/api/quizzes/:id', exigeAdmin, (req, res) => {
  if (!store.deleteQuiz(req.params.id)) return res.status(404).json({ erro: 'Quiz não encontrado.' });
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
  exigeAdmin,
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
    if (!sessoes.valido(token)) return reply({ erro: 'Sessão expirada. Entre novamente.', sessao: false });
    const quiz = store.getQuiz(quizId);
    if (!quiz) return reply({ erro: 'Quiz não encontrado.' });
    const { pin, hostToken } = manager.criar(quiz);
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
