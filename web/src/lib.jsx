import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

// Endereço do servidor. Vazio = mesmo domínio do front.
// Para hospedar o front numa CDN, compile com VITE_API_URL=https://api.seudominio.com
export const API_URL = String(import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

export const socket = API_URL ? io(API_URL, { autoConnect: true }) : io({ autoConnect: true });

/** Imagens enviadas ficam no servidor (/uploads/...); links externos são usados como estão. */
export const midia = (src) => (src && src.startsWith('/uploads/') ? `${API_URL}${src}` : src);

// ---------- sessão de administrador (token, nunca a senha) ----------
const CHAVE_TOKEN = 'orbita:token';
export const lerToken = () => {
  try {
    return sessionStorage.getItem(CHAVE_TOKEN) || '';
  } catch {
    return '';
  }
};
export const gravarToken = (t) => {
  try {
    if (t) sessionStorage.setItem(CHAVE_TOKEN, t);
    else sessionStorage.removeItem(CHAVE_TOKEN);
  } catch {
    /* armazenamento indisponível */
  }
};

export class SessaoExpirada extends Error {}

/** fetch na API com o token; lança SessaoExpirada em 401. */
export async function api(caminho, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const token = lerToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts = { ...opts, body: JSON.stringify(opts.json) };
  }
  let r;
  try {
    r = await fetch(`${API_URL}${caminho}`, { ...opts, headers });
  } catch {
    throw new Error('Sem conexão com o servidor.');
  }
  const corpo = await r.json().catch(() => ({}));
  if (r.status === 401 && caminho !== '/api/login') {
    gravarToken('');
    throw new SessaoExpirada(corpo.erro || 'Sessão expirada.');
  }
  if (!r.ok) {
    const erro = new Error(corpo.erro || 'Falha na requisição.');
    erro.trocarSenha = !!corpo.trocarSenha; // senha provisória: o usuário precisa defini-la antes de continuar
    throw erro;
  }
  return corpo;
}

/** Entra com usuário e senha; guarda só o token e devolve os dados do usuário. */
export async function login(usuario, senha) {
  const { token, usuario: dados } = await api('/api/login', { method: 'POST', json: { usuario, senha } });
  gravarToken(token);
  return dados;
}

/** Resolve quando o socket estiver conectado (ou após `ms`, para não travar a tela). */
export const aguardarConexao = (ms = 5000) =>
  new Promise((resolve) => {
    if (socket.connected) return resolve();
    const t = setTimeout(resolve, ms);
    socket.once('connect', () => {
      clearTimeout(t);
      resolve();
    });
  });

export const emit = (evento, dados) =>
  new Promise((resolve) => {
    if (!socket.connected) return resolve({ erro: 'Sem conexão com o servidor.' });
    socket.timeout(8000).emit(evento, dados || {}, (err, res) => resolve(err ? { erro: 'O servidor não respondeu.' } : res));
  });

export const lerJSON = (storage, chave) => {
  try {
    return JSON.parse(storage.getItem(chave));
  } catch {
    return null;
  }
};
export const gravarJSON = (storage, chave, valor) => {
  try {
    if (valor == null) storage.removeItem(chave);
    else storage.setItem(chave, JSON.stringify(valor));
  } catch {
    /* armazenamento indisponível */
  }
};

/** Estado do jogo enviado pelo servidor + diferença de relógio servidor/cliente. */
export function useEstado() {
  const [estado, setEstado] = useState(null);
  const offset = useRef(0);
  useEffect(() => {
    const h = (s) => {
      offset.current = s.agora - Date.now();
      setEstado(s);
    };
    socket.on('estado', h);
    return () => socket.off('estado', h);
  }, []);
  return { estado, setEstado, offset };
}

export function useConectado() {
  const [on, setOn] = useState(socket.connected);
  useEffect(() => {
    const a = () => setOn(true);
    const b = () => setOn(false);
    socket.on('connect', a);
    socket.on('disconnect', b);
    return () => {
      socket.off('connect', a);
      socket.off('disconnect', b);
    };
  }, []);
  return on;
}

/** Milissegundos restantes até `terminaEm` (relógio do servidor). */
export function useRestante(terminaEm, offset) {
  const calc = () => (terminaEm ? Math.max(0, terminaEm - (Date.now() + offset.current)) : 0);
  const [ms, setMs] = useState(calc);
  useEffect(() => {
    setMs(calc());
    if (!terminaEm) return undefined;
    const t = setInterval(() => setMs(calc()), 100);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminaEm]);
  return ms;
}

export { Icone, CORES, NOMES_ICONES, Logo } from './icons.jsx';
export const NOME_APP = 'Órbita';

export function Barra({ ms, totalMs }) {
  const pct = totalMs ? Math.min(100, (ms / totalMs) * 100) : 0;
  return (
    <div className="barra" role="progressbar" aria-valuenow={Math.ceil(ms / 1000)}>
      <div className="barra-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Pergunta({ pergunta }) {
  return (
    <div className="pergunta">
      <h1>{pergunta.texto}</h1>
      {pergunta.imagem && <img src={midia(pergunta.imagem)} alt="" referrerPolicy="no-referrer" />}
    </div>
  );
}

export const ordinal = (n) => `${n}º`;
export const fmt = (n) => Number(n).toLocaleString('pt-BR');
