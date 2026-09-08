const { sql, ensureSchema, permitirCors } = require('./_db.js');
const { usuarioDaSessao, ehAdmin } = require('./_auth.js');
const { dataBrasilISO } = require('./_data.js');

const DIAS_PADRAO = 30;

// Produção individual da equipe: cada alteração de status em
// faturamentos_historico conta como uma "ação". Agrupa por faturista e
// por dia (fuso de Brasília, não UTC) pra montar gráfico e o card de
// "o que fez em cada dia".
module.exports = async (req, res) => {
  if (permitirCors(req, res)) return;
  try{
    await ensureSchema();
    const usuario = await usuarioDaSessao(req);
    if (!ehAdmin(usuario)){ res.status(403).json({ erro: 'Acesso restrito ao administrador.' }); return; }
    const db = sql();

    const dias = req.query && req.query.dias ? Number(req.query.dias) : DIAS_PADRAO;
    const desde = new Date(Date.now() - dias * 86400000);

    const rows = await db`
      SELECT h.status, h.criado_em, h.alterado_por, u.nome AS usuario_nome,
             f.tipo, c.nome AS convenio_nome, p.nome AS prestador_nome
      FROM faturamentos_historico h
      JOIN usuarios u ON u.id = h.alterado_por
      JOIN faturamentos f ON f.id = h.faturamento_id
      JOIN convenios c ON c.id = f.convenio_id
      JOIN prestadores p ON p.id = f.prestador_id
      WHERE h.criado_em >= ${desde.toISOString()}
      ORDER BY h.criado_em DESC
    `;

    const porUsuario = new Map();
    for (const r of rows){
      if (!porUsuario.has(r.alterado_por)){
        porUsuario.set(r.alterado_por, { usuario_id: r.alterado_por, usuario_nome: r.usuario_nome, porDia: new Map(), totalPorStatus: {} });
      }
      const u = porUsuario.get(r.alterado_por);
      const dia = dataBrasilISO(r.criado_em);
      if (!u.porDia.has(dia)) u.porDia.set(dia, []);
      u.porDia.get(dia).push({
        status: r.status,
        convenio_nome: r.convenio_nome,
        prestador_nome: r.prestador_nome,
        tipo: r.tipo,
        criado_em: r.criado_em,
      });
      u.totalPorStatus[r.status] = (u.totalPorStatus[r.status] || 0) + 1;
    }

    const usuarios = [...porUsuario.values()].map(u => {
      const porDia = [...u.porDia.entries()]
        .map(([dia, itens]) => ({ dia, total: itens.length, itens }))
        .sort((a, b) => a.dia.localeCompare(b.dia));
      return {
        usuario_id: u.usuario_id,
        usuario_nome: u.usuario_nome,
        total: porDia.reduce((soma, d) => soma + d.total, 0),
        total_por_status: u.totalPorStatus,
        por_dia: porDia,
      };
    }).sort((a, b) => b.total - a.total);

    res.status(200).json({ dias, usuarios });
  }catch(err){
    console.error('atividades error', err);
    res.status(500).json({ erro: 'Erro interno.' });
  }
};
