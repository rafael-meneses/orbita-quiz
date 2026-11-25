// Teste de carga/fumaça: simula 1 host + N jogadores jogando um quiz inteiro.
// Uso: node scripts/bots.mjs [N=50] [URL=http://localhost:3000] [SENHA=admin] [USUARIO=admin]
import { io } from 'socket.io-client';

const N = Number(process.argv[2]) || 50;
const URL = process.argv[3] || 'http://localhost:3000';
const SENHA = process.argv[4] || process.env.ADMIN_PASSWORD || 'admin';
const USUARIO = process.argv[5] || process.env.ADMIN_USER || 'admin';

const emit = (s, ev, data) => new Promise((res) => s.emit(ev, data, res));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const falha = (msg) => {
  console.error('FALHOU:', msg);
  process.exit(1);
};

const login = await fetch(`${URL}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ usuario: USUARIO, senha: SENHA }),
}).then((r) => r.json());
if (!login.token) falha(`login: ${JSON.stringify(login)}`);
const quizzes = await fetch(`${URL}/api/quizzes`, { headers: { Authorization: `Bearer ${login.token}` } }).then((r) => r.json());
if (!Array.isArray(quizzes) || !quizzes.length) falha('nenhum quiz disponível');

const host = io(URL);
await new Promise((r) => host.on('connect', r));
const criado = await emit(host, 'host:criar', { token: login.token, quizId: quizzes[0].id });
if (!criado.pin) falha(JSON.stringify(criado));
let estado = null;
const esperas = [];
host.on('estado', (s) => {
  estado = s;
  esperas.forEach((fn) => fn());
});
const aguarda = (cond, ms = 30000) =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout esperando estado')), ms);
    const check = () => {
      if (estado && cond(estado)) {
        clearTimeout(t);
        esperas.splice(esperas.indexOf(check), 1);
        res(estado);
      }
    };
    esperas.push(check);
    check();
  });

// jogadores
const bots = [];
let ultimaOpcoes = null;
for (let i = 0; i < N; i++) {
  const s = io(URL);
  await new Promise((r) => s.on('connect', r));
  const r = await emit(s, 'jogador:entrar', { pin: criado.pin, apelido: `Bot${i}` });
  if (r.erro) falha(r.erro);
  const bot = { s, i, token: r.token };
  s.on('estado', (st) => {
    bot.ultimo = st;
    if (st.estado === 'respondendo' && st.eu.respondeu === null && !bot.respondendo) {
      bot.respondendo = true;
      setTimeout(async () => {
        const res = await emit(s, 'jogador:responder', { opcao: Math.floor(Math.random() * st.pergunta.opcoes.length) });
        bot.respostas = (bot.respostas || 0) + (res.ok ? 1 : 0);
      }, 100 + Math.random() * 1500);
    }
    if (st.estado !== 'respondendo') bot.respondendo = false;
    if (st.pergunta) ultimaOpcoes = st.pergunta;
  });
  bots.push(bot);
}

// valida que a resposta correta NUNCA vaza antes da revelação
let vazou = false;
bots[0].s.on('estado', (st) => {
  if (['intro', 'respondendo'].includes(st.estado) && (st.correta !== undefined || JSON.stringify(st).includes('"correta"'))) vazou = true;
});

await aguarda((s) => s.qtdJogadores === N);
console.log(`PIN ${criado.pin}: ${N} jogadores no lobby`);

// jogador com apelido repetido/proibido deve ser recusado
const extra = io(URL);
await new Promise((r) => extra.on('connect', r));
if (!(await emit(extra, 'jogador:entrar', { pin: criado.pin, apelido: 'bot0' })).erro) falha('apelido duplicado aceito');
if (!(await emit(extra, 'jogador:entrar', { pin: criado.pin, apelido: 'Caralho' })).erro) falha('apelido proibido aceito');
extra.close();

const t0 = Date.now();
await emit(host, 'host:avancar'); // inicia
while (true) {
  await aguarda((s) => s.estado === 'revelacao');
  const rev = estado;
  const soma = rev.distribuicao.reduce((a, b) => a + b, 0);
  console.log(`  pergunta ${rev.indice + 1}/${rev.total}: ${soma}/${N} responderam, certa=${rev.correta}, dist=${rev.distribuicao}`);
  await emit(host, 'host:avancar'); // revelação -> ranking/pódio
  if (estado.estado !== 'ranking' && !(await aguarda((s) => ['ranking', 'podio'].includes(s.estado))).estado) falha('sem transição');
  if (estado.estado === 'podio') break;
  await emit(host, 'host:avancar'); // ranking -> próxima
}
await aguarda((s) => s.estado === 'podio');
const podio = estado.podio;
console.log(`Pódio: ${podio.slice(0, 3).map((p) => `${p.posicao}º ${p.apelido} (${p.pontos})`).join(' | ')}`);
if (podio.length !== N) falha(`pódio com ${podio.length} jogadores`);
for (let i = 1; i < podio.length; i++) if (podio[i].pontos > podio[i - 1].pontos) falha('ranking fora de ordem');
if (vazou) falha('a resposta correta vazou antes da revelação');

const csv = await emit(host, 'host:csv');
if (!csv.csv || csv.csv.split('\r\n').length !== N + 1) falha('CSV inválido');

// reconexão: o jogador deve retomar a sessão com o token em um novo socket
const b = bots[1];
const antes = b.ultimo.eu.pontos;
b.s.close();
const novo = io(URL);
await new Promise((r) => novo.on('connect', r));
const eu = await new Promise((res) => {
  novo.on('estado', (st) => st.eu && res(st.eu));
  novo.emit('jogador:retomar', { pin: criado.pin, token: b.token }, (r) => r.erro && falha(r.erro));
});
if (eu.pontos !== antes) falha('pontos divergentes após reconexão');
console.log(`OK em ${((Date.now() - t0) / 1000).toFixed(1)}s. Reconexão do Bot1 preservou ${antes} pontos.`);
novo.close();
await emit(host, 'host:encerrar');
bots.forEach((x) => x.s.close());
host.close();
console.log('TUDO OK');
process.exit(0);
