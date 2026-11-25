// Histórico de partidas, pensado para ocupar pouco espaço:
//
// - Uma linha JSON por partida (JSON Lines), num arquivo por mês: DATA_DIR/historico/AAAA-MM.jsonl
//   Gravar é só um append; nada é reescrito.
// - Só guarda totais: por pergunta, a distribuição das respostas; por jogador, uma linha
//   [posição, apelido, pontos, acertos, ms médio]. Nunca a resposta de cada jogador em cada pergunta
//   (é isso que cresce jogadores × perguntas).
// - Meses encerrados são comprimidos com gzip (AAAA-MM.jsonl.gz), que reduz o texto repetitivo em ~80-90%.
// - Retenção configurável (HISTORY_RETENTION_MONTHS, padrão 24 meses); meses mais antigos são apagados.
//
// Estimativa: partida com 50 jogadores e 10 perguntas ≈ 4–5 KB em texto, ≈ 1 KB depois do gzip.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { DATA_DIR } from './quizStore.js';

const DIR = path.join(DATA_DIR, 'historico');
const RETENCAO_MESES = Math.max(1, Number(process.env.HISTORY_RETENTION_MONTHS) || 24);
const MES_OK = /^\d{4}-\d{2}$/;
const ID_OK = /^(\d{4}-\d{2})-[0-9a-f]{10}$/;

const mesDe = (d = new Date()) => d.toISOString().slice(0, 7); // UTC
const jsonl = (mes) => path.join(DIR, `${mes}.jsonl`);
const gz = (mes) => path.join(DIR, `${mes}.jsonl.gz`);

// cache dos meses já lidos, invalidado pelo mtime do arquivo
const cache = new Map(); // caminho -> { mtimeMs, registros }

function lerArquivo(caminho) {
  if (!fs.existsSync(caminho)) return [];
  const { mtimeMs } = fs.statSync(caminho);
  const c = cache.get(caminho);
  if (c && c.mtimeMs === mtimeMs) return c.registros;
  let texto = fs.readFileSync(caminho);
  if (caminho.endsWith('.gz')) texto = zlib.gunzipSync(texto);
  const registros = [];
  for (const linha of texto.toString('utf8').split('\n')) {
    if (!linha.trim()) continue;
    try {
      registros.push(JSON.parse(linha));
    } catch {
      /* linha corrompida (ex.: desligamento no meio da gravação): ignora */
    }
  }
  cache.set(caminho, { mtimeMs, registros });
  return registros;
}

const lerMes = (mes) => [...lerArquivo(gz(mes)), ...lerArquivo(jsonl(mes))];

/** Comprime os meses anteriores ao atual que ainda estão em texto. */
function compactar() {
  const atual = mesDe();
  for (const f of fs.readdirSync(DIR)) {
    const m = f.match(/^(\d{4}-\d{2})\.jsonl$/);
    if (!m || m[1] >= atual) continue;
    const origem = jsonl(m[1]);
    // se já existir um .gz do mês (caso raro), junta os dois
    const antes = fs.existsSync(gz(m[1])) ? zlib.gunzipSync(fs.readFileSync(gz(m[1]))) : Buffer.alloc(0);
    const tmp = `${gz(m[1])}.tmp`;
    fs.writeFileSync(tmp, zlib.gzipSync(Buffer.concat([antes, fs.readFileSync(origem)]), { level: 9 }));
    fs.renameSync(tmp, gz(m[1]));
    fs.unlinkSync(origem);
  }
}

/** Apaga meses além do período de retenção. */
function aplicarRetencao() {
  const limite = new Date();
  limite.setUTCDate(1);
  limite.setUTCMonth(limite.getUTCMonth() - RETENCAO_MESES);
  const corte = mesDe(limite);
  for (const f of fs.readdirSync(DIR)) {
    const m = f.match(/^(\d{4}-\d{2})\.jsonl(\.gz)?$/);
    if (m && m[1] < corte) fs.unlinkSync(path.join(DIR, f));
  }
}

function manutencao() {
  try {
    compactar();
    aplicarRetencao();
  } catch (e) {
    console.error('[erro] manutenção do histórico:', e);
  }
}

export function initHistorico() {
  fs.mkdirSync(DIR, { recursive: true });
  manutencao();
  setInterval(manutencao, 24 * 3600 * 1000).unref();
}

/** Grava uma partida. Recebe o registro montado por game.js. */
export function registrar(registro) {
  const mes = mesDe();
  const id = `${mes}-${crypto.randomBytes(5).toString('hex')}`;
  fs.appendFileSync(jsonl(mes), `${JSON.stringify({ v: 1, id, ...registro })}\n`);
  return id;
}

/** Meses com dados, do mais recente ao mais antigo. */
export function meses(filtro = () => true) {
  const set = new Set();
  for (const f of fs.readdirSync(DIR)) {
    const m = f.match(/^(\d{4}-\d{2})\.jsonl(\.gz)?$/);
    if (m) set.add(m[1]);
  }
  return [...set]
    .sort()
    .reverse()
    .map((mes) => ({ mes, partidas: lerMes(mes).filter(filtro).length }))
    .filter((m) => m.partidas > 0);
}

/** Resumo para listagem (sem ranking completo nem perguntas). */
export function resumo(r) {
  return {
    id: r.id,
    pin: r.pin,
    status: r.status,
    inicio: r.inicio,
    fim: r.fim,
    quiz: r.quiz,
    apresentador: r.apresentador,
    jogadores: r.ranking.length,
    perguntasJogadas: r.perguntas.length,
    vencedor: r.ranking[0] ? { apelido: r.ranking[0][1], pontos: r.ranking[0][2] } : null,
  };
}

export function listarMes(mes, filtro = () => true) {
  if (!MES_OK.test(mes)) return [];
  return lerMes(mes)
    .filter(filtro)
    .sort((a, b) => b.fim.localeCompare(a.fim))
    .map(resumo);
}

/** Registro completo, com o ranking expandido para objetos. */
export function obter(id) {
  const m = typeof id === 'string' && id.match(ID_OK);
  if (!m) return null;
  const r = lerMes(m[1]).find((x) => x.id === id);
  if (!r) return null;
  return {
    ...r,
    ranking: r.ranking.map(([posicao, apelido, pontos, acertos, msMedioAcertos]) => ({ posicao, apelido, pontos, acertos, msMedioAcertos })),
  };
}

/** Tamanho em disco, para exibir no painel do administrador. */
export function tamanho() {
  let bytes = 0;
  for (const f of fs.readdirSync(DIR)) if (/\.jsonl(\.gz)?$/.test(f)) bytes += fs.statSync(path.join(DIR, f)).size;
  return bytes;
}
