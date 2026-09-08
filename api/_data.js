// Data de hoje no fuso de Brasília, em ISO (YYYY-MM-DD) -- o servidor
// serverless roda em UTC, então "hoje" puro do Node erra de madrugada.
function hojeBrasilISO(){
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const map = Object.fromEntries(partes.map(p => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function competenciaAtual(){
  return hojeBrasilISO().slice(0, 7); // 'YYYY-MM'
}

module.exports = { hojeBrasilISO, competenciaAtual };
