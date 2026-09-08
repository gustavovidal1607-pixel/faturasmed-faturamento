const { sql, ensureSchema, permitirCors } = require('./_db.js');
const { usuarioDaSessao, ehAdmin } = require('./_auth.js');
const { hojeBrasilISO, competenciaAtual } = require('./_data.js');
const { listarLinhas } = require('./_faturamentos.js');

const DIAS_ALERTA_PRAZO = 5;

// Painel de alertas do administrador: convênios com prazo de fechamento
// chegando perto, e prestadores ainda sem lançamento "faturado" na
// competência atual.
module.exports = async (req, res) => {
  if (permitirCors(req, res)) return;
  try{
    await ensureSchema();
    const usuario = await usuarioDaSessao(req);
    if (!ehAdmin(usuario)){ res.status(403).json({ erro: 'Acesso restrito ao administrador.' }); return; }
    const db = sql();

    const hoje = hojeBrasilISO();
    const diaHoje = Number(hoje.slice(8, 10));
    const competencia = competenciaAtual();

    const convenios = await db`SELECT * FROM convenios WHERE ativo = true AND prazo_dia IS NOT NULL`;
    const prazosProximos = convenios
      .map(c => ({ ...c, dias_restantes: c.prazo_dia - diaHoje }))
      .filter(c => c.dias_restantes >= 0 && c.dias_restantes <= DIAS_ALERTA_PRAZO)
      .sort((a, b) => a.dias_restantes - b.dias_restantes);

    const linhas = await listarLinhas({ competencia, escopo: null });
    const totalPendentes = linhas.filter(l => l.status !== 'faturado').length;

    res.status(200).json({
      competencia,
      prazos_proximos: prazosProximos,
      faturamentos: linhas,
      total_pendentes: totalPendentes,
    });
  }catch(err){
    console.error('dashboard error', err);
    res.status(500).json({ erro: 'Erro interno.' });
  }
};
