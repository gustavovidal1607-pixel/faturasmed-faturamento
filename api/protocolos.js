const { sql, ensureSchema, permitirCors } = require('./_db.js');
const { usuarioDaSessao, escopoDoUsuario, paresIncluem } = require('./_auth.js');

const STATUS_VALIDOS = ['pendente', 'enviado_falta_anexo', 'faturado'];
const TIPOS_VALIDOS = ['SADT', 'CONSULTA', 'GIH'];

// O status do lançamento não é mais escolhido manualmente -- é sempre
// calculado a partir dos protocolos dele: qualquer protocolo "enviado,
// falta anexo" prevalece (ainda tem pendência); senão, algum "faturado"
// já resolve; sem nenhum protocolo, fica "pendente". Roda depois de
// qualquer criação/edição/remoção de protocolo.
async function recalcularStatus(db, faturamentoId, usuarioId){
  const protocolos = await db`SELECT status FROM faturamentos_protocolos WHERE faturamento_id = ${faturamentoId}`;
  let novoStatus = 'pendente';
  if (protocolos.some(p => p.status === 'enviado_falta_anexo')) novoStatus = 'enviado_falta_anexo';
  else if (protocolos.some(p => p.status === 'faturado')) novoStatus = 'faturado';

  const atual = await db`SELECT * FROM faturamentos WHERE id = ${faturamentoId}`;
  if (!atual.length || atual[0].status === novoStatus) return;
  const atualizado = await db`UPDATE faturamentos SET status = ${novoStatus}, atualizado_em = now() WHERE id = ${faturamentoId} RETURNING *`;
  await db`
    INSERT INTO faturamentos_historico (faturamento_id, status, mes_completo, faturado_de, faturado_ate, observacao, alterado_por)
    VALUES (${faturamentoId}, ${novoStatus}, ${atualizado[0].mes_completo}, ${atualizado[0].faturado_de}, ${atualizado[0].faturado_ate}, ${atualizado[0].observacao}, ${usuarioId})
  `;
}

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

    // Garante que o lançamento pai existe (cria na hora, com status
    // "pendente", se essa for a primeira vez que alguém mexe nesse
    // prestador+convênio+tipo+competência) -- tira a necessidade de
    // "salvar" o lançamento antes de poder anexar um protocolo.
    async function garantirFaturamento({ faturamento_id, convenio_id, prestador_id, tipo, competencia }){
      if (faturamento_id) return carregarFaturamentoComEscopo(faturamento_id);
      if (!convenio_id || !prestador_id || !tipo || !competencia) return null;
      const escopo = await escopoDoUsuario(usuario);
      if (!paresIncluem(escopo, prestador_id, convenio_id)) return undefined;
      const upsert = await db`
        INSERT INTO faturamentos (convenio_id, prestador_id, tipo, competencia, status, lancado_por)
        VALUES (${convenio_id}, ${prestador_id}, ${tipo}, ${competencia}, 'pendente', ${usuario.id})
        ON CONFLICT (convenio_id, prestador_id, tipo, competencia) DO UPDATE SET atualizado_em = faturamentos.atualizado_em
        RETURNING *
      `;
      return upsert[0];
    }

    if (req.method === 'GET'){
      // Histórico completo pra esse prestador+convênio+tipo, em qualquer
      // competência -- mostra tudo já faturado pra ele, não só o mês
      // filtrado na tela, com filtro de data opcional.
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
      const { faturamento_id, convenio_id, prestador_id, tipo, competencia, protocolo, valor, data, status, quantidade_guias, observacao } = req.body || {};
      if (!protocolo || !protocolo.trim()){ res.status(400).json({ erro: 'Informe o protocolo.' }); return; }
      if (tipo && !TIPOS_VALIDOS.includes(tipo)){ res.status(400).json({ erro: 'Tipo inválido.' }); return; }
      const faturamento = await garantirFaturamento({ faturamento_id, convenio_id, prestador_id, tipo, competencia });
      if (faturamento === null){ res.status(404).json({ erro: 'Lançamento não encontrado.' }); return; }
      if (faturamento === undefined){ res.status(403).json({ erro: 'Você não é responsável por esse prestador/convênio.' }); return; }
      const statusFinal = STATUS_VALIDOS.includes(status) ? status : 'enviado_falta_anexo';
      const inserido = await db`
        INSERT INTO faturamentos_protocolos (faturamento_id, protocolo, valor, data, status, quantidade_guias, observacao, criado_por)
        VALUES (${faturamento.id}, ${protocolo.trim()}, ${valor ?? null}, ${data || null}, ${statusFinal}, ${quantidade_guias || null}, ${observacao || null}, ${usuario.id})
        RETURNING *
      `;
      await recalcularStatus(db, faturamento.id, usuario.id);
      res.status(201).json({ protocolo: inserido[0], faturamento_id: faturamento.id });
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
      await recalcularStatus(db, registro.faturamento_id, usuario.id);
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
      await recalcularStatus(db, registro.faturamento_id, usuario.id);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ erro: 'método não permitido' });
  }catch(err){
    console.error('protocolos error', err);
    res.status(500).json({ erro: 'Erro interno.' });
  }
};
