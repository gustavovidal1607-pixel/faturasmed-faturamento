const { sql, ensureSchema, permitirCors } = require('./_db.js');
const { usuarioDaSessao, escopoDoUsuario } = require('./_auth.js');
const { hojeBrasilISO, competenciaAtual } = require('./_data.js');
const { listarLinhas } = require('./_faturamentos.js');

const DIAS_ALERTA_PRAZO = 5;
const MAX_RANKING_PENDENCIAS = 8;

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
    const competencia = competenciaAtual();

    let convenios = await db`SELECT * FROM convenios WHERE ativo = true AND prazo_dia IS NOT NULL`;
    if (escopo !== null){
      const conveniosNoEscopo = new Set(escopo.map(e => e.convenio_id));
      convenios = convenios.filter(c => conveniosNoEscopo.has(c.id));
    }
    const prazosProximos = convenios
      .map(c => ({ ...c, dias_restantes: c.prazo_dia - diaHoje }))
      .filter(c => c.dias_restantes >= 0 && c.dias_restantes <= DIAS_ALERTA_PRAZO)
      .sort((a, b) => a.dias_restantes - b.dias_restantes);

    const linhas = await listarLinhas({ competencia, escopo });
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

    res.status(200).json({
      competencia,
      prazos_proximos: prazosProximos,
      faturamentos: linhas,
      total_pendentes: pendentes.length,
      ranking_pendencias: rankingPendencias,
    });
  }catch(err){
    console.error('dashboard error', err);
    res.status(500).json({ erro: 'Erro interno.' });
  }
};
