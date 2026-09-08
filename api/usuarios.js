const { sql, ensureSchema, normalizarLogin, gerarSalt, hashSenha, permitirCors } = require('./_db.js');
const { usuarioDaSessao, ehAdmin } = require('./_auth.js');

const PAPEIS_VALIDOS = new Set(['funcionario', 'administrador']);

// Acha um login livre a partir do sugerido -- se "maria" já existir,
// tenta "maria2", "maria3", etc.
async function loginDisponivel(db, base){
  let candidato = base;
  let sufixo = 2;
  while (true){
    const existente = await db`SELECT id FROM usuarios WHERE login = ${candidato}`;
    if (!existente.length) return candidato;
    candidato = `${base}${sufixo}`;
    sufixo++;
  }
}

module.exports = async (req, res) => {
  if (permitirCors(req, res)) return;
  try{
    await ensureSchema();
    const usuario = await usuarioDaSessao(req);
    if (!ehAdmin(usuario)){ res.status(403).json({ erro: 'Acesso restrito ao administrador.' }); return; }
    const db = sql();
    const idAlvo = req.query && req.query.id ? Number(req.query.id) : null;

    if (!idAlvo){
      if (req.method === 'GET'){
        const rows = await db`SELECT id, login, nome, papel, ativo, criado_em FROM usuarios ORDER BY papel, nome`;
        res.status(200).json({ usuarios: rows });
        return;
      }
      if (req.method === 'POST'){
        const { login: loginBruto, nome, papel, senha } = req.body || {};
        if (!nome || !nome.trim()){ res.status(400).json({ erro: 'Informe o nome.' }); return; }
        if (!PAPEIS_VALIDOS.has(papel)){ res.status(400).json({ erro: 'Papel inválido.' }); return; }
        if (!senha || senha.length < 6){ res.status(400).json({ erro: 'A senha precisa ter ao menos 6 caracteres.' }); return; }

        const baseLogin = normalizarLogin(loginBruto || nome.trim().split(/\s+/)[0]);
        if (!baseLogin){ res.status(400).json({ erro: 'Informe um login válido.' }); return; }
        const login = await loginDisponivel(db, baseLogin);

        const salt = gerarSalt();
        const hash = await hashSenha(senha, salt);
        const inserido = await db`
          INSERT INTO usuarios (login, nome, salt, hash, papel)
          VALUES (${login}, ${nome.trim()}, ${salt}, ${hash}, ${papel})
          RETURNING id, login, nome, papel, ativo, criado_em
        `;
        res.status(201).json({ usuario: inserido[0] });
        return;
      }
      res.status(405).json({ erro: 'método não permitido' });
      return;
    }

    if (req.method === 'PATCH'){
      const { nome, papel, ativo, senha } = req.body || {};
      if (papel !== undefined && !PAPEIS_VALIDOS.has(papel)){ res.status(400).json({ erro: 'Papel inválido.' }); return; }
      if (senha !== undefined && senha.length < 6){ res.status(400).json({ erro: 'A senha precisa ter ao menos 6 caracteres.' }); return; }

      let salt, hash;
      if (senha){ salt = gerarSalt(); hash = await hashSenha(senha, salt); }

      const result = await db`
        UPDATE usuarios SET
          nome = COALESCE(${nome ?? null}, nome),
          papel = COALESCE(${papel ?? null}, papel),
          ativo = COALESCE(${ativo ?? null}, ativo),
          salt = COALESCE(${salt ?? null}, salt),
          hash = COALESCE(${hash ?? null}, hash)
        WHERE id = ${idAlvo}
        RETURNING id, login, nome, papel, ativo
      `;
      if (!result.length){ res.status(404).json({ erro: 'Usuário não encontrado.' }); return; }
      res.status(200).json({ usuario: result[0] });
      return;
    }

    if (req.method === 'DELETE'){
      try{
        const result = await db`DELETE FROM usuarios WHERE id = ${idAlvo} RETURNING id`;
        if (!result.length){ res.status(404).json({ erro: 'Usuário não encontrado.' }); return; }
        res.status(200).json({ ok: true });
      }catch(err){
        if (err.code === '23503'){
          res.status(409).json({ erro: 'Não é possível excluir: esse usuário já tem lançamentos ou tarefas registradas. Desative-o em vez de excluir.' });
          return;
        }
        throw err;
      }
      return;
    }

    res.status(405).json({ erro: 'método não permitido' });
  }catch(err){
    console.error('usuarios error', err);
    res.status(500).json({ erro: 'Erro interno.' });
  }
};
