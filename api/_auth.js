const { sql } = require('./_db.js');

// Login que cria a própria conta de administrador no primeiro acesso.
// Trocar pelo login que o Gustavo vai usar antes do primeiro deploy (ver
// README). Depois desse primeiro login, só um administrador já existente
// consegue criar outras contas, pela aba Usuários.
const ADMIN_BOOTSTRAP_LOGIN = 'Adm';

async function usuarioDaSessao(req){
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const db = sql();
  const rows = await db`
    SELECT u.id, u.login, u.nome, u.cargo, u.ativo
    FROM sessoes s
    JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token = ${token} AND s.expira_em > now()
  `;
  const usuario = rows[0];
  // Se a conta foi desativada depois que a sessão já existia, ela para de
  // valer no próximo pedido -- não precisa esperar expirar.
  if (!usuario || !usuario.ativo) return null;
  return usuario;
}

function ehAdmin(usuario){
  return !!usuario && usuario.cargo === 'administrador';
}

// Pares (prestador_id, convenio_id) que o usuário pode ver/lançar.
// null = sem filtro (administrador vê tudo).
async function escopoDoUsuario(usuario){
  if (ehAdmin(usuario)) return null;
  const db = sql();
  return db`SELECT prestador_id, convenio_id FROM atribuicoes WHERE usuario_id = ${usuario.id}`;
}

function paresIncluem(escopo, prestadorId, convenioId){
  if (escopo === null) return true;
  return escopo.some(p => p.prestador_id === prestadorId && p.convenio_id === convenioId);
}

module.exports = { ADMIN_BOOTSTRAP_LOGIN, usuarioDaSessao, ehAdmin, escopoDoUsuario, paresIncluem };
