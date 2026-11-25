// Recuperação de acesso: define uma nova senha para um usuário (reativando-o se estiver inativo).
// Uso:  node server/reset-senha.js <usuario> [nova-senha]      (ou NOVA_SENHA=... node server/reset-senha.js <usuario>)
// Docker: docker compose exec orbita node server/reset-senha.js admin
// Depois reinicie o servidor para ele recarregar os usuários: docker compose restart orbita
import { redefinirSenhaDireto, validarSenha } from './users.js';

const [usuario, senhaArg] = process.argv.slice(2);
const senha = process.env.NOVA_SENHA || senhaArg;
if (!usuario || !senha) {
  console.error('Uso: node server/reset-senha.js <usuario> <nova-senha>');
  process.exit(1);
}
const e = validarSenha(senha, usuario);
if (e) {
  console.error(e);
  process.exit(1);
}
const r = await redefinirSenhaDireto(usuario, senha);
if (r.erro) {
  console.error(r.erro);
  process.exit(1);
}
console.log(`Senha de "${usuario}" redefinida. Reinicie o servidor para aplicar.`);
