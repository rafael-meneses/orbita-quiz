import { useEffect, useRef, useState } from 'react';
import { api, midia, SessaoExpirada, Icone, CORES, Logo } from './lib.jsx';
import { useSessao, TelaLogin, TrocarSenha, ROTULO_PAPEL } from './Conta.jsx';
import Usuarios from './Usuarios.jsx';

// sessão expirada no meio da edição: não descarta o que foi digitado
const erroTexto = (e) =>
  e instanceof SessaoExpirada
    ? 'Sessão expirada. Exporte o JSON, entre novamente em outra aba e importe-o, ou recarregue a página.'
    : e.message || 'Falha na requisição.';

const perguntaNova = (tipo = 'multipla') => ({
  tipo,
  texto: '',
  imagem: '',
  opcoes: tipo === 'vf' ? ['Verdadeiro', 'Falso'] : ['', '', '', ''],
  correta: 0,
  tempo: 20,
  pontos: 1000,
});

export default function Admin() {
  const sessao = useSessao();
  const u = sessao.usuario;
  const ehAdmin = u?.papel === 'admin';
  const pendente = !!u?.precisaTrocarSenha;
  const [aba, setAba] = useState('quizzes'); // quizzes | usuarios | conta
  const [lista, setLista] = useState(null);
  const [filtro, setFiltro] = useState('todos'); // administradores: 'todos' | 'meus'
  const [erro, setErro] = useState('');
  const [editando, setEditando] = useState(null); // { id|null, quiz }

  const tratar = (e) => (e instanceof SessaoExpirada ? sessao.expirou() : setErro(e.message));

  const recarregar = () =>
    api('/api/quizzes')
      .then(setLista)
      .catch(tratar);

  useEffect(() => {
    if (u && !pendente) recarregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [u?.id, pendente]);

  if (sessao.carregando) return <div className="app admin"><div className="centro"><h2>Carregando…</h2></div></div>;

  if (!u) {
    return (
      <div className="app admin">
        <TelaLogin titulo="Painel" onEntrar={sessao.entrar} />
      </div>
    );
  }

  if (pendente) {
    return (
      <div className="app admin">
        <TrocarSenha obrigatorio onFeito={sessao.setUsuario} onSair={sessao.sair} />
      </div>
    );
  }

  if (editando) {
    return (
      <Editor
        inicial={editando}
        onVoltar={async () => {
          setEditando(null);
          await recarregar();
        }}
      />
    );
  }

  const abrir = async (id) => {
    try {
      setEditando({ id, quiz: await api(`/api/quizzes/${id}`) });
    } catch (e) {
      tratar(e);
    }
  };
  const duplicar = async (q) => {
    try {
      const quiz = await api(`/api/quizzes/${q.id}`);
      setEditando({ id: null, quiz: { titulo: `${quiz.titulo} (cópia)`.slice(0, 100), perguntas: quiz.perguntas } });
    } catch (e) {
      tratar(e);
    }
  };
  const excluir = async (q) => {
    if (!confirm(`Excluir o quiz "${q.titulo}"? Não dá para desfazer.`)) return;
    try {
      await api(`/api/quizzes/${q.id}`, { method: 'DELETE' });
      recarregar();
    } catch (e) {
      tratar(e);
    }
  };
  const importar = async (file) => {
    try {
      const quiz = JSON.parse(await file.text());
      setEditando({ id: null, quiz: { titulo: quiz.titulo || file.name.replace(/\.json$/, ''), perguntas: quiz.perguntas || [] } });
    } catch {
      alert('Arquivo JSON inválido.');
    }
  };

  const visiveis = (lista || []).filter((q) => !ehAdmin || filtro === 'todos' || q.meu);

  return (
    <div className="app admin">
      <div className="admin-wrap">
        <header className="admin-topo">
          <div className="logo esq"><Logo /> Órbita</div>
          <div className="acoes esq">
            <span className="sub">{u.nome} · {u.usuario}</span>
            <a className="btn peq" href="/host">Iniciar partida</a>
            <button className="btn sec peq" onClick={sessao.sair}>Sair</button>
          </div>
        </header>

        <nav className="abas" role="tablist">
          <button role="tab" aria-selected={aba === 'quizzes'} className={aba === 'quizzes' ? 'ativa' : ''} onClick={() => setAba('quizzes')}>Meus quizzes</button>
          {ehAdmin && <button role="tab" aria-selected={aba === 'usuarios'} className={aba === 'usuarios' ? 'ativa' : ''} onClick={() => setAba('usuarios')}>Apresentadores</button>}
          <button role="tab" aria-selected={aba === 'conta'} className={aba === 'conta' ? 'ativa' : ''} onClick={() => setAba('conta')}>Minha conta</button>
        </nav>

        {erro && <p className="erro" role="alert">{erro}</p>}

        {aba === 'quizzes' && (
          <>
            <div className="acoes esq">
              <button className="btn" onClick={() => setEditando({ id: null, quiz: { titulo: '', perguntas: [perguntaNova()] } })}>+ Novo quiz</button>
              <label className="btn sec">
                Importar JSON
                <input type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files[0] && importar(e.target.files[0])} />
              </label>
              {ehAdmin && (
                <select className="filtro" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Filtrar quizzes">
                  <option value="todos">Todos os quizzes</option>
                  <option value="meus">Só os meus</option>
                </select>
              )}
            </div>
            <ul className="lista-quiz">
              {visiveis.map((q) => (
                <li key={q.id}>
                  <div>
                    <strong>{q.titulo}</strong>
                    <span className="sub"> · {q.perguntas} perguntas</span>
                    {ehAdmin && !q.meu && <span className="chip-papel">{q.donoNome || 'sem dono'}</span>}
                  </div>
                  <div className="acoes esq">
                    <a className="btn peq" href={`/host?quiz=${encodeURIComponent(q.id)}`} title="Abre a tela do apresentador já com uma partida deste quiz">▶ Iniciar partida</a>
                    <button className="btn sec peq" onClick={() => abrir(q.id)}>Editar</button>
                    <button className="btn sec peq" onClick={() => duplicar(q)}>Duplicar</button>
                    <button className="btn sec peq" onClick={() => excluir(q)}>Excluir</button>
                  </div>
                </li>
              ))}
              {lista && visiveis.length === 0 && <li className="sub">Nenhum quiz ainda. Crie o primeiro!</li>}
              {!lista && <li className="sub">Carregando…</li>}
            </ul>
          </>
        )}

        {aba === 'usuarios' && ehAdmin && <Usuarios euId={u.id} onExpirou={sessao.expirou} />}

        {aba === 'conta' && (
          <TrocarSenha
            onFeito={(novo) => sessao.setUsuario(novo)}
            onCancelar={() => setAba('quizzes')}
          />
        )}
      </div>
    </div>
  );
}

