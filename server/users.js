import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { DATA_DIR } from './quizStore.js';

const scrypt = promisify(crypto.scrypt);
const arquivo = () => path.join(DATA_DIR, 'users.json');

export const PAPEIS = ['admin', 'apresentador'];
export const SENHA_MIN = 8;
export const SENHA_MAX = 100;

let usuarios = new Map(); // id -> registro completo (com hash)

// ---------- senhas ----------
async function gerarHash(senha) {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(senha, salt, 64);
  return `${salt.toString('hex')}:${h.toString('hex')}`;
}

async function confere(senha, guardado) {
  const [s, h] = String(guardado).split(':');
  if (!s || !h) return false;
  const calc = await scrypt(senha, Buffer.from(s, 'hex'), 64);
  const esperado = Buffer.from(h, 'hex');
  return esperado.length === calc.length && crypto.timingSafeEqual(calc, esperado);
}

// usado quando o usuário não existe, para não revelar (pelo tempo de resposta) quais logins existem
const HASH_FALSO = await gerarHash(crypto.randomBytes(8).toString('hex'));

export function validarSenha(senha, usuario = '') {
  if (typeof senha !== 'string' || senha.length < SENHA_MIN) return `A senha precisa ter pelo menos ${SENHA_MIN} caracteres.`;
  if (senha.length > SENHA_MAX) return `A senha pode ter no máximo ${SENHA_MAX} caracteres.`;
  if (usuario && senha.toLowerCase() === usuario.toLowerCase()) return 'A senha não pode ser igual ao nome de usuário.';
  return null;
}

// ---------- persistência ----------
function salvar() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${arquivo()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify([...usuarios.values()], null, 2), { mode: 0o600 });
  fs.renameSync(tmp, arquivo());
}

function carregar() {
  usuarios = new Map();
  if (!fs.existsSync(arquivo())) return;
  for (const u of JSON.parse(fs.readFileSync(arquivo(), 'utf8'))) usuarios.set(u.id, u);
}

export const publico = (u) =>
  u && { id: u.id, usuario: u.usuario, nome: u.nome, papel: u.papel, ativo: u.ativo, criadoEm: u.criadoEm, precisaTrocarSenha: !!u.precisaTrocarSenha };

const novoId = () => crypto.randomBytes(6).toString('hex');
const adminsAtivos = () => [...usuarios.values()].filter((u) => u.papel === 'admin' && u.ativo);

/** Carrega os usuários; se ainda não existir nenhum administrador, cria o primeiro a partir da configuração. */
export async function initUsers({ adminUsuario, adminSenha }) {
  carregar();
  if (adminsAtivos().length === 0) {
    const login = normalizaLogin(adminUsuario) || 'admin';
    const existente = [...usuarios.values()].find((u) => u.usuario === login);
    if (existente) {
      existente.papel = 'admin';
      existente.ativo = true;
      existente.hash = await gerarHash(adminSenha);
      existente.precisaTrocarSenha = false;
    } else {
      const id = novoId();
      usuarios.set(id, {
        id,
        usuario: login,
        nome: 'Administrador',
        papel: 'admin',
        ativo: true,
        hash: await gerarHash(adminSenha),
        precisaTrocarSenha: false,
        criadoEm: new Date().toISOString(),
      });
    }
    salvar();
  }
  return primeiroAdmin();
}

export const primeiroAdmin = () =>
  [...usuarios.values()].filter((u) => u.papel === 'admin' && u.ativo).sort((a, b) => a.criadoEm.localeCompare(b.criadoEm))[0];

// ---------- consultas ----------
export const porId = (id) => usuarios.get(id) || null;
export const porLogin = (login) => [...usuarios.values()].find((u) => u.usuario === normalizaLogin(login)) || null;
export const listar = () => [...usuarios.values()].map(publico).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

