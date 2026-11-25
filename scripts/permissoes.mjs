// Teste de permissões e do cadastro de usuários contra um servidor em execução.
// Uso: node scripts/permissoes.mjs [URL=http://localhost:3000] [SENHA_ADMIN=admin] [USUARIO_ADMIN=admin]
// Cria usuários de teste (prefixo "t-") e os remove no final.
import { io } from 'socket.io-client';

const URL = process.argv[2] || 'http://localhost:3000';
const SENHA = process.argv[3] || process.env.ADMIN_PASSWORD || 'admin';
const ADMIN = process.argv[4] || process.env.ADMIN_USER || 'admin';

let falhas = 0;
const confere = (ok, nome, extra = '') => {
  console.log(`${ok ? '  ok ' : ' FALHA'} ${nome}${ok ? '' : ` ${extra}`}`);
  if (!ok) falhas++;
};

async function req(metodo, caminho, { token, json } = {}) {
  const r = await fetch(`${URL}${caminho}`, {
    method: metodo,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}) },
    body: json ? JSON.stringify(json) : undefined,
  });
  return { status: r.status, corpo: await r.json().catch(() => ({})) };
}
const login = (usuario, senha) => req('POST', '/api/login', { json: { usuario, senha } });
const emit = (s, ev, dados) => new Promise((res) => s.emit(ev, dados, res));

const quizModelo = (titulo) => ({
  titulo,
  perguntas: [{ tipo: 'vf', texto: 'O céu é azul?', opcoes: ['Verdadeiro', 'Falso'], correta: 0, tempo: 10, pontos: 500 }],
});

const sufixo = Math.random().toString(36).slice(2, 7);
const ana = `t-ana-${sufixo}`;
const beto = `t-beto-${sufixo}`;
const SENHA_PROV = 'provisoria-123';
const SENHA_NOVA = 'senha-nova-456';

console.log('Login do administrador');
const adm = await login(ADMIN, SENHA);
confere(adm.status === 200 && adm.corpo.token && adm.corpo.usuario?.papel === 'admin', 'admin entra com usuário e senha', JSON.stringify(adm));
const tAdm = adm.corpo.token;
confere(!JSON.stringify(adm.corpo).includes('hash'), 'resposta de login não expõe hash');

console.log('Criação de apresentadores');
const rAna = await req('POST', '/api/usuarios', { token: tAdm, json: { usuario: ana, nome: 'Ana', senha: SENHA_PROV, papel: 'apresentador' } });
const rBeto = await req('POST', '/api/usuarios', { token: tAdm, json: { usuario: beto, nome: 'Beto', senha: SENHA_PROV, papel: 'apresentador' } });
confere(rAna.status === 201 && rBeto.status === 201, 'admin cria dois apresentadores', JSON.stringify([rAna, rBeto]));
confere((await req('POST', '/api/usuarios', { token: tAdm, json: { usuario: ana, nome: 'Outra', senha: SENHA_PROV } })).status === 400, 'login duplicado é recusado');
confere((await req('POST', '/api/usuarios', { token: tAdm, json: { usuario: `t-fraca-${sufixo}`, nome: 'X', senha: '123' } })).status === 400, 'senha curta é recusada');
confere((await req('POST', '/api/usuarios', { token: tAdm, json: { usuario: 'Ab', nome: 'X', senha: SENHA_PROV } })).status === 400, 'login inválido é recusado');

console.log('Senha provisória');
const lAna = await login(ana, SENHA_PROV);
confere(lAna.status === 200 && lAna.corpo.usuario.precisaTrocarSenha === true, 'login com senha provisória funciona e sinaliza troca');
let tAna = lAna.corpo.token;
const bloq = await req('GET', '/api/quizzes', { token: tAna });
confere(bloq.status === 403 && bloq.corpo.trocarSenha === true, 'com senha provisória, a API de quizzes fica bloqueada');
confere((await req('POST', '/api/eu/senha', { token: tAna, json: { atual: 'errada-errada', nova: SENHA_NOVA } })).status === 400, 'troca com senha atual errada é recusada');
confere((await req('POST', '/api/eu/senha', { token: tAna, json: { atual: SENHA_PROV, nova: SENHA_PROV } })).status === 400, 'nova senha igual à atual é recusada');
const troca = await req('POST', '/api/eu/senha', { token: tAna, json: { atual: SENHA_PROV, nova: SENHA_NOVA } });
confere(troca.status === 200 && troca.corpo.precisaTrocarSenha === false, 'troca de senha funciona');
confere((await login(ana, SENHA_PROV)).status === 401, 'senha antiga deixa de funcionar');
tAna = (await login(ana, SENHA_NOVA)).corpo.token;
const lBeto = await login(beto, SENHA_PROV);
let tBeto = lBeto.corpo.token;
await req('POST', '/api/eu/senha', { token: tBeto, json: { atual: SENHA_PROV, nova: SENHA_NOVA } });
tBeto = (await login(beto, SENHA_NOVA)).corpo.token;

