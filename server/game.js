import crypto from 'node:crypto';

const INTRO_MS = 3000; // contagem antes de cada pergunta
const GRACE_MS = 500; // tolerância de latência no fechamento das respostas
const GAME_TTL_MS = 8 * 3600 * 1000;
const MAX_PLAYERS = 500;

const BLOCKED_LONG = ['porra', 'caralho', 'merda', 'puta', 'buceta', 'viado', 'arrombado', 'foder', 'foda-se', 'cacete'];
const BLOCKED_EXACT = ['cu', 'fdp', 'pqp', 'vsf', 'tnc'];

const rid = (n = 12) => crypto.randomBytes(n).toString('hex');
const normaliza = (s) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-]/g, '');

export function apelidoPermitido(nick) {
  const n = normaliza(nick);
  if (BLOCKED_EXACT.includes(n)) return false;
  return !BLOCKED_LONG.some((w) => n.includes(w));
}

export function pontuar(q, ms, streakAnterior) {
  const total = q.tempo * 1000;
  const frac = Math.min(1, Math.max(0, ms / total));
  const base = Math.round(q.pontos * (1 - frac / 2));
  const bonus = Math.min(streakAnterior, 5) * 50;
  return base + bonus;
}

export function createGameManager(io) {
  const games = new Map();
  const hostRoom = (pin) => `host:${pin}`;

  function novoPin() {
    let pin;
    do pin = String(Math.floor(100000 + Math.random() * 900000));
    while (games.has(pin));
    return pin;
  }

  const atual = (g) => g.quiz.perguntas[g.index];

  function ranking(g) {
    const lista = [...g.players.values()].sort((a, b) => b.points - a.points || a.nick.localeCompare(b.nick));
    let pos = 0;
    let anterior = null;
    return lista.map((p, i) => {
      if (p.points !== anterior) pos = i + 1;
      anterior = p.points;
      return { id: p.id, apelido: p.nick, pontos: p.points, posicao: pos, delta: p.delta };
    });
  }

  function snapshotBase(g, rank) {
    const q = atual(g);
    const s = {
      pin: g.pin,
      estado: g.state,
      titulo: g.quiz.titulo,
      total: g.quiz.perguntas.length,
      indice: g.index,
      agora: Date.now(),
      terminaEm: g.endsAt,
      qtdJogadores: g.players.size,
      respondidos: g.answers.size,
    };
    if (q && ['intro', 'respondendo', 'revelacao'].includes(g.state)) {
      // a alternativa correta só é enviada na revelação
      s.pergunta = { tipo: q.tipo, texto: q.texto, imagem: q.imagem, opcoes: q.opcoes, tempo: q.tempo, pontos: q.pontos };
    }
    if (g.state === 'revelacao') {
      s.correta = q.correta;
      s.distribuicao = g.dist;
    }
    if (g.state === 'ranking') s.ranking = rank.slice(0, 5);
    if (g.state === 'podio') s.podio = rank;
    return s;
  }

  function broadcast(g) {
    g.lastActivity = Date.now();
    const rank = ranking(g);
    const posPorId = new Map(rank.map((r) => [r.id, r.posicao]));
    const base = snapshotBase(g, rank);
    io.to(hostRoom(g.pin)).emit('estado', {
      ...base,
      papel: 'host',
      jogadores: [...g.players.values()].map((p) => ({ id: p.id, apelido: p.nick, conectado: p.connected })),
    });
    for (const p of g.players.values()) {
      if (!p.socketId) continue;
      const a = g.answers.get(p.id);
      io.to(p.socketId).emit('estado', {
        ...base,
        papel: 'jogador',
        eu: {
          id: p.id,
          apelido: p.nick,
          pontos: p.points,
          posicao: posPorId.get(p.id),
          streak: p.streak,
          respondeu: a ? a.opcao : null,
          ultimo: p.ultimo,
        },
      });
    }
  }

  const limpaTimer = (g) => {
    clearTimeout(g.timer);
    g.timer = null;
  };

  function iniciarPergunta(g, idx) {
    limpaTimer(g);
    g.index = idx;
    g.state = 'intro';
    g.answers = new Map();
    g.dist = null;
    for (const p of g.players.values()) {
      p.ultimo = null;
      p.delta = 0;
    }
    g.endsAt = Date.now() + INTRO_MS;
    g.timer = setTimeout(() => abrirRespostas(g), INTRO_MS);
    broadcast(g);
  }

  function abrirRespostas(g) {
    const q = atual(g);
    g.state = 'respondendo';
    g.startedAt = Date.now();
    g.endsAt = g.startedAt + q.tempo * 1000;
    limpaTimer(g);
    g.timer = setTimeout(() => finalizarPergunta(g), q.tempo * 1000 + GRACE_MS);
    broadcast(g);
  }

  function finalizarPergunta(g) {
    if (g.state !== 'respondendo') return;
    limpaTimer(g);
    const q = atual(g);
    const dist = q.opcoes.map(() => 0);
    for (const p of g.players.values()) {
      const a = g.answers.get(p.id);
      if (a) dist[a.opcao]++;
      if (a && a.opcao === q.correta) {
        const pts = pontuar(q, a.ms, p.streak);
        p.points += pts;
        p.streak += 1;
        p.acertos += 1;
        p.msAcertos += a.ms;
        p.delta = pts;
        p.ultimo = { correto: true, pontos: pts, escolha: a.opcao };
      } else {
        p.streak = 0;
        p.delta = 0;
        p.ultimo = { correto: false, pontos: 0, escolha: a ? a.opcao : null };
      }
    }
    g.dist = dist;
    g.state = 'revelacao';
    g.endsAt = 0;
    broadcast(g);
  }

  function todosResponderam(g) {
    const conectados = [...g.players.values()].filter((p) => p.connected);
    return conectados.length > 0 && conectados.every((p) => g.answers.has(p.id));
  }

  // ---------- API usada pelos handlers de socket ----------

  function criar(quiz) {
    const pin = novoPin();
    const g = {
      pin,
      quiz,
      hostToken: rid(),
      state: 'lobby',
      index: -1,
      players: new Map(),
      answers: new Map(),
      dist: null,
      timer: null,
      startedAt: 0,
      endsAt: 0,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };
    games.set(pin, g);
    return { pin, hostToken: g.hostToken };
  }

  function hostEntrar(socket, pin, token) {
    const g = games.get(pin);
    if (!g || g.hostToken !== token) return false;
    socket.data = { papel: 'host', pin };
    socket.join(hostRoom(pin));
    broadcast(g);
    return true;
  }

  function jogadorEntrar(socket, pin, apelidoBruto) {
    const g = games.get(String(pin || '').trim());
    if (!g) return { erro: 'PIN não encontrado. Confira o código no telão.', pinInvalido: true };
    // uma conexão = um jogador (evita um único script criar centenas de jogadores)
    const atualDoSocket = socket.data?.papel === 'jogador' && games.get(socket.data.pin)?.players.get(socket.data.playerId);
    if (atualDoSocket) return { erro: 'Esta conexão já está em uma partida. Recarregue a página.' };
    if (g.state === 'podio') return { erro: 'Esta partida já terminou.' };
    if (g.players.size >= MAX_PLAYERS) return { erro: 'Partida lotada.' };
    const apelido = String(apelidoBruto || '').replace(/\s+/g, ' ').trim().slice(0, 16);
    if (apelido.length < 2) return { erro: 'Escolha um apelido com pelo menos 2 letras.' };
    if (!apelidoPermitido(apelido)) return { erro: 'Esse apelido não é permitido. Escolha outro.' };
    const existe = [...g.players.values()].some((p) => p.nick.toLowerCase() === apelido.toLowerCase());
    if (existe) return { erro: 'Já existe alguém com esse apelido. Escolha outro.' };
    const p = {
      id: rid(6),
      token: rid(),
      nick: apelido,
      socketId: socket.id,
      connected: true,
      points: 0,
      streak: 0,
      acertos: 0,
      msAcertos: 0,
      delta: 0,
      ultimo: null,
    };
    g.players.set(p.id, p);
    socket.data = { papel: 'jogador', pin: g.pin, playerId: p.id };
    broadcast(g);
    return { token: p.token, pin: g.pin, apelido: p.nick };
  }

  function jogadorRetomar(socket, pin, token) {
    const g = games.get(String(pin || ''));
    if (!g) return { erro: 'Partida encerrada.' };
    const p = [...g.players.values()].find((x) => x.token === token);
    if (!p) return { erro: 'Sessão expirada.' };
    p.socketId = socket.id;
    p.connected = true;
    socket.data = { papel: 'jogador', pin: g.pin, playerId: p.id };
    broadcast(g);
    return { token: p.token, pin: g.pin, apelido: p.nick };
  }

  function responder(socket, opcao) {
    const d = socket.data || {};
    const g = games.get(d.pin);
    if (d.papel !== 'jogador' || !g) return { erro: 'Sessão inválida.' };
    if (g.state !== 'respondendo') return { erro: 'Tempo encerrado.' };
    const q = atual(g);
    if (!Number.isInteger(opcao) || opcao < 0 || opcao >= q.opcoes.length) return { erro: 'Opção inválida.' };
    if (g.answers.has(d.playerId)) return { erro: 'Você já respondeu.' };
    const ms = Math.min(Date.now() - g.startedAt, q.tempo * 1000);
    g.answers.set(d.playerId, { opcao, ms });
    // evita broadcast por resposta (n² mensagens): só o host recebe a contagem
    io.to(hostRoom(g.pin)).emit('respondidos', { respondidos: g.answers.size, total: g.players.size });
    if (todosResponderam(g)) finalizarPergunta(g);
    return { ok: true };
  }

  function doHost(socket) {
    const d = socket.data || {};
    if (d.papel !== 'host') return null;
    return games.get(d.pin) || null;
  }

  function avancar(socket) {
    const g = doHost(socket);
    if (!g) return { erro: 'Sem permissão.' };
    switch (g.state) {
      case 'lobby':
        if (g.players.size === 0) return { erro: 'Aguarde pelo menos 1 jogador.' };
        iniciarPergunta(g, 0);
        break;
      case 'respondendo':
        finalizarPergunta(g);
        break;
      case 'revelacao':
        if (g.index >= g.quiz.perguntas.length - 1) {
          g.state = 'podio';
          broadcast(g);
        } else {
          g.state = 'ranking';
          broadcast(g);
        }
        break;
      case 'ranking':
        iniciarPergunta(g, g.index + 1);
        break;
      default:
        break;
    }
    return { ok: true };
  }

  function expulsar(socket, playerId) {
    const g = doHost(socket);
    if (!g) return { erro: 'Sem permissão.' };
    const p = g.players.get(playerId);
    if (!p) return { erro: 'Jogador não encontrado.' };
    g.players.delete(playerId);
    g.answers.delete(playerId);
    if (p.socketId) {
      io.to(p.socketId).emit('expulso');
      const s = io.sockets.sockets.get(p.socketId);
      if (s) s.data = {};
    }
    broadcast(g);
    if (g.state === 'respondendo' && todosResponderam(g)) finalizarPergunta(g);
    return { ok: true };
  }

  function encerrar(socket) {
    const g = doHost(socket);
    if (!g) return { erro: 'Sem permissão.' };
    limpaTimer(g);
    io.to(hostRoom(g.pin)).emit('encerrada');
    for (const p of g.players.values()) if (p.socketId) io.to(p.socketId).emit('encerrada');
    games.delete(g.pin);
    return { ok: true };
  }

  function csv(socket) {
    const g = doHost(socket);
    if (!g) return { erro: 'Sem permissão.' };
    const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const linhas = [['Posição', 'Apelido', 'Pontos', 'Acertos', 'Total de perguntas', 'Tempo médio dos acertos (s)'].map(esc).join(';')];
    const porId = new Map([...g.players.values()].map((p) => [p.id, p]));
    for (const r of ranking(g)) {
      const p = porId.get(r.id);
      const media = p.acertos ? (p.msAcertos / p.acertos / 1000).toFixed(1).replace('.', ',') : '';
      linhas.push([r.posicao, r.apelido, r.pontos, p.acertos, g.quiz.perguntas.length, media].map(esc).join(';'));
    }
    return { csv: '﻿' + linhas.join('\r\n'), nome: `ranking-${g.pin}.csv` };
  }

  function desconectar(socket) {
    const d = socket.data || {};
    const g = games.get(d.pin);
    if (!g || d.papel !== 'jogador') return;
    const p = g.players.get(d.playerId);
    if (!p || p.socketId !== socket.id) return;
    p.connected = false;
    p.socketId = null;
    broadcast(g);
    if (g.state === 'respondendo' && todosResponderam(g)) finalizarPergunta(g);
  }

  setInterval(() => {
    const agora = Date.now();
    for (const [pin, g] of games) {
      if (agora - g.lastActivity > GAME_TTL_MS) {
        limpaTimer(g);
        games.delete(pin);
      }
    }
  }, 10 * 60 * 1000).unref();

  return { criar, hostEntrar, jogadorEntrar, jogadorRetomar, responder, avancar, expulsar, encerrar, csv, desconectar };
}
