const { sql } = require('./_db.js');

// Monta a lista de faturamento por prestador+convênio+tipo pra uma
// competência: uma linha por combinação, com status "pendente" calculado
// na hora quando não existe lançamento (evita job mensal pra pré-criar
// linhas). Usado tanto pela tela de Faturamentos quanto pelos alertas do
// Painel.
async function listarLinhas({ competencia, escopo, convenioId, prestadorId, status }){
  const db = sql();
  // vinculos e lancamentos não dependem um do outro -- dispara os dois de
  // uma vez em vez de esperar um pra só então pedir o outro (cada round-trip
  // pro Neon custa dezenas/centenas de ms, e essa tela soma vários).
  let [vinculos, lancamentos] = await Promise.all([
    db`
      SELECT v.id AS vinculo_id, v.prestador_id, v.convenio_id, p.nome AS prestador_nome, c.nome AS convenio_nome
      FROM vinculos v
      JOIN prestadores p ON p.id = v.prestador_id
      JOIN convenios c ON c.id = v.convenio_id
      WHERE v.ativo = true AND p.ativo = true AND c.ativo = true
      ORDER BY c.nome, p.nome
    `,
    db`SELECT * FROM faturamentos WHERE competencia = ${competencia}`,
  ]);
  if (escopo !== null){
    const chaves = new Set(escopo.map(e => `${e.prestador_id}:${e.convenio_id}`));
    vinculos = vinculos.filter(v => chaves.has(`${v.prestador_id}:${v.convenio_id}`));
  }
  if (convenioId) vinculos = vinculos.filter(v => v.convenio_id === convenioId);
  if (prestadorId) vinculos = vinculos.filter(v => v.prestador_id === prestadorId);

  const porChave = new Map(lancamentos.map(l => [`${l.convenio_id}:${l.prestador_id}:${l.tipo}`, l]));
  const idsVinculos = vinculos.map(v => v.vinculo_id);
  const idsLancamentos = lancamentos.map(l => l.id);

  // Idem aqui: os tipos de cada vínculo e o resumo de protocolos de cada
  // lançamento também são independentes entre si.
  const [tiposRows, agregados] = await Promise.all([
    idsVinculos.length
      ? db`SELECT vinculo_id, tipo, particularidades FROM vinculos_tipos WHERE vinculo_id = ANY(${idsVinculos}) ORDER BY tipo`
      : [],
    idsLancamentos.length
      ? db`
          SELECT faturamento_id,
                 COUNT(*) AS quantidade,
                 COUNT(*) FILTER (WHERE status = 'faturado') AS faturados,
                 SUM(valor) AS total
          FROM faturamentos_protocolos
          WHERE faturamento_id = ANY(${idsLancamentos})
          GROUP BY faturamento_id
        `
      : [],
  ]);
  const tiposPorVinculo = new Map(); // vinculo_id -> [{ tipo, particularidades }]
  for (const t of tiposRows){
    if (!tiposPorVinculo.has(t.vinculo_id)) tiposPorVinculo.set(t.vinculo_id, []);
    tiposPorVinculo.get(t.vinculo_id).push(t);
  }
  const resumoProtocolos = new Map(); // faturamento_id -> { quantidade, faturados, total }
  for (const a of agregados) resumoProtocolos.set(a.faturamento_id, { quantidade: Number(a.quantidade), faturados: Number(a.faturados), total: a.total });

  let linhas = [];
  for (const v of vinculos){
    const tiposDoVinculo = tiposPorVinculo.get(v.vinculo_id) || [];
    for (const { tipo, particularidades } of tiposDoVinculo){
      const l = porChave.get(`${v.convenio_id}:${v.prestador_id}:${tipo}`);
      const resumo = l ? resumoProtocolos.get(l.id) : null;
      linhas.push({
        convenio_id: v.convenio_id,
        convenio_nome: v.convenio_nome,
        prestador_id: v.prestador_id,
        prestador_nome: v.prestador_nome,
        tipo,
        particularidades: particularidades || null,
        competencia,
        status: l ? l.status : 'pendente',
        mes_completo: l ? !!l.mes_completo : false,
        faturado_de: l ? l.faturado_de : null,
        faturado_ate: l ? l.faturado_ate : null,
        protocolos_quantidade: resumo ? resumo.quantidade : 0,
        protocolos_faturados: resumo ? resumo.faturados : 0,
        protocolos_total: resumo ? resumo.total : null,
        observacao: l ? l.observacao : null,
        faturamento_id: l ? l.id : null,
      });
    }
  }
  if (status) linhas = linhas.filter(l => l.status === status);
  return linhas;
}

module.exports = { listarLinhas };
