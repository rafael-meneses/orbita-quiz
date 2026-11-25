import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useSessao, TelaLogin, TrocarSenha } from './Conta.jsx';
import {
  socket, emit, aguardarConexao, api, lerToken, SessaoExpirada, lerJSON, gravarJSON,
  useEstado, useConectado, useRestante, Barra, Pergunta, Icone, CORES, Logo, ordinal, fmt,
} from './lib.jsx';

const CHAVE_SESSAO = 'orbita:host';

export default function Host() {
  const conectado = useConectado();
  const { estado, setEstado, offset } = useEstado();
  const [sessao, setSessao] = useState(() => lerJSON(sessionStorage, CHAVE_SESSAO));
  const [aviso, setAviso] = useState('');

  const limpar = (msg = '') => {
    gravarJSON(sessionStorage, CHAVE_SESSAO, null);
    setSessao(null);
    setEstado(null);
    setAviso(msg);
  };

  useEffect(() => {
    const retomar = async () => {
      const s = lerJSON(sessionStorage, CHAVE_SESSAO);
      if (!s) return;
      const r = await emit('host:retomar', s);
      if (r.erro && r.erro === 'Partida não encontrada.') limpar('A partida anterior não existe mais.');
    };
    if (socket.connected) retomar();
    socket.on('connect', retomar);
    const enc = () => limpar('Partida encerrada.');
    socket.on('encerrada', enc);
    return () => {
      socket.off('connect', retomar);
      socket.off('encerrada', enc);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app host">
      {!conectado && <div className="faixa-offline">Sem conexão — tentando reconectar…</div>}
      {!sessao ? (
        <Criar aviso={aviso} onCriada={(s) => { gravarJSON(sessionStorage, CHAVE_SESSAO, s); setSessao(s); setAviso(''); }} />
      ) : !estado ? (
        <div className="centro"><h2>Conectando…</h2></div>
      ) : (
        <Partida s={estado} offset={offset} />
      )}
    </div>
  );
}

function Criar({ aviso, onCriada }) {
  const sessao = useSessao();
  const [quizzes, setQuizzes] = useState(null);
  const [quizId, setQuizId] = useState('');
  const [erro, setErro] = useState('');
  const [trocando, setTrocando] = useState(false);

  const u = sessao.usuario;
  const pendente = !!u?.precisaTrocarSenha;

  const criar = async (id = quizId) => {
    setErro('');
    const r = await emit('host:criar', { token: lerToken(), quizId: id });
    if (r.sessao === false) return sessao.expirou();
    if (r.erro) return setErro(r.erro);
    onCriada({ pin: r.pin, hostToken: r.hostToken });
  };

  useEffect(() => {
    if (!u || pendente) return;
    api('/api/quizzes')
      .then(async (lista) => {
        setQuizzes(lista);
        // atalho do painel: /host?quiz=<id> já cria a partida daquele quiz
        const pedido = new URLSearchParams(window.location.search).get('quiz');
        if (pedido) {
          window.history.replaceState(null, '', window.location.pathname); // recarregar não cria outra partida
          if (lista.some((q) => q.id === pedido)) {
            setQuizId(pedido);
            await aguardarConexao();
            return criar(pedido);
          }
          setErro('O quiz escolhido não foi encontrado. Selecione outro abaixo.');
        }
        // prefere os quizzes do próprio usuário
        setQuizId((lista.find((q) => q.meu) || lista[0])?.id || '');
      })
      .catch((e) => (e instanceof SessaoExpirada ? sessao.expirou() : setErro(e.message)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [u?.id, pendente]);

  if (sessao.carregando) return <div className="centro"><h2>Carregando…</h2></div>;
  if (!u) return <TelaLogin titulo="Apresentador" aviso={aviso} onEntrar={sessao.entrar} />;
  if (pendente || trocando) {
    return (
      <TrocarSenha
        obrigatorio={pendente}
        onFeito={(novo) => { sessao.setUsuario(novo); setTrocando(false); }}
        onCancelar={() => setTrocando(false)}
        onSair={sessao.sair}
      />
    );
  }

  return (
    <div className="card entrar">
      <div className="logo"><Logo /> Apresentador</div>
      <p className="sub conta-linha">
        Olá, <strong>{u.nome}</strong>
      </p>
      {aviso && <p className="aviso">{aviso}</p>}
      {quizzes === null ? (
        <p className="sub">Carregando quizzes…</p>
      ) : quizzes.length === 0 ? (
        <p className="aviso">Você ainda não tem quizzes. Crie o primeiro em “Meus quizzes”.</p>
      ) : (
        <label>
          Escolha o quiz
          <select value={quizId} onChange={(e) => setQuizId(e.target.value)}>
            {quizzes.map((q) => (
              <option key={q.id} value={q.id}>
                {q.titulo} ({q.perguntas} perguntas){u.papel === 'admin' && !q.meu && q.donoNome ? ` — ${q.donoNome}` : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      {erro && <p className="erro" role="alert">{erro}</p>}
      <button className="btn grande" onClick={() => criar()} disabled={!quizId}>Criar partida</button>
      <a className="link" href="/admin">Meus quizzes{u.papel === 'admin' ? ' e apresentadores' : ''} →</a>
      <div className="acoes esq conta-acoes">
        <button type="button" className="btn sec peq" onClick={() => setTrocando(true)}>Trocar senha</button>
        <button type="button" className="btn sec peq" onClick={sessao.sair}>Sair</button>
      </div>
    </div>
  );
}

function Partida({ s, offset }) {
  switch (s.estado) {
    case 'lobby': return <Lobby s={s} />;
    case 'intro': return <Intro s={s} offset={offset} />;
    case 'respondendo': return <Respondendo s={s} offset={offset} />;
    case 'revelacao': return <Revelacao s={s} />;
    case 'ranking': return <Ranking s={s} />;
    case 'podio': return <Podio s={s} />;
    default: return null;
  }
}

const avancar = () => emit('host:avancar');

function Lobby({ s }) {
  const [base, setBase] = useState(window.location.origin);
  const [qr, setQr] = useState('');
  const link = `${base.replace(/\/+$/, '')}/?pin=${s.pin}`;

  useEffect(() => {
    api('/api/info').then((info) => {
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
      if (info.publicUrl) setBase(info.publicUrl);
      else if (local && info.lan[0]) setBase(info.lan[0]);
    }).catch(() => {});
  }, []);
  useEffect(() => {
    QRCode.toDataURL(link, { margin: 1, width: 400, color: { dark: '#0b1030', light: '#ffffff' } }).then(setQr).catch(() => setQr(''));
  }, [link]);

  const hostSemPublico = /localhost|127\.0\.0\.1/.test(base);

  return (
    <div className="lobby">
      <header>
        <h1>{s.titulo}</h1>
        <p className="sub">{s.total} perguntas</p>
      </header>
      <div className="entrada">
        <div className="pin-box">
          <span>Entre em <input className="url-edit" value={base} onChange={(e) => setBase(e.target.value)} aria-label="Endereço do site" /></span>
          <span className="rotulo">PIN do jogo</span>
          <div className="pin">{s.pin}</div>
        </div>
        {qr && <img className="qr" src={qr} alt={`QR Code para entrar: ${link}`} />}
      </div>
      {hostSemPublico && <p className="aviso">Este endereço só funciona neste computador. Troque pelo IP da rede ou domínio do evento.</p>}
      <div className="contador-jogadores">👥 {s.qtdJogadores} {s.qtdJogadores === 1 ? 'jogador' : 'jogadores'}</div>
      <div className="chips">
        {s.jogadores.map((j) => (
          <span key={j.id} className={`chip ${j.conectado ? '' : 'off'}`}>
            {j.apelido}
            <button title="Remover jogador" aria-label={`Remover ${j.apelido}`} onClick={() => emit('host:expulsar', { id: j.id })}>×</button>
          </span>
        ))}
        {s.jogadores.length === 0 && <span className="sub">Aguardando jogadores…</span>}
      </div>
      <div className="acoes">
        <button className="btn grande" onClick={avancar} disabled={s.qtdJogadores === 0}>Começar o jogo</button>
        <button className="btn sec" onClick={() => confirm('Encerrar esta partida?') && emit('host:encerrar')}>Cancelar</button>
      </div>
    </div>
  );
}

function Intro({ s, offset }) {
  const ms = useRestante(s.terminaEm, offset);
  return (
    <div className="centro intro">
      <div className="sub">Pergunta {s.indice + 1} de {s.total}</div>
      <h1 className="pergunta-grande">{s.pergunta.texto}</h1>
      <div className="contagem">{Math.max(1, Math.ceil(ms / 1000))}</div>
    </div>
  );
}

function Respondendo({ s, offset }) {
  const ms = useRestante(s.terminaEm, offset);
  const [resp, setResp] = useState({ n: s.respondidos, total: s.qtdJogadores });
  useEffect(() => {
    setResp({ n: s.respondidos, total: s.qtdJogadores });
    const h = (d) => setResp({ n: d.respondidos, total: d.total });
    socket.on('respondidos', h);
    return () => socket.off('respondidos', h);
  }, [s.indice, s.respondidos, s.qtdJogadores]);

  return (
    <div className="questao">
      <Barra ms={ms} totalMs={s.pergunta.tempo * 1000} />
      <div className="linha-topo">
        <span className="sub">Pergunta {s.indice + 1} de {s.total}</span>
        <span className="timer">{Math.ceil(ms / 1000)}</span>
        <span className="sub">{resp.n} / {resp.total} responderam</span>
      </div>
      <Pergunta pergunta={s.pergunta} />
      <Opcoes opcoes={s.pergunta.opcoes} />
      <div className="acoes"><button className="btn sec" onClick={avancar}>Encerrar rodada</button></div>
    </div>
  );
}

function Opcoes({ opcoes, correta, dist }) {
  const max = dist ? Math.max(1, ...dist) : 1;
  return (
    <div className={`opcoes host n${opcoes.length}`}>
      {opcoes.map((o, i) => {
        const estado = correta === undefined ? '' : i === correta ? 'certa' : 'errada';
        return (
          <div key={i} className={`opcao ${CORES[i]} ${estado}`}>
            <Icone i={i} />
            <span className="txt">{o}</span>
            {dist && (
              <span className="dist">
                <span className="dist-barra" style={{ width: `${(dist[i] / max) * 100}%` }} />
                <b>{dist[i]}</b>
              </span>
            )}
            {estado === 'certa' && <span className="check">✔</span>}
          </div>
        );
      })}
    </div>
  );
}

function Revelacao({ s }) {
  const ultima = s.indice === s.total - 1;
  return (
    <div className="questao">
      <div className="linha-topo"><span className="sub">Pergunta {s.indice + 1} de {s.total}</span></div>
      <Pergunta pergunta={s.pergunta} />
      <Opcoes opcoes={s.pergunta.opcoes} correta={s.correta} dist={s.distribuicao} />
      <div className="acoes"><button className="btn grande" onClick={avancar}>{ultima ? 'Ver pódio' : 'Ver ranking'}</button></div>
    </div>
  );
}

function Ranking({ s }) {
  const topo = s.ranking[0]?.pontos || 1;
  return (
    <div className="ranking">
      <h1>Ranking</h1>
      <ol>
        {s.ranking.map((r) => (
          <li key={r.id}>
            <span className="pos">{ordinal(r.posicao)}</span>
            <span className="nome">{r.apelido}</span>
            <span className="bar"><span style={{ width: `${Math.max(4, (r.pontos / topo) * 100)}%` }} /></span>
            <span className="pontos">{fmt(r.pontos)}{r.delta > 0 && <small> +{fmt(r.delta)}</small>}</span>
          </li>
        ))}
      </ol>
      <div className="acoes"><button className="btn grande" onClick={avancar}>Próxima pergunta</button></div>
    </div>
  );
}

function Podio({ s }) {
  const top = s.podio.slice(0, 3);
  const resto = s.podio.slice(3);
  // ordem visual: 2º, 1º, 3º
  const ordem = [top[1], top[0], top[2]];
  const baixar = async () => {
    const r = await emit('host:csv');
    if (r.erro) return alert(r.erro);
    const url = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: r.nome });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="podio-tela">
      <h1>🏆 Pódio</h1>
      <div className="podio">
        {ordem.map((p, i) =>
          p ? (
            <div key={p.id} className={`degrau d${p.posicao}`} style={{ '--delay': `${i === 1 ? 1.4 : i === 0 ? 0.7 : 0}s` }}>
              <div className="medalha">{['🥇', '🥈', '🥉'][p.posicao - 1] || '🏅'}</div>
              <div className="nome">{p.apelido}</div>
              <div className="pontos">{fmt(p.pontos)} pts</div>
              <div className="bloco">{ordinal(p.posicao)}</div>
            </div>
          ) : <div key={`v${i}`} className="degrau vazio" />
        )}
      </div>
      {resto.length > 0 && (
        <ol className="resto" start={4}>
          {resto.map((r) => (
            <li key={r.id}><span className="pos">{ordinal(r.posicao)}</span> {r.apelido} <span className="pontos">{fmt(r.pontos)}</span></li>
          ))}
        </ol>
      )}
      <div className="acoes">
        <button className="btn" onClick={baixar}>Baixar ranking (CSV)</button>
        <button className="btn sec" onClick={() => confirm('Encerrar a partida? O ranking será descartado.') && emit('host:encerrar')}>Encerrar partida</button>
      </div>
    </div>
  );
}
