import crypto from 'node:crypto';

/** IP do cliente. Atrás de um proxy confiável (Caddy/nginx na mesma máquina ou rede privada),
 *  usa a última entrada do X-Forwarded-For, que é a que o próprio proxy adicionou. */
const PRIVADO = /^(::1|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::ffff:(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|f[cd][0-9a-f]{2}:)/i;
export function ipCliente(remoto, xff) {
  const r = String(remoto || '');
  if (xff && PRIVADO.test(r)) {
    const partes = String(xff).split(',').map((s) => s.trim()).filter(Boolean);
    if (partes.length) return partes[partes.length - 1];
  }
  return r;
}

/** Limitador simples em memória: após `max` falhas em `janelaMs`, bloqueia por `bloqueioMs`. */
export function criarLimitador({ max, janelaMs, bloqueioMs }) {
  const mapa = new Map(); // chave -> { falhas, inicio, bloqueadoAte }
  setInterval(() => {
    const agora = Date.now();
    for (const [k, v] of mapa) if (v.bloqueadoAte < agora && agora - v.inicio > janelaMs) mapa.delete(k);
  }, 60_000).unref();
  return {
    bloqueado(chave) {
      const v = mapa.get(chave);
      return !!v && v.bloqueadoAte > Date.now();
    },
    falha(chave) {
      const agora = Date.now();
      let v = mapa.get(chave);
      if (!v || agora - v.inicio > janelaMs) v = { falhas: 0, inicio: agora, bloqueadoAte: 0 };
      v.falhas += 1;
      if (v.falhas >= max) v.bloqueadoAte = agora + bloqueioMs;
      mapa.set(chave, v);
    },
    sucesso(chave) {
      mapa.delete(chave);
    },
  };
}

/** Sessões de usuários: o navegador guarda um token aleatório, nunca a senha. */
export function criarSessoes(ttlMs) {
  const sessoes = new Map(); // token -> { usuarioId, expira }
  setInterval(() => {
    const agora = Date.now();
    for (const [t, s] of sessoes) if (s.expira < agora) sessoes.delete(t);
  }, 10 * 60_000).unref();
  return {
    criar(usuarioId) {
      const token = crypto.randomBytes(32).toString('base64url');
      sessoes.set(token, { usuarioId, expira: Date.now() + ttlMs });
      return token;
    },
    /** Retorna o id do usuário dono do token, ou null se inválido/expirado. */
    usuarioDe(token) {
      if (typeof token !== 'string' || !token) return null;
      const s = sessoes.get(token);
      if (!s) return null;
      if (s.expira < Date.now()) {
        sessoes.delete(token);
        return null;
      }
      return s.usuarioId;
    },
    remover(token) {
      sessoes.delete(token);
    },
    /** Encerra todas as sessões de um usuário (troca de senha, desativação, exclusão). */
    removerDoUsuario(usuarioId, manter) {
      for (const [t, s] of sessoes) if (s.usuarioId === usuarioId && t !== manter) sessoes.delete(t);
    },
  };
}

export function cabecalhosSeguranca(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "connect-src 'self'",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  });
  if (req.secure || req.get('x-forwarded-proto') === 'https') {
    res.set('Strict-Transport-Security', 'max-age=15552000');
  }
  next();
}
