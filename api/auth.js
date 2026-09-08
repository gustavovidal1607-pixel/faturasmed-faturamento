const { sql, ensureSchema, normalizarLogin, gerarSalt, hashSenha, verificarSenha, criarSessao, permitirCors } = require('./_db.js');
const { ADMIN_BOOTSTRAP_LOGIN } = require('./_auth.js');

module.exports = async (req, res) => {
  if (permitirCors(req, res)) return;
  try{
    await ensureSchema();
    const db = sql();

    if (req.method === 'DELETE'){
      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
      if (token) await db`DELETE FROM sessoes WHERE token = ${token}`;
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method !== 'POST'){ res.status(405).json({ erro: 'método não permitido' }); return; }

    const { login: loginBruto, senha } = req.body || {};
    if (!loginBruto || !senha){ res.status(400).json({ erro: 'Informe login e senha.' }); return; }
    const login = normalizarLogin(loginBruto);

    const rows = await db`SELECT * FROM usuarios WHERE login = ${login}`;
    let usuario = rows[0];

    if (!usuario && login === normalizarLogin(ADMIN_BOOTSTRAP_LOGIN)){
      // Primeiro acesso: cria a conta de administrador com a senha
      // informada agora.
      if (senha.length < 6){ res.status(400).json({ erro: 'A senha precisa ter ao menos 6 caracteres.' }); return; }
      const salt = gerarSalt();
      const hash = await hashSenha(senha, salt);
      const inserido = await db`
        INSERT INTO usuarios (login, nome, salt, hash, papel)
        VALUES (${login}, 'Administrador', ${salt}, ${hash}, 'administrador')
        RETURNING *
      `;
      usuario = inserido[0];
    } else if (!usuario){
      res.status(401).json({ erro: 'Login ou senha inválidos.' });
      return;
    } else {
      if (!usuario.ativo){ res.status(403).json({ erro: 'Usuário desativado.' }); return; }
      const ok = await verificarSenha(senha, usuario.salt, usuario.hash);
      if (!ok){ res.status(401).json({ erro: 'Login ou senha inválidos.' }); return; }
    }

    const token = await criarSessao(usuario.id);
    res.status(200).json({
      token,
      usuario: { id: usuario.id, login: usuario.login, nome: usuario.nome, papel: usuario.papel }
    });
  }catch(err){
    console.error('auth error', err);
    res.status(500).json({ erro: 'Erro interno.' });
  }
};
