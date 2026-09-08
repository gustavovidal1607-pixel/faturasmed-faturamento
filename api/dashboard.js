const { sql, ensureSchema, permitirCors } = require('./_db.js');
const { usuarioDaSessao, escopoDoUsuario } = require('./_auth.js');
const { hojeBrasilISO, dataBrasilISO, competenciaAtual } = require('./_data.js');
const { listarLinhas } = require('./_faturamentos.js');

const DIAS_ALERTA_PRAZO = 5;
const MAX_RANKING_PENDENCIAS = 8;
const PRAZO_ANEXO_DIAS = 12;

// Diferença em dias de calendário entre duas datas ISO (YYYY-MM-DD) --
// meio-dia UTC pra não sofrer com fuso/horário de verão na conta.
function diasEntre(dataInicioISO, dataFimISO){
  return Math.round((new Date(dataFimISO + 'T12:00:00Z') - new Date(dataInicioISO + 'T12:00:00Z')) / 86400000);
}

// Alertas e indicadores da competência atual: prazos de fechamento
// chegando perto, lançamentos ainda sem "faturado" e o ranking de
// prestadores com mais pendências -- tudo já filtrado pelo escopo de
// quem pede (administrador vê tudo, faturista só o que é responsável).
module.exports = async (req, res) => {
  if (permitirCors(req, res)) return;
  try{
    await ensureSchema();
    const usuario = await usuarioDaSessao(req);
    if (!usuario){ res.status(401).json({ erro: 'Sessão inválida ou expirada.' }); return; }
    const db = sql();
    const escopo = await escopoDoUsuario(usuario);

    const hoje = hojeBrasilISO();
    const diaHoje = Number(hoje.slice(8, 10));
    const competencia = (req.query && /^\d{4}-\d{2}$/.test(req.query.competencia)) ? req.query.competencia : competenciaAtual();
    const convenioId = req.query && req.query.convenio_id ? Number(req.query.convenio_id) : null;
    const prestadorId = req.query && req.query.prestador_id ? Number(req.query.prestador_id) : null;

    // Consolidado numa chamada só (em vez de 3 separadas: dashboard,
    // convenios, prestadores) pra reduzir o número de conexões frias
    // simultâneas logo na abertura da tela.
    let todosConvenios = await db`SELECT * FROM convenios WHERE ativo = true ORDER BY nome`;
    let todosPrestadores = await db`SELECT * FROM prestadores WHERE ativo = true ORDER BY nome`;
    if (escopo !== null){
      const conveniosDoEscopo = new Set(escopo.map(e => e.convenio_id));
      const prestadoresDoEscopo = new Set(escopo.map(e => e.prestador_id));
      todosConvenios = todosConvenios.filter(c => conveniosDoEscopo.has(c.id));
      todosPrestadores = todosPrestadores.filter(p => prestadoresDoEscopo.has(p.id));
    }

    const convenios = todosConvenios.filter(c => c.prazo_dia != null);
    const prazosProximos = convenios
      .map(c => ({ ...c, dias_restantes: c.prazo_dia - diaHoje }))
      .filter(c => c.dias_restantes >= 0 && c.dias_restantes <= DIAS_ALERTA_PRAZO)
      .sort((a, b) => a.dias_restantes - b.dias_restantes);

    const linhas = await listarLinhas({ competencia, escopo, convenioId, prestadorId });
    const pendentes = linhas.filter(l => l.status !== 'faturado');

    const porPrestador = new Map();
    for (const l of pendentes){
      const atual = porPrestador.get(l.prestador_id) || { prestador_nome: l.prestador_nome, total: 0 };
      atual.total++;
      porPrestador.set(l.prestador_id, atual);
    }
    const rankingPendencias = [...porPrestador.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, MAX_RANKING_PENDENCIAS);

    // Quantos protocolos já foram marcados "faturado" na competência
    // atual de verdade (mês corrente, não a competência que porventura
    // esteja sendo filtrada na tela) -- mostrado ao lado do nome do
    // prestador, sempre baseado na data de hoje.
    const competenciaReal = competenciaAtual();
    let protocolosFaturadosMes = await db`
      SELECT f.prestador_id, COUNT(*) AS quantidade
      FROM faturamentos_protocolos p
      JOIN faturamentos f ON f.id = p.faturamento_id
      WHERE p.status = 'faturado' AND f.competencia = ${competenciaReal}
      GROUP BY f.prestador_id
    `;
    if (escopo !== null){
      const prestadoresNoEscopo = new Set(escopo.map(e => e.prestador_id));
      protocolosFaturadosMes = protocolosFaturadosMes.filter(r => prestadoresNoEscopo.has(r.prestador_id));
    }

    // Prazo de 12 dias que a operadora dá pra resolver o anexo depois de
    // enviar o protocolo -- conta a partir da data informada no protocolo
    // (ou de quando foi criado, se a data não foi preenchida). Mostra os
    // que estão perto de vencer (ou já vencidos) pra virar alerta.
    let protocolosFaltaAnexo = await db`
      SELECT p.protocolo, p.data, p.criado_em, f.prestador_id, f.convenio_id, f.tipo,
             pr.nome AS prestador_nome, c.nome AS convenio_nome
      FROM faturamentos_protocolos p
      JOIN faturamentos f ON f.id = p.faturamento_id
      JOIN prestadores pr ON pr.id = f.prestador_id
      JOIN convenios c ON c.id = f.convenio_id
      WHERE p.status = 'enviado_falta_anexo'
    `;
    if (escopo !== null){
      const prestadoresNoEscopo = new Set(escopo.map(e => e.prestador_id));
      protocolosFaltaAnexo = protocolosFaltaAnexo.filter(p => prestadoresNoEscopo.has(p.prestador_id));
    }
    const prazosAnexo = protocolosFaltaAnexo
      .map(p => {
        const dataBase = dataBrasilISO(p.data || p.criado_em);
        const diasRestantes = PRAZO_ANEXO_DIAS - diasEntre(dataBase, hoje);
        return {
          prestador_nome: p.prestador_nome,
          convenio_nome: p.convenio_nome,
          tipo: p.tipo,
          protocolo: p.protocolo,
          dias_restantes: diasRestantes,
        };
      })
      .filter(p => p.dias_restantes <= DIAS_ALERTA_PRAZO)
      .sort((a, b) => a.dias_restantes - b.dias_restantes);

    res.status(200).json({
      competencia,
      competencia_atual: competenciaReal,
      prazos_proximos: prazosProximos,
      prazos_anexo: prazosAnexo,
      faturamentos: linhas,
      total_pendentes: pendentes.length,
      ranking_pendencias: rankingPendencias,
      protocolos_faturados_mes: Object.fromEntries(protocolosFaturadosMes.map(r => [r.prestador_id, Number(r.quantidade)])),
      convenios: todosConvenios,
      prestadores: todosPrestadores,
    });
  }catch(err){
    console.error('dashboard error', err);
    res.status(500).json({ erro: 'Erro interno.' });
  }
};
