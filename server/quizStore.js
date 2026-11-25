import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const QUIZ_DIR = path.join(DATA_DIR, 'quizzes');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const SEED_DIR = path.join(__dirname, 'seed');

export function initStore() {
  fs.mkdirSync(QUIZ_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  if (fs.readdirSync(QUIZ_DIR).filter((f) => f.endsWith('.json')).length === 0 && fs.existsSync(SEED_DIR)) {
    for (const f of fs.readdirSync(SEED_DIR)) {
      fs.copyFileSync(path.join(SEED_DIR, f), path.join(QUIZ_DIR, f));
    }
  }
}

const idValido = (id) => typeof id === 'string' && /^[a-z0-9-]{1,60}$/.test(id);
const fileOf = (id) => path.join(QUIZ_DIR, `${id}.json`);

export function listQuizzes() {
  return fs
    .readdirSync(QUIZ_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const q = JSON.parse(fs.readFileSync(path.join(QUIZ_DIR, f), 'utf8'));
        return { id: q.id, titulo: q.titulo, perguntas: q.perguntas.length };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.titulo.localeCompare(b.titulo));
}

export function getQuiz(id) {
  if (!idValido(id) || !fs.existsSync(fileOf(id))) return null;
  return JSON.parse(fs.readFileSync(fileOf(id), 'utf8'));
}

export function deleteQuiz(id) {
  if (!idValido(id) || !fs.existsSync(fileOf(id))) return false;
  fs.unlinkSync(fileOf(id));
  return true;
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const clamp = (v, min, max, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};

/** Valida e normaliza um quiz vindo do cliente. Retorna { quiz } ou { erro }. */
export function validarQuiz(input) {
  if (!input || typeof input !== 'object') return { erro: 'Quiz inválido.' };
  const titulo = str(input.titulo, 100);
  if (!titulo) return { erro: 'Informe o título do quiz.' };
  if (!Array.isArray(input.perguntas) || input.perguntas.length < 1 || input.perguntas.length > 100) {
    return { erro: 'O quiz precisa ter entre 1 e 100 perguntas.' };
  }
  const perguntas = [];
  for (let i = 0; i < input.perguntas.length; i++) {
    const p = input.perguntas[i] || {};
    const n = i + 1;
    const tipo = p.tipo === 'vf' ? 'vf' : 'multipla';
    const texto = str(p.texto, 300);
    if (!texto) return { erro: `Pergunta ${n}: informe o enunciado.` };
    let opcoes;
    if (tipo === 'vf') {
      opcoes = ['Verdadeiro', 'Falso'];
    } else {
      opcoes = (Array.isArray(p.opcoes) ? p.opcoes : []).map((o) => str(o, 120));
      if (opcoes.length < 2 || opcoes.length > 4 || opcoes.some((o) => !o)) {
        return { erro: `Pergunta ${n}: informe de 2 a 4 alternativas preenchidas.` };
      }
    }
    const correta = Number(p.correta);
    if (!Number.isInteger(correta) || correta < 0 || correta >= opcoes.length) {
      return { erro: `Pergunta ${n}: marque a alternativa correta.` };
    }
    let imagem = str(p.imagem, 300);
    if (imagem && !/^(\/uploads\/[\w.-]+|https?:\/\/\S+)$/.test(imagem)) {
      return { erro: `Pergunta ${n}: imagem inválida (use upload ou um link http/https).` };
    }
    perguntas.push({
      tipo,
      texto,
      imagem,
      opcoes,
      correta,
      tempo: clamp(p.tempo, 5, 120, 20),
      pontos: clamp(p.pontos, 100, 2000, 1000),
    });
  }
  return { quiz: { titulo, perguntas } };
}

export function saveQuiz(id, quizNormalizado) {
  const quiz = { id, ...quizNormalizado };
  fs.writeFileSync(fileOf(id), JSON.stringify(quiz, null, 2));
  return quiz;
}

export function novoId(titulo) {
  const base =
    titulo
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'quiz';
  return `${base}-${crypto.randomBytes(2).toString('hex')}`;
}
