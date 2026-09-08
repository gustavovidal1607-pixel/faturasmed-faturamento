const { sql, ensureSchema, permitirCors } = require('./_db.js');
const { usuarioDaSessao, ehAdmin } = require('./_auth.js');

// Tarefas avulsas designadas pelo administrador. O responsável precisa
// confirmar recebimento antes de poder finalizar (com observação
// opcional).
module.exports = async (req, res) => {
  if (permitirCors(req, res)) return;
  try{
    await ensureSchema();
    const usuario = await usuarioDaSessao(req);
    if (!usuario){ res.status(401).json({ erro: 'Sessão inválida ou expirada.' }); return; }
    const db = sql();
    const id = req.query && req.query.id ? Number(req.query.id) : null;

    if (req.method === 'GET'){
      const rows = ehAdmin(usuario)
        ? await db`
            SELECT t.*, r.nome AS responsavel_nome, c.nome AS criado_por_nome
            FROM tarefas t
            JOIN usuarios r ON r.id = t.responsavel_usuario_id
            JOIN usuarios c ON c.id = t.criado_por
            ORDER BY (t.status = 'finalizada'), t.prazo NULLS LAST, t.criado_em DESC
          `
        : await db`
            SELECT t.*, r.nome AS responsavel_nome, c.nome AS criado_por_nome
            FROM tarefas t
            JOIN usuarios r ON r.id = t.responsavel_usuario_id
            JOIN usuarios c ON c.id = t.criado_por
            WHERE t.responsavel_usuario_id = ${usuario.id}
            ORDER BY (t.status = 'finalizada'), t.prazo NULLS LAST, t.criado_em DESC
          `;
      res.status(200).json({ tarefas: rows });
      return;
    }

    if (req.method === 'POST'){
      if (!ehAdmin(usuario)){ res.status(403).json({ erro: 'Só o administrador designa tarefas.' }); return; }
      const { descricao, prazo, responsavel_usuario_id } = req.body || {};
      if (!descricao || !descricao.trim()){ res.status(400).json({ erro: 'Descreva a tarefa.' }); return; }
      if (!responsavel_usuario_id){ res.status(400).json({ erro: 'Escolha o responsável.' }); return; }
      const inserido = await db`
        INSERT INTO tarefas (descricao, prazo, responsavel_usuario_id, criado_por)
        VALUES (${descricao.trim()}, ${prazo || null}, ${responsavel_usuario_id}, ${usuario.id})
        RETURNING *
      `;
      res.status(201).json({ tarefa: inserido[0] });
      return;
    }

    if (!id){ res.status(400).json({ erro: 'Informe o id da tarefa.' }); return; }

    if (req.method === 'PATCH' && req.query.acao === 'receber'){
      const linhas = await db`SELECT * FROM tarefas WHERE id = ${id}`;
      const tarefa = linhas[0];
      if (!tarefa){ res.status(404).json({ erro: 'Tarefa não encontrada.' }); return; }
      if (tarefa.responsavel_usuario_id !== usuario.id){ res.status(403).json({ erro: 'Essa tarefa não é sua.' }); return; }
      const rows = await db`UPDATE tarefas SET status = 'recebida', recebida_em = now() WHERE id = ${id} AND status = 'aguardando' RETURNING *`;
      res.status(200).json({ tarefa: rows[0] || tarefa });
      return;
    }

    if (req.method === 'PATCH' && req.query.acao === 'finalizar'){
      const linhas = await db`SELECT * FROM tarefas WHERE id = ${id}`;
      const tarefa = linhas[0];
      if (!tarefa){ res.status(404).json({ erro: 'Tarefa não encontrada.' }); return; }
      if (tarefa.responsavel_usuario_id !== usuario.id){ res.status(403).json({ erro: 'Essa tarefa não é sua.' }); return; }
      const { observacao_final } = req.body || {};
      const rows = await db`
        UPDATE tarefas SET status = 'finalizada', finalizada_em = now(), observacao_final = ${observacao_final || null}
        WHERE id = ${id}
        RETURNING *
      `;
      res.status(200).json({ tarefa: rows[0] });
      return;
    }

    if (req.method === 'DELETE'){
      if (!ehAdmin(usuario)){ res.status(403).json({ erro: 'Só o administrador exclui tarefas.' }); return; }
      const rows = await db`DELETE FROM tarefas WHERE id = ${id} RETURNING id`;
      if (!rows.length){ res.status(404).json({ erro: 'Tarefa não encontrada.' }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ erro: 'método não permitido' });
  }catch(err){
    console.error('tarefas error', err);
    res.status(500).json({ erro: 'Erro interno.' });
  }
};
