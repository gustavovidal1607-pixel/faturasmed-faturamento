const { sql, ensureSchema, permitirCors } = require('./_db.js');
const { usuarioDaSessao, ehAdmin } = require('./_auth.js');

const TIPOS_VALIDOS = ['SADT', 'CONSULTA', 'GIH'];

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
        const rows = await db`SELECT * FROM convenios ORDER BY nome`;
        res.status(200).json({ convenios: rows });
        return;
      }
      if (req.method === 'POST'){
        if (!ehAdmin(usuario)){ res.status(403).json({ erro: 'Acesso restrito ao administrador.' }); return; }
        const { nome, tipos, prazo_dia } = req.body || {};
        if (!nome || !nome.trim()){ res.status(400).json({ erro: 'Informe o nome do convênio.' }); return; }
        const tiposFinal = Array.isArray(tipos) && tipos.length
          ? tipos.filter(t => TIPOS_VALIDOS.includes(t))
          : TIPOS_VALIDOS;
        if (!tiposFinal.length){ res.status(400).json({ erro: 'Selecione ao menos um tipo (SADT, CONSULTA ou GIH).' }); return; }
        try{
          const inserido = await db`
            INSERT INTO convenios (nome, tipos, prazo_dia)
            VALUES (${nome.trim()}, ${tiposFinal}, ${prazo_dia || null})
            RETURNING *
          `;
          res.status(201).json({ convenio: inserido[0] });
        }catch(err){
          if (err.code === '23505'){ res.status(409).json({ erro: 'Já existe um convênio com esse nome.' }); return; }
          throw err;
        }
        return;
      }
      res.status(405).json({ erro: 'método não permitido' });
      return;
    }

    if (!ehAdmin(usuario)){ res.status(403).json({ erro: 'Acesso restrito ao administrador.' }); return; }

    if (req.method === 'PATCH'){
      const { nome, tipos, prazo_dia, ativo } = req.body || {};
      let tiposFinal = null;
      if (tipos !== undefined){
        tiposFinal = tipos.filter(t => TIPOS_VALIDOS.includes(t));
        if (!tiposFinal.length){ res.status(400).json({ erro: 'Selecione ao menos um tipo.' }); return; }
      }
      const result = await db`
        UPDATE convenios SET
          nome = COALESCE(${nome ?? null}, nome),
          tipos = COALESCE(${tiposFinal}, tipos),
          prazo_dia = COALESCE(${prazo_dia ?? null}, prazo_dia),
          ativo = COALESCE(${ativo ?? null}, ativo)
        WHERE id = ${id}
        RETURNING *
      `;
      if (!result.length){ res.status(404).json({ erro: 'Convênio não encontrado.' }); return; }
      res.status(200).json({ convenio: result[0] });
      return;
    }

    if (req.method === 'DELETE'){
      try{
        const result = await db`DELETE FROM convenios WHERE id = ${id} RETURNING id`;
        if (!result.length){ res.status(404).json({ erro: 'Convênio não encontrado.' }); return; }
        res.status(200).json({ ok: true });
      }catch(err){
        if (err.code === '23503'){
          res.status(409).json({ erro: 'Não é possível excluir: esse convênio já tem vínculos ou lançamentos. Desative-o em vez de excluir.' });
          return;
        }
        throw err;
      }
      return;
    }

    res.status(405).json({ erro: 'método não permitido' });
  }catch(err){
    console.error('convenios error', err);
    res.status(500).json({ erro: 'Erro interno.' });
  }
};