console.log('Quizzes por dono');
const qAna = await req('POST', '/api/quizzes', { token: tAna, json: quizModelo('Quiz da Ana') });
const qBeto = await req('POST', '/api/quizzes', { token: tBeto, json: quizModelo('Quiz do Beto') });
confere(qAna.status === 200 && qBeto.status === 200 && qAna.corpo.dono !== qBeto.corpo.dono, 'cada um cria seu quiz, com donos diferentes');
const listaAna = (await req('GET', '/api/quizzes', { token: tAna })).corpo;
confere(listaAna.some((q) => q.id === qAna.corpo.id) && !listaAna.some((q) => q.id === qBeto.corpo.id), 'Ana vê só o próprio quiz');
const listaAdm = (await req('GET', '/api/quizzes', { token: tAdm })).corpo;
confere(listaAdm.some((q) => q.id === qAna.corpo.id) && listaAdm.some((q) => q.id === qBeto.corpo.id), 'admin vê os quizzes de todos');
confere((await req('GET', `/api/quizzes/${qBeto.corpo.id}`, { token: tAna })).status === 404, 'Ana não abre o quiz do Beto (404)');
confere((await req('PUT', `/api/quizzes/${qBeto.corpo.id}`, { token: tAna, json: quizModelo('Invadido') })).status === 404, 'Ana não edita o quiz do Beto');
confere((await req('DELETE', `/api/quizzes/${qBeto.corpo.id}`, { token: tAna })).status === 404, 'Ana não exclui o quiz do Beto');
confere((await req('GET', `/api/quizzes/${qBeto.corpo.id}`, { token: tBeto })).corpo.titulo === 'Quiz do Beto', 'quiz do Beto segue intacto');
const edAdm = await req('PUT', `/api/quizzes/${qAna.corpo.id}`, { token: tAdm, json: quizModelo('Editado pelo admin') });
confere(edAdm.status === 200 && edAdm.corpo.dono === qAna.corpo.dono, 'admin edita quiz alheio sem mudar o dono');

console.log('Permissões de administração');
confere((await req('GET', '/api/usuarios', { token: tAna })).status === 403, 'apresentador não lista usuários');
confere((await req('POST', '/api/usuarios', { token: tAna, json: { usuario: `t-x-${sufixo}`, nome: 'X', senha: SENHA_NOVA } })).status === 403, 'apresentador não cria usuários');
confere((await req('PUT', `/api/usuarios/${rBeto.corpo.id}`, { token: tAna, json: { papel: 'admin' } })).status === 403, 'apresentador não promove ninguém a admin');
confere((await req('GET', '/api/usuarios')).status === 401, 'sem token: 401');
confere((await req('GET', '/api/quizzes', { token: 'token-inventado' })).status === 401, 'token inventado: 401');
const listaUsu = (await req('GET', '/api/usuarios', { token: tAdm })).corpo;
confere(Array.isArray(listaUsu) && listaUsu.length >= 3 && !JSON.stringify(listaUsu).includes('hash'), 'lista de usuários não expõe hash');

console.log('Partidas');
const hostAna = io(URL);
await new Promise((r) => hostAna.on('connect', r));
confere((await emit(hostAna, 'host:criar', { token: tAna, quizId: qBeto.corpo.id })).erro === 'Quiz não encontrado.', 'Ana não cria partida com quiz do Beto');
const partida = await emit(hostAna, 'host:criar', { token: tAna, quizId: qAna.corpo.id });
confere(!!partida.pin, 'Ana cria partida com o próprio quiz', JSON.stringify(partida));
hostAna.close();

console.log('Desativação, redefinição e exclusão');
const ativo = await req('PUT', `/api/usuarios/${rAna.corpo.id}`, { token: tAdm, json: { ativo: false } });
confere(ativo.status === 200 && ativo.corpo.ativo === false, 'admin desativa a Ana');
confere((await req('GET', '/api/quizzes', { token: tAna })).status === 401, 'sessão da Ana cai ao ser desativada');
confere((await login(ana, SENHA_NOVA)).status === 401, 'Ana desativada não consegue entrar');
await req('PUT', `/api/usuarios/${rAna.corpo.id}`, { token: tAdm, json: { ativo: true } });
const redef = await req('PUT', `/api/usuarios/${rAna.corpo.id}`, { token: tAdm, json: { senha: 'redefinida-789' } });
confere(redef.status === 200 && redef.corpo.precisaTrocarSenha === true, 'redefinir senha exige nova troca no próximo acesso');
const meuId = adm.corpo.usuario.id;
confere((await req('PUT', `/api/usuarios/${meuId}`, { token: tAdm, json: { ativo: false } })).status === 400, 'admin não desativa a si mesmo');
confere((await req('DELETE', `/api/usuarios/${meuId}`, { token: tAdm })).status === 400, 'admin não exclui a si mesmo');
confere((await req('PUT', `/api/usuarios/${meuId}`, { token: tAdm, json: { papel: 'apresentador' } })).status === 400, 'admin não se rebaixa');

const exclui = await req('DELETE', `/api/usuarios/${rBeto.corpo.id}`, { token: tAdm });
confere(exclui.status === 200 && exclui.corpo.quizzesTransferidos === 1, 'excluir o Beto transfere o quiz dele para o admin', JSON.stringify(exclui));
confere((await req('GET', '/api/quizzes', { token: tBeto })).status === 401, 'sessão do Beto cai ao ser excluído');
confere((await req('GET', `/api/quizzes/${qBeto.corpo.id}`, { token: tAdm })).status === 200, 'quiz do Beto continua acessível ao admin');

console.log('Limpeza');
await req('DELETE', `/api/quizzes/${qAna.corpo.id}`, { token: tAdm });
await req('DELETE', `/api/quizzes/${qBeto.corpo.id}`, { token: tAdm });
await req('DELETE', `/api/usuarios/${rAna.corpo.id}`, { token: tAdm });

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO OK');
process.exit(falhas ? 1 : 0);
