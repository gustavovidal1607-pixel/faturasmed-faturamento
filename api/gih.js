const ExcelJS = require('exceljs');
const { sql, ensureSchema, permitirCors } = require('./_db.js');
const { usuarioDaSessao, ehAdmin } = require('./_auth.js');

// Normaliza um nome de coluna pra comparar sem se importar com acento,
// maiúscula/minúscula ou espaço (ex: "Convênio", "CONVENIO ", "Convenio"
// todos viram "convenio").
function normalizarChave(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const SINONIMOS_CONVENIO = ['convenio', 'operadora', 'plano', 'planodesaude'];
const SINONIMOS_DATA = [
  'data', 'dataguia', 'datadaguia', 'dataatendimento', 'datainternacao',
  'datadeinternacao', 'dtatendimento', 'dtinternacao', 'dtguia',
];

function acharColuna(linha, sinonimos) {
  const chaves = Object.keys(linha);
  for (const s of sinonimos) {
    const achada = chaves.find(k => normalizarChave(k) === s);
    if (achada) return linha[achada];
  }
  return null;
}

// Datas podem vir como objeto Date (planilha com célula formatada como
// data) ou como texto dd/mm/aaaa -- nunca assume um formato só.
function paraDataISO(valor) {
  if (!valor) return null;
  if (valor instanceof Date && !isNaN(valor)) return valor.toISOString().slice(0, 10);
  const texto = String(valor).trim();
  const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0].slice(0, 10);
  return null;
}

// Lê a primeira planilha do arquivo (.xlsx) e devolve uma linha por
// registro, como objeto {NomeDaColuna: valor} -- primeira linha da
// planilha vira o nome das colunas.
async function lerLinhasPlanilha(bufferBase64) {
  const buffer = Buffer.from(bufferBase64, 'base64');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const cabecalhos = [];
  const linhas = [];
  sheet.eachRow((row, numeroLinha) => {
    if (numeroLinha === 1) {
      row.eachCell({ includeEmpty: true }, (cell, numeroColuna) => {
        cabecalhos[numeroColuna] = String(cell.value ?? '').trim();
      });
      return;
    }
    const linha = {};
    let temAlgumValor = false;
    row.eachCell({ includeEmpty: true }, (cell, numeroColuna) => {
      const chave = cabecalhos[numeroColuna];
      if (!chave) return;
      let valor = cell.value;
      // Célula com fórmula: usa o resultado calculado, não a fórmula.
      if (valor && typeof valor === 'object' && 'result' in valor) valor = valor.result;
      if (valor !== null && valor !== undefined && valor !== '') temAlgumValor = true;
      linha[chave] = valor ?? null;
    });
    if (temAlgumValor) linhas.push(linha);
  });
  return linhas;
}

