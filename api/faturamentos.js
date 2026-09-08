const { sql, ensureSchema, permitirCors } = require('./_db.js');
const { usuarioDaSessao, ehAdmin, escopoDoUsuario, paresIncluem } = require('./_auth.js');
const { competenciaAtual } = require('./_data.js');
const { listarLinhas } = require('./_faturamentos.js');

const TIPOS_VALIDOS = ['SADT', 'CONSULTA', 'GIH'];

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
      // O status do lançamento não é mais setado por aqui -- é derivado
      // automaticamente dos protocolos (ver api/protocolos.js). Esse POST
      // serve só pra criar o lançamento na primeira vez (se ainda não
      // existir) e/ou atualizar a observação.
      const { convenio_id, prestador_id, tipo, competencia, observacao } = req.body || {};
      if (!convenio_id || !prestador_id){ res.status(400).json({ erro: 'Selecione o prestador e o convênio.' }); return; }
      if (!TIPOS_VALIDOS.includes(tipo)){ res.status(400).json({ erro: 'Tipo inválido.' }); return; }
      if (!competencia || !/^\d{4}-\d{2}$/.test(competencia)){ res.status(400).json({ erro: 'Competência inválida.' }); return; }

      const escopo = await escopoDoUsuario(usuario);
      if (!paresIncluem(escopo, prestador_id, convenio_id)){ res.status(403).json({ erro: 'Você não é responsável por esse prestador/convênio.' }); return; }

      const upsert = await db`
        INSERT INTO faturamentos (convenio_id, prestador_id, tipo, competencia, status, observacao, lancado_por)
        VALUES (${convenio_id}, ${prestador_id}, ${tipo}, ${competencia}, 'pendente', ${observacao || null}, ${usuario.id})
        ON CONFLICT (convenio_id, prestador_id, tipo, competencia)
        DO UPDATE SET
          observacao = COALESCE(${observacao ?? null}, faturamentos.observacao),
          lancado_por = EXCLUDED.lancado_por,
          atualizado_em = now()
        RETURNING *
      `;
      res.status(200).json({ faturamento: upsert[0] });
      return;
    }

    if (req.method === 'DELETE'){
      if (!ehAdmin(usuario)){ res.status(403).json({ erro: 'Só o administrador remove um lançamento.' }); return; }
      const id = req.query && req.query.id ? Number(req.query.id) : null;
      if (!id){ res.status(400).json({ erro: 'Informe o id do lançamento.' }); return; }
      const result = await db`DELETE FROM faturamentos WHERE id = ${id} RETURNING id`;
      if (!result.length){ res.status(404).json({ erro: 'Lançamento não encontrado.' }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ erro: 'método não permitido' });
  }catch(err){
    console.error('faturamentos error', err);
    res.status(500).json({ erro: 'Erro interno.' });
  }
};
