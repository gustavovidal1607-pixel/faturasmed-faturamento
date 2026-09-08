const { sql, ensureSchema, permitirCors } = require('./_db.js');
const { usuarioDaSessao, ehAdmin } = require('./_auth.js');
const { dataBrasilISO, hojeBrasilISO } = require('./_data.js');

// Produção individual da equipe: cada alteração de status em
// faturamentos_historico conta como uma "ação". Sempre um ano inteiro
// (fuso de Brasília), organizado por mês -- dentro de cada mês, o
// detalhe fica por dia.
module.exports = async (req, res) => {
  if (permitirCors(req, res)) return;
  try{
    await ensureSchema();
    const usuario = await usuarioDaSessao(req);
    if (!ehAdmin(usuario)){ res.status(403).json({ erro: 'Acesso restrito ao administrador.' }); return; }
    const db = sql();

    const ano = req.query && req.query.ano ? Number(req.query.ano) : Number(hojeBrasilISO().slice(0, 4));
    const desde = new Date(`${ano}-01-01T00:00:00-03:00`);
    const ate = new Date(`${ano + 1}-01-01T00:00:00-03:00`);

    const rows = await db`
      SELECT h.status, h.criado_em, h.alterado_por, u.nome AS usuario_nome,
             f.tipo, c.nome AS convenio_nome, p.nome AS prestador_nome
      FROM faturamentos_historico h
      JOIN usuarios u ON u.id = h.alterado_por
      JOIN faturamentos f ON f.id = h.faturamento_id
      JOIN convenios c ON c.id = f.convenio_id
      JOIN prestadores p ON p.id = f.prestador_id
      WHERE h.criado_em >= ${desde.toISOString()} AND h.criado_em < ${ate.toISOString()}
      ORDER BY h.criado_em DESC
    `;

    const porUsuario = new Map();
    for (const r of rows){
      if (!porUsuario.has(r.alterado_por)){
        porUsuario.set(r.alterado_por, { usuario_id: r.alterado_por, usuario_nome: r.usuario_nome, porMes: new Map(), totalPorStatus: {} });
      }
      const u = porUsuario.get(r.alterado_por);
      const dia = dataBrasilISO(r.criado_em);
      const mes = dia.slice(0, 7);
      if (!u.porMes.has(mes)) u.porMes.set(mes, []);
      u.porMes.get(mes).push({
        dia,
        status: r.status,
        convenio_nome: r.convenio_nome,
        prestador_nome: r.prestador_nome,
        tipo: r.tipo,
        criado_em: r.criado_em,
      });
      u.totalPorStatus[r.status] = (u.totalPorStatus[r.status] || 0) + 1;
    }

    const usuarios = [...porUsuario.values()].map(u => {
      const porMes = [...u.porMes.entries()]
        .map(([mes, itens]) => ({ mes, total: itens.length, itens: itens.sort((a, b) => b.criado_em.localeCompare(a.criado_em)) }))
        .sort((a, b) => a.mes.localeCompare(b.mes));
      return {
        usuario_id: u.usuario_id,
        usuario_nome: u.usuario_nome,
        total: porMes.reduce((soma, m) => soma + m.total, 0),
        total_por_status: u.totalPorStatus,
        por_mes: porMes,
      };
    }).sort((a, b) => b.total - a.total);

    res.status(200).json({ ano, usuarios });
  }catch(err){
    console.error('atividades error', err);
    res.status(500).json({ erro: 'Erro interno.' });
  }
};