module.exports = async (req, res) => {
  if (permitirCors(req, res)) return;
  try {
    await ensureSchema();
    const usuario = await usuarioDaSessao(req);
    if (!usuario) { res.status(401).json({ erro: 'Sessão inválida ou expirada.' }); return; }
    const db = sql();

    if (req.method === 'GET') {
      const baixar = req.query && req.query.baixar ? Number(req.query.baixar) : null;
      if (baixar) {
        const rows = await db`SELECT nome_arquivo, conteudo_base64 FROM gih_lotes WHERE id = ${baixar}`;
        if (!rows.length) { res.status(404).json({ erro: 'Arquivo não encontrado.' }); return; }
        res.status(200).json({ nome_arquivo: rows[0].nome_arquivo, conteudo_base64: rows[0].conteudo_base64 });
        return;
      }

      const [ultimoFaturista] = await db`
        SELECT l.id, l.nome_arquivo, l.criado_em, u.nome AS enviado_por_nome
        FROM gih_lotes l LEFT JOIN usuarios u ON u.id = l.enviado_por
        WHERE l.tipo = 'faturista' ORDER BY l.criado_em DESC LIMIT 1
      `;
      const [ultimoAdmin] = await db`
        SELECT l.id, l.nome_arquivo, l.criado_em, u.nome AS enviado_por_nome
        FROM gih_lotes l LEFT JOIN usuarios u ON u.id = l.enviado_por
        WHERE l.tipo = 'admin' ORDER BY l.criado_em DESC LIMIT 1
      `;
      const guias = await db`
        SELECT g.id, g.convenio, g.data, g.dados, g.faturado, g.observacao,
               g.faturado_em, uf.nome AS faturado_por_nome, g.lote_id, l.criado_em AS lote_criado_em
        FROM gih_guias g
        JOIN gih_lotes l ON l.id = g.lote_id
        LEFT JOIN usuarios uf ON uf.id = g.faturado_por
        ORDER BY g.faturado ASC, g.data ASC NULLS LAST, g.id ASC
      `;
      const resumo = {
        total: guias.length,
        faturadas: guias.filter(g => g.faturado).length,
      };
      resumo.pendentes = resumo.total - resumo.faturadas;

      res.status(200).json({
        lote_faturista: ultimoFaturista || null,
        lote_admin: ultimoAdmin || null,
        guias,
        resumo,
      });
      return;
    }

    if (req.method === 'POST') {
      const { tipo, nome_arquivo, conteudo_base64 } = req.body || {};
      if (!['faturista', 'admin'].includes(tipo)) {
        res.status(400).json({ erro: 'Tipo inválido.' }); return;
      }
      if (tipo === 'admin' && !ehAdmin(usuario)) {
        res.status(403).json({ erro: 'Só o administrador pode importar essa planilha.' }); return;
      }
      if (!nome_arquivo || !conteudo_base64) {
        res.status(400).json({ erro: 'Envie um arquivo.' }); return;
      }

      if (tipo === 'faturista') {
        const [lote] = await db`
          INSERT INTO gih_lotes (tipo, nome_arquivo, conteudo_base64, enviado_por)
          VALUES ('faturista', ${nome_arquivo}, ${conteudo_base64}, ${usuario.id})
          RETURNING id, nome_arquivo, criado_em
        `;
        res.status(201).json({ lote });
        return;
      }

      // tipo === 'admin': guarda o arquivo e lê linha a linha.
      let linhas;
      try {
        linhas = await lerLinhasPlanilha(conteudo_base64);
      } catch (err) {
        res.status(400).json({ erro: 'Não consegui ler essa planilha. Confira se é um arquivo .xlsx válido.' });
        return;
      }
      if (!linhas.length) {
        res.status(400).json({ erro: 'A planilha está vazia.' }); return;
      }

      const [lote] = await db`
        INSERT INTO gih_lotes (tipo, nome_arquivo, conteudo_base64, enviado_por)
        VALUES ('admin', ${nome_arquivo}, ${conteudo_base64}, ${usuario.id})
        RETURNING id, nome_arquivo, criado_em
      `;
      for (const linha of linhas) {
        const convenio = acharColuna(linha, SINONIMOS_CONVENIO);
        const data = paraDataISO(acharColuna(linha, SINONIMOS_DATA));
        await db`
          INSERT INTO gih_guias (lote_id, convenio, data, dados)
          VALUES (${lote.id}, ${convenio ? String(convenio) : null}, ${data}, ${JSON.stringify(linha)})
        `;
      }
      res.status(201).json({ lote, linhas_importadas: linhas.length });
      return;
    }

    if (req.method === 'PATCH') {
      const id = req.query && req.query.id ? Number(req.query.id) : null;
      if (!id) { res.status(400).json({ erro: 'Informe a guia.' }); return; }
      const { faturado, observacao } = req.body || {};
      if (faturado === undefined && observacao === undefined) {
        res.status(400).json({ erro: 'Nada para atualizar.' }); return;
      }

      // Duas UPDATEs simples e independentes em vez de uma só genérica --
      // um "CASE WHEN $1 IS NULL" com o mesmo parâmetro reaproveitado em
      // mais de um lugar deixa o Postgres sem contexto pra inferir o tipo
      // do parâmetro (erro "could not determine data type").
      if (faturado !== undefined) {
        await db`
          UPDATE gih_guias SET
            faturado = ${faturado},
            faturado_por = ${faturado ? usuario.id : null},
            faturado_em = ${faturado ? new Date().toISOString() : null}
          WHERE id = ${id}
        `;
      }
      if (observacao !== undefined) {
        await db`UPDATE gih_guias SET observacao = ${observacao} WHERE id = ${id}`;
      }
      const result = await db`SELECT id FROM gih_guias WHERE id = ${id}`;
      if (!result.length) { res.status(404).json({ erro: 'Guia não encontrada.' }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ erro: 'método não permitido' });
  } catch (err) {
    console.error('gih error', err);
    res.status(500).json({ erro: 'Erro interno.' });
  }
};
