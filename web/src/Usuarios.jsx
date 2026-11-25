import { useEffect, useState } from 'react';
import { api, SessaoExpirada } from './lib.jsx';
import { ROTULO_PAPEL } from './Conta.jsx';

const ALFABETO = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem caracteres ambíguos (l, 1, O, 0, I)
const senhaAleatoria = (n = 12) => {
  const buf = new Uint32Array(n);
  crypto.getRandomValues(buf);
  return Array.from(buf, (x) => ALFABETO[x % ALFABETO.length]).join('');
};

const data = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '');

export default function Usuarios({ euId, onExpirou }) {
  const [lista, setLista] = useState([]);
  const [msg, setMsg] = useState(null); // { tipo: 'ok'|'erro', texto }
  const [form, setForm] = useState({ usuario: '', nome: '', papel: 'apresentador', senha: senhaAleatoria() });
  const [enviando, setEnviando] = useState(false);
  const [provisoria, setProvisoria] = useState(null); // { nome, usuario, senha } — mostrada uma única vez

  const tratar = (e) => {
    if (e instanceof SessaoExpirada) return onExpirou();
    setMsg({ tipo: 'erro', texto: e.message });
  };

  const recarregar = () => api('/api/usuarios').then(setLista).catch(tratar);
  useEffect(() => {
    recarregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const criar = async (e) => {
    e.preventDefault();
    setMsg(null);
    setEnviando(true);
    try {
      const novo = await api('/api/usuarios', { method: 'POST', json: form });
      setProvisoria({ nome: novo.nome, usuario: novo.usuario, senha: form.senha });
      setForm({ usuario: '', nome: '', papel: 'apresentador', senha: senhaAleatoria() });
      await recarregar();
    } catch (err) {
      tratar(err);
    }
    setEnviando(false);
  };

  const alterar = async (u, dados, texto) => {
    setMsg(null);
    try {
      await api(`/api/usuarios/${u.id}`, { method: 'PUT', json: dados });
      if (texto) setMsg({ tipo: 'ok', texto });
      await recarregar();
    } catch (err) {
      tratar(err);
    }
  };

  const redefinir = async (u) => {
    const senha = senhaAleatoria();
    if (!confirm(`Redefinir a senha de ${u.nome}? Ele(a) será desconectado(a) e terá que criar uma nova senha no próximo acesso.`)) return;
    setMsg(null);
    try {
      await api(`/api/usuarios/${u.id}`, { method: 'PUT', json: { senha } });
      setProvisoria({ nome: u.nome, usuario: u.usuario, senha });
      await recarregar();
    } catch (err) {
      tratar(err);
    }
  };

  const excluir = async (u) => {
    if (!confirm(`Excluir ${u.nome} (${u.usuario})? Os quizzes dessa pessoa serão transferidos para você. Não dá para desfazer.`)) return;
    setMsg(null);
    try {
      const r = await api(`/api/usuarios/${u.id}`, { method: 'DELETE' });
      setMsg({ tipo: 'ok', texto: r.quizzesTransferidos ? `Usuário excluído. ${r.quizzesTransferidos} quiz(zes) transferido(s) para você.` : 'Usuário excluído.' });
      await recarregar();
    } catch (err) {
      tratar(err);
    }
  };

  const copiar = (texto) => navigator.clipboard?.writeText(texto).catch(() => {});

  return (
    <div className="usuarios">
      {provisoria && (
        <div className="card provisoria" role="status">
          <strong>Senha provisória de {provisoria.nome}</strong>
          <p className="sub">Ela só aparece agora. Envie ao usuário por um canal seguro; no primeiro acesso ele(a) será obrigado(a) a trocá-la.</p>
          <code>{provisoria.usuario} / {provisoria.senha}</code>
          <div className="acoes esq">
            <button className="btn peq" onClick={() => copiar(`Usuário: ${provisoria.usuario}\nSenha provisória: ${provisoria.senha}`)}>Copiar</button>
            <button className="btn sec peq" onClick={() => setProvisoria(null)}>Fechar</button>
          </div>
        </div>
      )}

      <form className="card form-usuario" onSubmit={criar}>
        <strong>Novo usuário</strong>
        <div className="linha">
          <label className="campo">
            Nome
            <input value={form.nome} maxLength={60} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Maria Souza" />
          </label>
          <label className="campo">
            Usuário (login)
            <input value={form.usuario} maxLength={30} autoCapitalize="none" spellCheck={false} onChange={(e) => setForm({ ...form, usuario: e.target.value.toLowerCase() })} placeholder="maria.souza" />
          </label>
        </div>
        <div className="linha">
          <label className="campo">
            Papel
            <select value={form.papel} onChange={(e) => setForm({ ...form, papel: e.target.value })}>
              <option value="apresentador">Apresentador (cria e conduz os próprios quizzes)</option>
              <option value="admin">Administrador (gerencia usuários e todos os quizzes)</option>
            </select>
          </label>
          <div className="campo">
            Senha provisória
            <div className="linha">
              <input value={form.senha} onChange={(e) => setForm({ ...form, senha: e.target.value })} spellCheck={false} />
              <button type="button" className="btn sec peq" onClick={() => setForm({ ...form, senha: senhaAleatoria() })}>Gerar outra</button>
            </div>
          </div>
        </div>
        {msg && <p className={msg.tipo === 'ok' ? 'ok-txt' : 'erro'} role={msg.tipo === 'erro' ? 'alert' : 'status'}>{msg.texto}</p>}
        <div className="acoes esq">
          <button className="btn" disabled={enviando || !form.usuario || !form.nome || form.senha.length < 8}>{enviando ? 'Criando…' : 'Criar usuário'}</button>
        </div>
      </form>

      <ul className="lista-quiz">
        {lista.map((u) => (
          <li key={u.id} className={u.ativo ? '' : 'inativo'}>
            <div>
              <strong>{u.nome}</strong> <span className="sub">· {u.usuario}</span>
              {u.id === euId && <span className="chip-papel">você</span>}
              <span className={`chip-papel ${u.papel}`}>{ROTULO_PAPEL[u.papel]}</span>
              {!u.ativo && <span className="chip-papel off">Desativado</span>}
              {u.precisaTrocarSenha && <span className="chip-papel pend">Senha provisória</span>}
              <div className="sub peq-txt">Criado em {data(u.criadoEm)}</div>
            </div>
            <div className="acoes esq">
              <button className="btn sec peq" onClick={() => redefinir(u)}>Redefinir senha</button>
              {u.id !== euId && (
                <>
                  <button className="btn sec peq" onClick={() => alterar(u, { ativo: !u.ativo })}>{u.ativo ? 'Desativar' : 'Ativar'}</button>
                  <button className="btn sec peq" onClick={() => alterar(u, { papel: u.papel === 'admin' ? 'apresentador' : 'admin' }, 'Papel alterado.')}>
                    {u.papel === 'admin' ? 'Tornar apresentador' : 'Tornar admin'}
                  </button>
                  <button className="btn sec peq" onClick={() => excluir(u)}>Excluir</button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
