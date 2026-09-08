const { sql, ensureSchema, permitirCors } = require('./_db.js');
const { usuarioDaSessao, escopoDoUsuario, paresIncluem } = require('./_auth.js');
const { competenciaAtual } = require('./_data.js');
const { listarLinhas } = require('./_faturamentos.js');

const TIPOS_VALIDOS = ['SADT', 'CONSULTA', 'GIH'];
const STATUS_VALIDOS = ['pendente', 'enviado_falta_anexo', 'faturado'];

module.exports = async (req, res) => {
  if (permitirCors(req, res)) return;
  try{
    await ensureSchema();
    const usuario = await usuarioDaSessao(req);
    if (!usuario){ res.status(401).json({ erro: 'Sessão inválida ou expirada.' }); return; }
    const db = sql();

    if (req.method === 'GET'){
      // Histórico de um lançamento específico.
      if (req.query && req.query.historico_de){
        const faturamentoId = Number(req.query.historico_de);
        const rows = await db`
          SELECT h.*, u.nome AS alterado_por_nome
          FROM faturamentos_historico h
          LEFT JOIN usuarios u ON u.id = h.alterado_por
          WHERE h.faturamento_id = ${faturamentoId}
          ORDER BY h.criado_em DESC
        `;
        res.status(200).json({ historico: rows });
        return;
      }

      const competencia = (req.query && req.query.competencia) || competenciaAtual();
      const escopo = await escopoDoUsuario(usuario);
      const linhas = await listarLinhas({
        competencia,
        escopo,
        convenioId: req.query && req.query.convenio_id ? Number(req.query.convenio_id) : null,
        prestadorId: req.query && req.query.prestador_id ? Number(req.query.prestador_id) : null,
        status: req.query && req.query.status ? req.query.status : null,
      });
      res.status(200).json({ faturamentos: linhas, competencia });
      return;
    }

    if (req.method === 'POST'){
      const { convenio_id, prestador_id, tipo, competencia, status, mes_completo, faturado_de, faturado_ate, protocolo, valor, observacao } = req.body || {};
      if (!convenio_id || !prestador_id){ res.status(400).json({ erro: 'Selecione o prestador e o convênio.' }); return; }
      if (!TIPOS_VALIDOS.includes(tipo)){ res.status(400).json({ erro: 'Tipo inválido.' }); return; }
      if (!competencia || !/^\d{4}-\d{2}$/.test(competencia)){ res.status(400).json({ erro: 'Competência inválida.' }); return; }

      const escopo = await escopoDoUsuario(usuario);
      if (!paresIncluem(escopo, prestador_id, convenio_id)){ res.status(403).json({ erro: 'Você não é responsável por esse prestador/convênio.' }); return; }

      const statusFinal = STATUS_VALIDOS.includes(status) ? status : 'pendente';
      const upsert = await db`
        INSERT INTO faturamentos (convenio_id, prestador_id, tipo, competencia, status, mes_completo, faturado_de, faturado_ate, protocolo, valor, observacao, lancado_por)
        VALUES (${convenio_id}, ${prestador_id}, ${tipo}, ${competencia}, ${statusFinal}, ${!!mes_completo}, ${faturado_de || null}, ${faturado_ate || null}, ${protocolo || null}, ${valor ?? null}, ${observacao || null}, ${usuario.id})
        ON CONFLICT (convenio_id, prestador_id, tipo, competencia)
        DO UPDATE SET
          status = EXCLUDED.status,
          mes_completo = EXCLUDED.mes_completo,
          faturado_de = EXCLUDED.faturado_de,
          faturado_ate = EXCLUDED.faturado_ate,
          protocolo = EXCLUDED.protocolo,
          valor = EXCLUDED.valor,
          observacao = EXCLUDED.observacao,
          lancado_por = EXCLUDED.lancado_por,
          atualizado_em = now()
        RETURNING *
      `;
      const faturamento = upsert[0];
      await db`
        INSERT INTO faturamentos_historico (faturamento_id, status, mes_completo, faturado_de, faturado_ate, protocolo, valor, observacao, alterado_por)
        VALUES (${faturamento.id}, ${faturamento.status}, ${faturamento.mes_completo}, ${faturamento.faturado_de}, ${faturamento.faturado_ate}, ${faturamento.protocolo}, ${faturamento.valor}, ${faturamento.observacao}, ${usuario.id})
      `;
      res.status(200).json({ faturamento });
      return;
    }

    res.status(405).json({ erro: 'método não permitido' });
  }catch(err){
    console.error('faturamentos error', err);
    res.status(500).json({ erro: 'Erro interno.' });
  }
};
