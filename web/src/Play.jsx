import { useEffect, useState } from 'react';
import { socket, emit, lerJSON, gravarJSON, useEstado, useConectado, useRestante, Barra, Icone, CORES, Logo, NOME_APP, ordinal, fmt } from './lib.jsx';

const CHAVE = 'orbita:jogador';

export default function Play() {
  const conectado = useConectado();
  const { estado, setEstado, offset } = useEstado();
  const [sessao, setSessao] = useState(() => lerJSON(localStorage, CHAVE));
  const [aviso, setAviso] = useState('');
  const [verificando, setVerificando] = useState(!!lerJSON(localStorage, CHAVE));

  const sair = (msg = '') => {
    gravarJSON(localStorage, CHAVE, null);
    setSessao(null);
    setEstado(null);
    setAviso(msg);
    setVerificando(false);
  };

  // retoma a sessão a cada (re)conexão
  useEffect(() => {
    const retomar = async () => {
      const s = lerJSON(localStorage, CHAVE);
      if (!s) return;
      const r = await emit('jogador:retomar', { pin: s.pin, token: s.token });
      if (r.erro && r.erro !== 'O servidor não respondeu.' && r.erro !== 'Sem conexão com o servidor.') sair('Sua sessão expirou ou a partida terminou.');
      else setVerificando(false);
    };
    if (socket.connected) retomar();
    socket.on('connect', retomar);
    const exp = () => sair('Você foi removido da partida pelo apresentador.');
    const enc = () => sair('A partida foi encerrada.');
    socket.on('expulso', exp);
    socket.on('encerrada', enc);
    return () => {
      socket.off('connect', retomar);
      socket.off('expulso', exp);
      socket.off('encerrada', enc);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entrou = (s) => {
    gravarJSON(localStorage, CHAVE, s);
    setSessao(s);
    setAviso('');
  };

  return (
    <div className="app jogador">
      {!conectado && <div className="faixa-offline">Reconectando…</div>}
      {!sessao ? (
        <Entrar aviso={aviso} onEntrou={entrou} />
      ) : !estado ? (
        <Centro emoji="⏳" titulo={verificando ? 'Conectando…' : 'Aguardando…'} />
      ) : (
        <Jogo estado={estado} offset={offset} />
      )}
    </div>
  );
}

function Centro({ emoji, titulo, sub, children }) {
  return (
    <div className="centro">
      {emoji && <div className="emoji">{emoji}</div>}
      <h2>{titulo}</h2>
      {sub && <p className="sub">{sub}</p>}
      {children}
    </div>
  );
}

function Entrar({ aviso, onEntrou }) {
  const pinUrl = new URLSearchParams(window.location.search).get('pin') || '';
  const [pin, setPin] = useState(pinUrl);
  const [apelido, setApelido] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e) => {
    e.preventDefault();
    setErro('');
    setEnviando(true);
    const r = await emit('jogador:entrar', { pin: pin.trim(), apelido });
    setEnviando(false);
    if (r.erro) return setErro(r.erro);
    onEntrou({ pin: r.pin, token: r.token });
  };

  return (
    <form className="card entrar" onSubmit={enviar}>
      <div className="logo"><Logo /> {NOME_APP}</div>
      {aviso && <p className="aviso">{aviso}</p>}
      <label>
        PIN da partida
        <input inputMode="numeric" pattern="[0-9]*" maxLength={6} placeholder="000000" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} autoFocus={!pinUrl} />
      </label>
      <label>
        Seu apelido
        <input maxLength={16} placeholder="Como quer aparecer no ranking?" value={apelido} onChange={(e) => setApelido(e.target.value)} autoFocus={!!pinUrl} />
      </label>
      {erro && <p className="erro">{erro}</p>}
      <button className="btn grande" disabled={enviando || pin.length !== 6 || apelido.trim().length < 2}>
        {enviando ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}

function Jogo({ estado: s, offset }) {
  const eu = s.eu;
  const restante = useRestante(s.terminaEm, offset);
  const [escolhaLocal, setEscolhaLocal] = useState({ indice: -1, opcao: null });
  const [erro, setErro] = useState('');

  const escolha = s.indice === escolhaLocal.indice ? escolhaLocal.opcao : eu.respondeu;
  const jaRespondeu = escolha !== null && escolha !== undefined;

  const responder = async (opcao) => {
    if (jaRespondeu) return;
    setEscolhaLocal({ indice: s.indice, opcao });
    const r = await emit('jogador:responder', { opcao });
    if (r.erro) {
      setErro(r.erro);
      setEscolhaLocal({ indice: -1, opcao: null });
    }
  };

  const topo = (
    <div className="topo">
      <span className="nick">{eu.apelido}</span>
      <span className="pts">{fmt(eu.pontos)} pts</span>
    </div>
  );

  let corpo;
  switch (s.estado) {
    case 'lobby':
      corpo = <Centro emoji="🙌" titulo={`Você está dentro, ${eu.apelido}!`} sub="Olhe para o telão. O jogo começa em instantes." />;
      break;
    case 'intro':
      corpo = <Centro emoji="🚀" titulo={`Pergunta ${s.indice + 1} de ${s.total}`} sub="Prepare-se!" />;
      break;
    case 'respondendo':
      corpo = jaRespondeu ? (
        <Centro emoji="✅" titulo="Resposta enviada!" sub="Aguarde os outros jogadores…">
          <div className={`escolhida ${CORES[escolha]}`}>
            <Icone i={escolha} /> {s.pergunta.opcoes[escolha]}
          </div>
        </Centro>
      ) : (
        <>
          <Barra ms={restante} totalMs={s.pergunta.tempo * 1000} />
          <p className="enunciado">{s.pergunta.texto}</p>
          {erro && <p className="erro">{erro}</p>}
          <div className={`opcoes n${s.pergunta.opcoes.length}`}>
            {s.pergunta.opcoes.map((o, i) => (
              <button key={i} className={`opcao ${CORES[i]}`} onClick={() => responder(i)}>
                <Icone i={i} />
                <span className="txt">{o}</span>
              </button>
            ))}
          </div>
        </>
      );
      break;
    case 'revelacao': {
      const u = eu.ultimo;
      if (!u) corpo = <Centro emoji="😴" titulo="Chegou atrasado!" sub="Fique atento à próxima." />;
      else if (u.correto)
        corpo = (
          <Centro emoji="🎯" titulo="Acertou!" sub={eu.streak > 1 ? `🔥 ${eu.streak} acertos seguidos` : ''}>
            <div className="ganho">+{fmt(u.pontos)}</div>
          </Centro>
        );
      else
        corpo = (
          <Centro emoji={u.escolha === null ? '⏰' : '😬'} titulo={u.escolha === null ? 'Tempo esgotado' : 'Não foi dessa vez'}>
            <div className="certa">
              Resposta certa: <strong>{s.pergunta.opcoes[s.correta]}</strong>
            </div>
          </Centro>
        );
      break;
    }
    case 'ranking':
      corpo = <Centro emoji="📊" titulo={`Você está em ${ordinal(eu.posicao)} lugar`} sub={`${fmt(eu.pontos)} pontos`} />;
      break;
    case 'podio':
      corpo = (
        <Centro emoji={eu.posicao === 1 ? '🏆' : eu.posicao <= 3 ? '🥳' : '🎉'} titulo={`Você terminou em ${ordinal(eu.posicao)} lugar!`} sub={`${fmt(eu.pontos)} pontos — obrigado por jogar`} />
      );
      break;
    default:
      corpo = null;
  }

  return (
    <div className={`tela-jogo ${s.estado === 'revelacao' && eu.ultimo ? (eu.ultimo.correto ? 'ok' : 'ruim') : ''}`}>
      {topo}
      {corpo}
    </div>
  );
}
