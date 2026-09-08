const { sql, ensureSchema, permitirCors } = require('./_db.js');
const { usuarioDaSessao, ehAdmin } = require('./_auth.js');

module.exports = async (req, res) => {
  if (permitirCors(req, res)) return;
  try{
    await ensureSchema();
    const usuario = await usuarioDaSessao(req);
    if (!usuario){ res.status(401).json({ erro: 'Sessão inválida ou expirada.' }); return; }
    const db = sql();
    const id = req.query && req.query.id ? Number(req.query.id) : null;

    if (!id){
      if (req.method === 'GET'){
        const rows = await db`SELECT * FROM prestadores ORDER BY nome`;
        res.status(200).json({ prestadores: rows });
        return;
      }
      if (req.method === 'POST'){
        if (!ehAdmin(usuario)){ res.status(403).json({ erro: 'Acesso restrito ao administrador.' }); return; }
        const { nome, especialidade } = req.body || {};
        if (!nome || !nome.trim()){ res.status(400).json({ erro: 'Informe o nome do prestador.' }); return; }
        try{
          const inserido = await db`
            INSERT INTO prestadores (nome, especialidade)
            VALUES (${nome.trim()}, ${especialidade || null})
            RETURNING *
          `;
          res.status(201).json({ prestador: inserido[0] });
        }catch(err){
          if (err.code === '23505'){ res.status(409).json({ erro: 'Já existe um prestador com esse nome.' }); return; }
          throw err;
        }
        return;
      }
      res.status(405).json({ erro: 'método não permitido' });
      return;
    }

    if (!ehAdmin(usuario)){ res.status(403).json({ erro: 'Acesso restrito ao administrador.' }); return; }

    if (req.method === 'PATCH'){
      const { nome, especialidade, ativo } = req.body || {};
      const result = await db`
        UPDATE prestadores SET
          nome = COALESCE(${nome ?? null}, nome),
          especialidade = COALESCE(${especialidade ?? null}, especialidade),
          ativo = COALESCE(${ativo ?? null}, ativo)
        WHERE id = ${id}
        RETURNING *
      `;
      if (!result.length){ res.status(404).json({ erro: 'Prestador não encontrado.' }); return; }
      res.status(200).json({ prestador: result[0] });
      return;
    }

    if (req.method === 'DELETE'){
      try{
        const result = await db`DELETE FROM prestadores WHERE id = ${id} RETURNING id`;
        if (!result.length){ res.status(404).json({ erro: 'Prestador não encontrado.' }); return; }
        res.status(200).json({ ok: true });
      }catch(err){
        if (err.code === '23503'){
          res.status(409).json({ erro: 'Não é possível excluir: esse prestador já tem vínculos ou lançamentos. Desative-o em vez de excluir.' });
          return;
        }
        throw err;
      }
      return;
    }

    res.status(405).json({ erro: 'método não permitido' });
  }catch(err){
    console.error('prestadores error', err);
    res.status(500).json({ erro: 'Erro interno.' });
  }
};
