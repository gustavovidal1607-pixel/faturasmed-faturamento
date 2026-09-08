const { sql, ensureSchema, permitirCors } = require('./_db.js');
const { usuarioDaSessao, escopoDoUsuario, paresIncluem } = require('./_auth.js');

// Protocolos faturados de um lançamento -- um lançamento pode ter vários,
// já que o faturista manda aos poucos durante o mês (não tudo de uma vez).
module.exports = async (req, res) => {
  if (permitirCors(req, res)) return;
  try{
    await ensureSchema();
    const usuario = await usuarioDaSessao(req);
    if (!usuario){ res.status(401).json({ erro: 'Sessão inválida ou expirada.' }); return; }
    const db = sql();

    async function carregarFaturamentoComEscopo(faturamentoId){
      const linhas = await db`SELECT * FROM faturamentos WHERE id = ${faturamentoId}`;
      const faturamento = linhas[0];
      if (!faturamento) return null;
      const escopo = await escopoDoUsuario(usuario);
      if (!paresIncluem(escopo, faturamento.prestador_id, faturamento.convenio_id)) return undefined;
      return faturamento;
    }

    if (req.method === 'GET'){
      const faturamentoId = req.query && req.query.faturamento_id ? Number(req.query.faturamento_id) : null;
      if (!faturamentoId){ res.status(400).json({ erro: 'Informe o lançamento.' }); return; }
      const faturamento = await carregarFaturamentoComEscopo(faturamentoId);
      if (faturamento === null){ res.status(404).json({ erro: 'Lançamento não encontrado.' }); return; }
      if (faturamento === undefined){ res.status(403).json({ erro: 'Você não tem acesso a esse lançamento.' }); return; }
      const protocolos = await db`
        SELECT p.*, u.nome AS criado_por_nome
        FROM faturamentos_protocolos p
        LEFT JOIN usuarios u ON u.id = p.criado_por
        WHERE p.faturamento_id = ${faturamentoId}
        ORDER BY p.data NULLS LAST, p.criado_em
      `;
      res.status(200).json({ protocolos });
      return;
    }

    if (req.method === 'POST'){
      const { faturamento_id, protocolo, valor, data } = req.body || {};
      if (!faturamento_id){ res.status(400).json({ erro: 'Informe o lançamento.' }); return; }
      if (!protocolo || !protocolo.trim()){ res.status(400).json({ erro: 'Informe o protocolo.' }); return; }
      const faturamento = await carregarFaturamentoComEscopo(faturamento_id);
      if (faturamento === null){ res.status(404).json({ erro: 'Lançamento não encontrado.' }); return; }
      if (faturamento === undefined){ res.status(403).json({ erro: 'Você não é responsável por esse prestador/convênio.' }); return; }
      const inserido = await db`
        INSERT INTO faturamentos_protocolos (faturamento_id, protocolo, valor, data, criado_por)
        VALUES (${faturamento_id}, ${protocolo.trim()}, ${valor ?? null}, ${data || null}, ${usuario.id})
        RETURNING *
      `;
      res.status(201).json({ protocolo: inserido[0] });
      return;
    }

    if (req.method === 'DELETE'){
      const id = req.query && req.query.id ? Number(req.query.id) : null;
      if (!id){ res.status(400).json({ erro: 'Informe o id do protocolo.' }); return; }
      const linhas = await db`SELECT * FROM faturamentos_protocolos WHERE id = ${id}`;
      const registro = linhas[0];
      if (!registro){ res.status(404).json({ erro: 'Protocolo não encontrado.' }); return; }
      const faturamento = await carregarFaturamentoComEscopo(registro.faturamento_id);
      if (faturamento === undefined){ res.status(403).json({ erro: 'Você não tem acesso a esse lançamento.' }); return; }
      await db`DELETE FROM faturamentos_protocolos WHERE id = ${id}`;
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ erro: 'método não permitido' });
  }catch(err){
    console.error('protocolos error', err);
    res.status(500).json({ erro: 'Erro interno.' });
  }
};
