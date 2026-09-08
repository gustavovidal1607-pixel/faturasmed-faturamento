const { sql, ensureSchema, permitirCors } = require('./_db.js');
const { usuarioDaSessao, ehAdmin } = require('./_auth.js');

// Quem fatura qual par prestador+convênio. Só o administrador
// cria/remove; um POST pra um par que já tem atribuição substitui o
// responsável anterior (histórico de quem fez o quê fica preservado nos
// próprios lançamentos, não nas atribuições).
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
        const rows = ehAdmin(usuario)
          ? await db`
              SELECT a.*, u.nome AS usuario_nome, p.nome AS prestador_nome, c.nome AS convenio_nome
              FROM atribuicoes a
              JOIN usuarios u ON u.id = a.usuario_id
              JOIN prestadores p ON p.id = a.prestador_id
              JOIN convenios c ON c.id = a.convenio_id
              ORDER BY c.nome, p.nome
            `
          : await db`
              SELECT a.*, u.nome AS usuario_nome, p.nome AS prestador_nome, c.nome AS convenio_nome
              FROM atribuicoes a
              JOIN usuarios u ON u.id = a.usuario_id
              JOIN prestadores p ON p.id = a.prestador_id
              JOIN convenios c ON c.id = a.convenio_id
              WHERE a.usuario_id = ${usuario.id}
              ORDER BY c.nome, p.nome
            `;
        res.status(200).json({ atribuicoes: rows });
        return;
      }
      if (req.method === 'POST'){
        if (!ehAdmin(usuario)){ res.status(403).json({ erro: 'Só o administrador atribui responsáveis.' }); return; }
        const { usuario_id, prestador_id, convenio_id } = req.body || {};
        if (!usuario_id || !prestador_id || !convenio_id){ res.status(400).json({ erro: 'Selecione o funcionário, o prestador e o convênio.' }); return; }
        const resultado = await db`
          INSERT INTO atribuicoes (usuario_id, prestador_id, convenio_id, criado_por)
          VALUES (${usuario_id}, ${prestador_id}, ${convenio_id}, ${usuario.id})
          ON CONFLICT (prestador_id, convenio_id)
          DO UPDATE SET usuario_id = EXCLUDED.usuario_id, criado_por = EXCLUDED.criado_por, criado_em = now()
          RETURNING *
        `;
        res.status(201).json({ atribuicao: resultado[0] });
        return;
      }
      res.status(405).json({ erro: 'método não permitido' });
      return;
    }

    if (req.method === 'DELETE'){
      if (!ehAdmin(usuario)){ res.status(403).json({ erro: 'Só o administrador remove atribuições.' }); return; }
      const result = await db`DELETE FROM atribuicoes WHERE id = ${id} RETURNING id`;
      if (!result.length){ res.status(404).json({ erro: 'Atribuição não encontrada.' }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ erro: 'método não permitido' });
  }catch(err){
    console.error('atribuicoes error', err);
    res.status(500).json({ erro: 'Erro interno.' });
  }
};
