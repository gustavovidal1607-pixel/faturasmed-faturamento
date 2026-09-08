const { sql } = require('./_db.js');

// Monta a lista de faturamento por prestador+convênio+tipo pra uma
// competência: uma linha por combinação, com status "pendente" calculado
// na hora quando não existe lançamento (evita job mensal pra pré-criar
// linhas). Usado tanto pela tela de Faturamentos quanto pelos alertas do
// Painel.
async function listarLinhas({ competencia, escopo, convenioId, prestadorId, status }){
  const db = sql();
  let vinculos = await db`
    SELECT v.prestador_id, v.convenio_id, p.nome AS prestador_nome, c.nome AS convenio_nome, c.tipos
    FROM vinculos v
    JOIN prestadores p ON p.id = v.prestador_id
    JOIN convenios c ON c.id = v.convenio_id
    WHERE v.ativo = true AND p.ativo = true AND c.ativo = true
    ORDER BY c.nome, p.nome
  `;
  if (escopo !== null){
    const chaves = new Set(escopo.map(e => `${e.prestador_id}:${e.convenio_id}`));
    vinculos = vinculos.filter(v => chaves.has(`${v.prestador_id}:${v.convenio_id}`));
  }
  if (convenioId) vinculos = vinculos.filter(v => v.convenio_id === convenioId);
  if (prestadorId) vinculos = vinculos.filter(v => v.prestador_id === prestadorId);

  const lancamentos = await db`SELECT * FROM faturamentos WHERE competencia = ${competencia}`;
  const porChave = new Map(lancamentos.map(l => [`${l.convenio_id}:${l.prestador_id}:${l.tipo}`, l]));

  let linhas = [];
  for (const v of vinculos){
    for (const tipo of v.tipos){
      const l = porChave.get(`${v.convenio_id}:${v.prestador_id}:${tipo}`);
      linhas.push({
        convenio_id: v.convenio_id,
        convenio_nome: v.convenio_nome,
        prestador_id: v.prestador_id,
        prestador_nome: v.prestador_nome,
        tipo,
        competencia,
        status: l ? l.status : 'pendente',
        mes_completo: l ? !!l.mes_completo : false,
        faturado_ate: l ? l.faturado_ate : null,
        observacao: l ? l.observacao : null,
        faturamento_id: l ? l.id : null,
      });
    }
  }
  if (status) linhas = linhas.filter(l => l.status === status);
  return linhas;
}

module.exports = { listarLinhas };
