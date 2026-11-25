import { useCallback, useEffect, useState } from 'react';
import { api, login, lerToken, gravarToken, Logo } from './lib.jsx';

/** Sessão do usuário logado (apresentador ou administrador), compartilhada por /host e /admin. */
export function useSessao() {
  const [usuario, setUsuario] = useState(null);
  const [carregando, setCarregando] = useState(() => !!lerToken());

  useEffect(() => {
    if (!lerToken()) return;
    api('/api/eu')
      .then(setUsuario)
      .catch(() => gravarToken(''))
      .finally(() => setCarregando(false));
  }, []);

  const entrar = useCallback(async (nome, senha) => setUsuario(await login(nome, senha)), []);

  const sair = useCallback(async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    gravarToken('');
    setUsuario(null);
  }, []);

  /** Chamada quando a API responde 401 (sessão expirada ou desativada). */
  const expirou = useCallback(() => {
    gravarToken('');
    setUsuario(null);
  }, []);

  return { usuario, carregando, entrar, sair, expirou, setUsuario };
}

export function TelaLogin({ titulo, aviso, onEntrar }) {
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e) => {
    e.preventDefault();
    setErro('');
    setEnviando(true);
    try {
      await onEntrar(usuario, senha);
      setSenha('');
    } catch (err) {
      setErro(err.message);
    }
    setEnviando(false);
  };

  return (
    <form className="card entrar" onSubmit={enviar}>
      <div className="logo"><Logo /> {titulo}</div>
      {aviso && <p className="aviso">{aviso}</p>}
      <label>
        Usuário
        <input value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus />
      </label>
      <label>
        Senha
        <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" />
      </label>
      {erro && <p className="erro" role="alert">{erro}</p>}
      <button className="btn grande" disabled={enviando || !usuario || !senha}>{enviando ? 'Entrando…' : 'Entrar'}</button>
    </form>
  );
}

/** Troca de senha. `obrigatorio` = senha provisória: não dá para pular nem cancelar. */
export function TrocarSenha({ obrigatorio, onFeito, onCancelar, onSair }) {
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirma, setConfirma] = useState('');
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e) => {
    e.preventDefault();
    setErro('');
    if (nova !== confirma) return setErro('A confirmação não confere com a nova senha.');
    setEnviando(true);
    try {
      const u = await api('/api/eu/senha', { method: 'POST', json: { atual, nova } });
      setOk(true);
      onFeito?.(u);
    } catch (err) {
      setErro(err.message);
    }
    setEnviando(false);
  };

  return (
    <form className="card entrar" onSubmit={enviar}>
      <div className="logo"><Logo /> {obrigatorio ? 'Defina sua senha' : 'Trocar senha'}</div>
      {obrigatorio && <p className="aviso">Sua senha atual é provisória. Escolha uma nova para continuar.</p>}
      <label>
        Senha atual
        <input type="password" value={atual} onChange={(e) => setAtual(e.target.value)} autoComplete="current-password" autoFocus />
      </label>
      <label>
        Nova senha <span className="sub">(mínimo 8 caracteres)</span>
        <input type="password" value={nova} onChange={(e) => setNova(e.target.value)} autoComplete="new-password" />
      </label>
      <label>
        Repita a nova senha
        <input type="password" value={confirma} onChange={(e) => setConfirma(e.target.value)} autoComplete="new-password" />
      </label>
      {erro && <p className="erro" role="alert">{erro}</p>}
      {ok && <p className="ok-txt">Senha alterada!</p>}
      <button className="btn grande" disabled={enviando || !atual || !nova || !confirma}>Salvar nova senha</button>
      {!obrigatorio && onCancelar && <button type="button" className="btn sec" onClick={onCancelar}>Voltar</button>}
      {obrigatorio && onSair && <button type="button" className="btn sec" onClick={onSair}>Sair</button>}
    </form>
  );
}

export const ROTULO_PAPEL = { admin: 'Administrador', apresentador: 'Apresentador' };
