// Data de um instante qualquer no fuso de Brasília, em ISO (YYYY-MM-DD) --
// o servidor serverless roda em UTC, então agrupar por "dia" sem isso
// erra a virada perto da meia-noite.
function dataBrasilISO(dataOuTimestamp){
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(dataOuTimestamp));
  const map = Object.fromEntries(partes.map(p => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function hojeBrasilISO(){
  return dataBrasilISO(new Date());
}

function competenciaAtual(){
  return hojeBrasilISO().slice(0, 7); // 'YYYY-MM'
}

module.exports = { dataBrasilISO, hojeBrasilISO, competenciaAtual };