function Editor({ inicial, onVoltar }) {
  const [id, setId] = useState(inicial.id);
  const [quiz, setQuiz] = useState(inicial.quiz);
  const [msg, setMsg] = useState(null); // { tipo, texto }
  const [salvando, setSalvando] = useState(false);
  const [sujo, setSujo] = useState(false);
  const fimRef = useRef(null);

  const alterar = (fn) => { setQuiz((q) => fn(structuredClone(q))); setSujo(true); setMsg(null); };
  const setP = (i, campo, valor) => alterar((q) => { q.perguntas[i][campo] = valor; return q; });

  const mudarTipo = (i, tipo) =>
    alterar((q) => {
      const p = q.perguntas[i];
      p.tipo = tipo;
      p.opcoes = tipo === 'vf' ? ['Verdadeiro', 'Falso'] : ['', '', '', ''];
      p.correta = 0;
      return q;
    });

  const mover = (i, d) =>
    alterar((q) => {
      const j = i + d;
      if (j < 0 || j >= q.perguntas.length) return q;
      [q.perguntas[i], q.perguntas[j]] = [q.perguntas[j], q.perguntas[i]];
      return q;
    });

  const remover = (i) => alterar((q) => { q.perguntas.splice(i, 1); return q; });
  const duplicar = (i) => alterar((q) => { q.perguntas.splice(i + 1, 0, structuredClone(q.perguntas[i])); return q; });

  const upload = async (i, file) => {
    try {
      const corpo = await api('/api/upload', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
      setP(i, 'imagem', corpo.url);
    } catch (e) {
      setMsg({ tipo: 'erro', texto: erroTexto(e) });
    }
  };

  const salvar = async () => {
    // remove alternativas vazias no fim da lista (permite 2 ou 3 opções)
    const limpo = structuredClone(quiz);
    for (const [n, p] of limpo.perguntas.entries()) {
      if (p.tipo !== 'multipla') continue;
      while (p.opcoes.length > 2 && !String(p.opcoes[p.opcoes.length - 1]).trim()) p.opcoes.pop();
      if (p.correta >= p.opcoes.length) return setMsg({ tipo: 'erro', texto: `Pergunta ${n + 1}: a alternativa correta está vazia.` });
    }
    setSalvando(true);
    try {
      const corpo = JSON.stringify(limpo);
      const salvo = id
        ? await api(`/api/quizzes/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: corpo })
        : await api('/api/quizzes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo });
      setId(salvo.id);
      setQuiz(salvo);
      setSujo(false);
      setMsg({ tipo: 'ok', texto: 'Quiz salvo!' });
    } catch (e) {
      setMsg({ tipo: 'erro', texto: erroTexto(e) });
    }
    setSalvando(false);
  };

  const exportar = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(quiz, null, 2)], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: `${id || 'quiz'}.json` }).click();
    URL.revokeObjectURL(url);
  };

  const voltar = () => (!sujo || confirm('Há alterações não salvas. Sair mesmo assim?')) && onVoltar();

  return (
    <div className="app admin">
      <div className="admin-wrap">
        <header className="admin-topo sticky">
          <button className="btn sec peq" onClick={voltar}>← Voltar</button>
          <div className="acoes esq">
            {msg && <span className={msg.tipo === 'ok' ? 'ok-txt' : 'erro'}>{msg.texto}</span>}
            <button className="btn sec peq" onClick={exportar}>Exportar JSON</button>
            <button className="btn peq" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : sujo ? 'Salvar *' : 'Salvar'}</button>
          </div>
        </header>

        <label className="campo">
          Título do quiz
          <input maxLength={100} value={quiz.titulo} onChange={(e) => alterar((q) => { q.titulo = e.target.value; return q; })} placeholder="Ex.: Integração do time 2026" />
        </label>

        {quiz.perguntas.map((p, i) => (
          <section className="card pergunta-edit" key={i}>
            <div className="pe-topo">
              <strong>Pergunta {i + 1}</strong>
              <div className="acoes esq">
                <button className="btn sec peq" onClick={() => mover(i, -1)} disabled={i === 0} aria-label="Subir">↑</button>
                <button className="btn sec peq" onClick={() => mover(i, 1)} disabled={i === quiz.perguntas.length - 1} aria-label="Descer">↓</button>
                <button className="btn sec peq" onClick={() => duplicar(i)}>Duplicar</button>
                <button className="btn sec peq" onClick={() => remover(i)} disabled={quiz.perguntas.length === 1}>Remover</button>
              </div>
            </div>
            <label className="campo">
              Enunciado
              <textarea rows={2} maxLength={300} value={p.texto} onChange={(e) => setP(i, 'texto', e.target.value)} />
            </label>
            <div className="linha">
              <label className="campo">
                Tipo
                <select value={p.tipo} onChange={(e) => mudarTipo(i, e.target.value)}>
                  <option value="multipla">Múltipla escolha</option>
                  <option value="vf">Verdadeiro ou falso</option>
                </select>
              </label>
              <label className="campo">
                Tempo (s)
                <input type="number" min={5} max={120} value={p.tempo} onChange={(e) => setP(i, 'tempo', e.target.value === '' ? '' : Number(e.target.value))} />
              </label>
              <label className="campo">
                Pontos
                <input type="number" min={100} max={2000} step={100} value={p.pontos} onChange={(e) => setP(i, 'pontos', e.target.value === '' ? '' : Number(e.target.value))} />
              </label>
            </div>
            <div className="campo">
              Imagem (opcional)
              <div className="linha">
                <input placeholder="Cole um link ou envie um arquivo" value={p.imagem} onChange={(e) => setP(i, 'imagem', e.target.value)} />
                <label className="btn sec peq">
                  Enviar
                  <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => e.target.files[0] && upload(i, e.target.files[0])} />
                </label>
              </div>
              {p.imagem && <img className="prev" src={midia(p.imagem)} alt="Pré-visualização" />}
            </div>
            <div className="campo">
              Alternativas <span className="sub">(marque a correta)</span>
              {p.opcoes.map((o, k) => (
                <div key={k} className={`alt ${CORES[k]}`}>
                  <input type="radio" name={`c${i}`} checked={p.correta === k} onChange={() => setP(i, 'correta', k)} aria-label={`Alternativa ${k + 1} é a correta`} />
                  <Icone i={k} />
                  {p.tipo === 'vf' ? (
                    <span>{o}</span>
                  ) : (
                    <input maxLength={120} placeholder={`Alternativa ${k + 1}${k > 1 ? ' (opcional)' : ''}`} value={o} onChange={(e) => alterar((q) => { q.perguntas[i].opcoes[k] = e.target.value; return q; })} />
                  )}
                </div>
              ))}
              {p.tipo === 'multipla' && <p className="sub">Deixe as alternativas 3 e 4 vazias para usar só 2 ou 3 opções.</p>}
            </div>
          </section>
        ))}

        <div className="acoes esq">
          <button
            className="btn"
            onClick={() => { alterar((q) => { q.perguntas.push(perguntaNova()); return q; }); setTimeout(() => fimRef.current?.scrollIntoView({ behavior: 'smooth' }), 50); }}
          >
            + Adicionar pergunta
          </button>
        </div>
        <div ref={fimRef} />
      </div>
    </div>
  );
}
