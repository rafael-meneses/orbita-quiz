import { useEffect, useState } from 'react';
import { api, SessaoExpirada, ordinal, fmt } from './lib.jsx';

const NOMES_MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const rotuloMes = (m) => `${NOMES_MES[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`;
const dataHora = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const duracao = (a, b) => {
  const seg = Math.max(0, Math.round((new Date(b) - new Date(a)) / 1000));
  if (seg < 60) return `${seg} s`;
  const min = Math.round(seg / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
};
const segundos = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(1).replace('.', ',')} s`);
const kb = (b) => (b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

export default function Historico({ ehAdmin, onExpirou }) {
  const [meses, setMeses] = useState(null);
  const [bytes, setBytes] = useState(null);
  const [mes, setMes] = useState('');
  const [lista, setLista] = useState(null);
  const [aberta, setAberta] = useState(null);
  const [erro, setErro] = useState('');

  const tratar = (e) => (e instanceof SessaoExpirada ? onExpirou() : setErro(e.message));

  useEffect(() => {
    api('/api/historico/meses')
      .then((r) => {
        setMeses(r.meses);
        setBytes(r.bytes ?? null);
        setMes(r.meses[0]?.mes || '');
      })
      .catch(tratar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mes) return;
    setLista(null);
    api(`/api/historico?mes=${encodeURIComponent(mes)}`).then(setLista).catch(tratar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mes]);

  const abrir = (id) => api(`/api/historico/${encodeURIComponent(id)}`).then(setAberta).catch(tratar);

  if (aberta) return <Detalhe p={aberta} ehAdmin={ehAdmin} onVoltar={() => setAberta(null)} />;

  return (
    <div className="historico">
      {erro && <p className="erro" role="alert">{erro}</p>}
      {meses && meses.length === 0 && (
        <p className="sub">Nenhuma partida registrada ainda. As partidas entram aqui ao chegar ao pódio, ou ao serem encerradas depois de pelo menos uma pergunta.</p>
      )}
      {meses && meses.length > 0 && (
        <div className="acoes esq">
          <select className="filtro" value={mes} onChange={(e) => setMes(e.target.value)} aria-label="Mês">
            {meses.map((m) => (
              <option key={m.mes} value={m.mes}>
                {rotuloMes(m.mes)} ({m.partidas} {m.partidas === 1 ? 'partida' : 'partidas'})
              </option>
            ))}
          </select>
          {bytes != null && <span className="sub">Espaço ocupado pelo histórico: {kb(bytes)}</span>}
        </div>
      )}
      <ul className="lista-quiz">
        {mes && !lista && <li className="sub">Carregando…</li>}
        {lista?.map((p) => (
          <li key={p.id} className="clicavel" onClick={() => abrir(p.id)} onKeyDown={(e) => e.key === 'Enter' && abrir(p.id)} tabIndex={0} role="button">
            <div>
              <strong>{p.quiz.titulo}</strong>
              {p.status === 'interrompida' && <span className="chip-papel off">Interrompida</span>}
              <div className="sub peq-txt">
                {dataHora(p.inicio)} · {duracao(p.inicio, p.fim)} · {p.jogadores} {p.jogadores === 1 ? 'jogador' : 'jogadores'}
                {p.status === 'interrompida' && ` · ${p.perguntasJogadas} de ${p.quiz.perguntas} perguntas`}
                {ehAdmin && p.apresentador && ` · conduzida por ${p.apresentador.nome}`}
              </div>
            </div>
            <div className="vencedor">
              {p.vencedor ? (
                <>
                  🏆 <strong>{p.vencedor.apelido}</strong> <span className="sub">{fmt(p.vencedor.pontos)} pts</span>
                </>
              ) : (
                <span className="sub">sem jogadores</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Detalhe({ p, ehAdmin, onVoltar }) {
  const baixarCsv = () => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const linhas = [['Posição', 'Apelido', 'Pontos', 'Acertos', 'Perguntas jogadas', 'Tempo médio dos acertos (s)'].map(esc).join(';')];
    for (const r of p.ranking) {
      linhas.push([r.posicao, r.apelido, r.pontos, r.acertos, p.perguntas.length, r.msMedioAcertos == null ? '' : (r.msMedioAcertos / 1000).toFixed(1).replace('.', ',')].map(esc).join(';'));
    }
    const url = URL.createObjectURL(new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    Object.assign(document.createElement('a'), { href: url, download: `ranking-${p.inicio.slice(0, 10)}-${p.pin}.csv` }).click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="historico detalhe">
      <div className="acoes esq">
        <button className="btn sec peq" onClick={onVoltar}>← Voltar</button>
        <button className="btn peq" onClick={baixarCsv}>Baixar ranking (CSV)</button>
      </div>

      <section className="card">
        <h2>{p.quiz.titulo}</h2>
        <p className="sub">
          {dataHora(p.inicio)} · {duracao(p.inicio, p.fim)} · {p.ranking.length} jogadores · {p.perguntas.length} de {p.quiz.perguntas} perguntas
          {p.status === 'interrompida' && ' · interrompida'}
          {ehAdmin && p.apresentador && ` · conduzida por ${p.apresentador.nome}`}
        </p>
      </section>

      <section className="card">
        <h3>Ranking</h3>
        <table className="tabela">
          <thead>
            <tr><th>#</th><th>Apelido</th><th className="num">Pontos</th><th className="num">Acertos</th><th className="num">Tempo médio</th></tr>
          </thead>
          <tbody>
            {p.ranking.map((r, i) => (
              <tr key={i} className={r.posicao <= 3 ? `top top${r.posicao}` : ''}>
                <td>{ordinal(r.posicao)}</td>
                <td>{r.apelido}</td>
                <td className="num">{fmt(r.pontos)}</td>
                <td className="num">{r.acertos}/{p.perguntas.length}</td>
                <td className="num">{segundos(r.msMedioAcertos)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h3>Perguntas</h3>
        <ol className="perguntas-hist">
          {p.perguntas.map((q, i) => {
            const respostas = q.dist.reduce((a, b) => a + b, 0);
            const acertos = q.dist[q.correta] || 0;
            const taxa = q.jogadores ? Math.round((acertos / q.jogadores) * 100) : 0;
            return (
              <li key={i}>
                <div className="pq-topo">
                  <strong>{q.texto}</strong>
                  <span className={`taxa ${taxa >= 70 ? 'alta' : taxa >= 40 ? 'media' : 'baixa'}`}>{taxa}% acertaram</span>
                </div>
                <div className="sub peq-txt">
                  {respostas} de {q.jogadores} responderam · tempo médio dos acertos {segundos(q.msMedioAcertos)}
                </div>
                <ul className="dist-hist">
                  {q.opcoes.map((o, k) => {
                    const pct = respostas ? Math.round((q.dist[k] / respostas) * 100) : 0;
                    return (
                      <li key={k} className={k === q.correta ? 'correta' : ''}>
                        <span className="op">{k === q.correta ? '✔ ' : ''}{o}</span>
                        <span className="barra-h"><span style={{ width: `${pct}%` }} /></span>
                        <span className="n">{q.dist[k]}</span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