export function normalizaLogin(v) {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

const LOGIN_OK = /^[a-z0-9._-]{3,30}$/;

// ---------- operações ----------
export async function autenticar(login, senha) {
  const u = porLogin(login);
  const ok = await confere(typeof senha === 'string' ? senha.slice(0, SENHA_MAX) : '', u ? u.hash : HASH_FALSO);
  return u && ok && u.ativo ? u : null;
}

export async function criar({ usuario, nome, senha, papel }) {
  const login = normalizaLogin(usuario);
  if (!LOGIN_OK.test(login)) return { erro: 'Usuário: 3 a 30 caracteres (letras minúsculas, números, ponto, hífen e sublinhado).' };
  if (porLogin(login)) return { erro: 'Já existe um usuário com esse login.' };
  const nomeLimpo = String(nome || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!nomeLimpo) return { erro: 'Informe o nome.' };
  if (!PAPEIS.includes(papel)) return { erro: 'Papel inválido.' };
  const erroSenha = validarSenha(senha, login);
  if (erroSenha) return { erro: erroSenha };
  const id = novoId();
  const u = {
    id,
    usuario: login,
    nome: nomeLimpo,
    papel,
    ativo: true,
    hash: await gerarHash(senha),
    precisaTrocarSenha: true, // senha provisória definida por outra pessoa
    criadoEm: new Date().toISOString(),
  };
  usuarios.set(id, u);
  salvar();
  return { usuario: publico(u) };
}

/** Altera nome, papel, ativo e/ou redefine a senha (provisória) de um usuário. */
export async function atualizar(id, { nome, papel, ativo, senha }, { quemId }) {
  const u = usuarios.get(id);
  if (!u) return { erro: 'Usuário não encontrado.' };
  const deixaDeSerAdminAtivo = u.papel === 'admin' && u.ativo && ((papel && papel !== 'admin') || ativo === false);
  if (deixaDeSerAdminAtivo && adminsAtivos().length <= 1) return { erro: 'Deve existir pelo menos um administrador ativo.' };
  if (id === quemId && (ativo === false || (papel && papel !== u.papel))) return { erro: 'Você não pode desativar ou rebaixar a si mesmo.' };

  if (nome !== undefined) {
    const n = String(nome).replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!n) return { erro: 'Informe o nome.' };
    u.nome = n;
  }
  if (papel !== undefined) {
    if (!PAPEIS.includes(papel)) return { erro: 'Papel inválido.' };
    u.papel = papel;
  }
  if (ativo !== undefined) u.ativo = !!ativo;
  if (senha !== undefined) {
    const e = validarSenha(senha, u.usuario);
    if (e) return { erro: e };
    u.hash = await gerarHash(senha);
    u.precisaTrocarSenha = id !== quemId;
  }
  salvar();
  return { usuario: publico(u), sessoesInvalidas: senha !== undefined || ativo === false || papel !== undefined };
}

export async function trocarSenha(id, atual, nova) {
  const u = usuarios.get(id);
  if (!u) return { erro: 'Usuário não encontrado.' };
  if (!(await confere(String(atual || '').slice(0, SENHA_MAX), u.hash))) return { erro: 'A senha atual está incorreta.' };
  const e = validarSenha(nova, u.usuario);
  if (e) return { erro: e };
  if (await confere(nova, u.hash)) return { erro: 'A nova senha precisa ser diferente da atual.' };
  u.hash = await gerarHash(nova);
  u.precisaTrocarSenha = false;
  salvar();
  return { usuario: publico(u) };
}

export function remover(id, { quemId }) {
  const u = usuarios.get(id);
  if (!u) return { erro: 'Usuário não encontrado.' };
  if (id === quemId) return { erro: 'Você não pode excluir a si mesmo.' };
  if (u.papel === 'admin' && u.ativo && adminsAtivos().length <= 1) return { erro: 'Deve existir pelo menos um administrador ativo.' };
  usuarios.delete(id);
  salvar();
  return { ok: true };
}

/** Recuperação: define a senha de um usuário (usado por server/reset-senha.js). */
export async function redefinirSenhaDireto(login, senha) {
  carregar();
  const u = porLogin(login);
  if (!u) return { erro: 'Usuário não encontrado.' };
  const e = validarSenha(senha, u.usuario);
  if (e) return { erro: e };
  u.hash = await gerarHash(senha);
  u.ativo = true;
  u.precisaTrocarSenha = false;
  salvar();
  return { ok: true };
}
