const { sql, ensureSchema, permitirCors } = require('./_db.js');
const { usuarioDaSessao, escopoDoUsuario, paresIncluem } = require('./_auth.js');

const STATUS_VALIDOS = ['pendente', 'enviado_falta_anexo', 'faturado'];

// Protocolos faturados de um prestador+convênio+tipo -- um lançamento
// (uma competência) pode ter vários, já que o faturista manda aos poucos
// durante o mês. Cada protocolo tem seu próprio status; a listagem
// principal (GET por convenio/prestador/tipo) mostra o histórico inteiro,
// não só da competência atual, com filtro de data opcional.
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
      // Histórico completo pra esse prestador+convênio+tipo, em qualquer
      // competência -- é o que a tela usa hoje em dia (mostra tudo já
      // faturado pra ele, não só o mês corrente).
      if (req.query && req.query.convenio_id && req.query.prestador_id && req.query.tipo){
        const convenioId = Number(req.query.convenio_id);
        const prestadorId = Number(req.query.prestador_id);
        const { tipo, data_de, data_ate } = req.query;
        const escopo = await escopoDoUsuario(usuario);
        if (!paresIncluem(escopo, prestadorId, convenioId)){ res.status(403).json({ erro: 'Você não tem acesso a esse prestador/convênio.' }); return; }
        let protocolos = await db`
          SELECT p.*, u.nome AS criado_por_nome, f.competencia
          FROM faturamentos_protocolos p
          JOIN faturamentos f ON f.id = p.faturamento_id
          LEFT JOIN usuarios u ON u.id = p.criado_por
          WHERE f.convenio_id = ${convenioId} AND f.prestador_id = ${prestadorId} AND f.tipo = ${tipo}
          ORDER BY p.data DESC NULLS LAST, p.criado_em DESC
        `;
        if (data_de) protocolos = protocolos.filter(p => p.data && p.data.toISOString().slice(0, 10) >= data_de);
        if (data_ate) protocolos = protocolos.filter(p => p.data && p.data.toISOString().slice(0, 10) <= data_ate);
        res.status(200).json({ protocolos });
        return;
      }

      const faturamentoId = req.query && req.query.faturamento_id ? Number(req.query.faturamento_id) : null;
      if (!faturamentoId){ res.status(400).json({ erro: 'Informe o lançamento ou o prestador/convênio/tipo.' }); return; }
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
      const { faturamento_id, protocolo, valor, data, status, quantidade_guias } = req.body || {};
      if (!faturamento_id){ res.status(400).json({ erro: 'Informe o lançamento.' }); return; }
      if (!protocolo || !protocolo.trim()){ res.status(400).json({ erro: 'Informe o protocolo.' }); return; }
      const faturamento = await carregarFaturamentoComEscopo(faturamento_id);
      if (faturamento === null){ res.status(404).json({ erro: 'Lançamento não encontrado.' }); return; }
      if (faturamento === undefined){ res.status(403).json({ erro: 'Você não é responsável por esse prestador/convênio.' }); return; }
      const statusFinal = STATUS_VALIDOS.includes(status) ? status : 'enviado_falta_anexo';
      const inserido = await db`
        INSERT INTO faturamentos_protocolos (faturamento_id, protocolo, valor, data, status, quantidade_guias, criado_por)
        VALUES (${faturamento_id}, ${protocolo.trim()}, ${valor ?? null}, ${data || null}, ${statusFinal}, ${quantidade_guias || null}, ${usuario.id})
        RETURNING *
      `;
      res.status(201).json({ protocolo: inserido[0] });
      return;
    }

    if (req.method === 'PATCH'){
      const id = req.query && req.query.id ? Number(req.query.id) : null;
      if (!id){ res.status(400).json({ erro: 'Informe o id do protocolo.' }); return; }
      const linhas = await db`SELECT * FROM faturamentos_protocolos WHERE id = ${id}`;
      const registro = linhas[0];
      if (!registro){ res.status(404).json({ erro: 'Protocolo não encontrado.' }); return; }
      const faturamento = await carregarFaturamentoComEscopo(registro.faturamento_id);
      if (faturamento === undefined){ res.status(403).json({ erro: 'Você não tem acesso a esse lançamento.' }); return; }
      const { status } = req.body || {};
      if (!STATUS_VALIDOS.includes(status)){ res.status(400).json({ erro: 'Status inválido.' }); return; }
      const result = await db`UPDATE faturamentos_protocolos SET status = ${status} WHERE id = ${id} RETURNING *`;
      res.status(200).json({ protocolo: result[0] });
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
