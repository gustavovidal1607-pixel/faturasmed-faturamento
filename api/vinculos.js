const { sql, ensureSchema, permitirCors } = require('./_db.js');
const { usuarioDaSessao, ehAdmin, escopoDoUsuario, paresIncluem } = require('./_auth.js');
const { cifrar, decifrar } = require('./_cripto.js');

// Monta o objeto de retorno já com a senha decifrada -- só quem tem
// acesso ao vínculo (administrador, ou o funcionário responsável por
// aquele par) recebe a senha em claro; os demais nem chegam a listar essa
// linha (ver filtro de escopo abaixo).
function comSenhaDecifrada(v){
  const { senha_cifrada, senha_iv, senha_auth_tag, ...resto } = v;
  let senha_portal = null;
  try{ senha_portal = decifrar({ senha_cifrada, senha_iv, senha_auth_tag }); }catch{ senha_portal = null; }
  return { ...resto, senha_portal };
}

const TIPOS_VALIDOS = ['SADT', 'CONSULTA', 'GIH'];

// Cada vínculo escolhe quais tipos esse prestador realmente faz para esse
// convênio (nem todo mundo faz os 3), e cada tipo tem sua própria
// particularidade de faturamento -- substitui as linhas antigas por
// completo a cada chamada (mais simples que diff incremental).
async function salvarTipos(db, vinculoId, tipos){
  if (!Array.isArray(tipos)) return;
  const validos = tipos.filter(t => t && TIPOS_VALIDOS.includes(t.tipo));
  await db`DELETE FROM vinculos_tipos WHERE vinculo_id = ${vinculoId}`;
  for (const t of validos){
    await db`
      INSERT INTO vinculos_tipos (vinculo_id, tipo, particularidades)
      VALUES (${vinculoId}, ${t.tipo}, ${t.particularidades || null})
    `;
  }
}

module.exports = async (req, res) => {
  if (permitirCors(req, res)) return;
  try{
    await ensureSchema();
    const usuario = await usuarioDaSessao(req);
    if (!usuario){ res.status(401).json({ erro: 'Sessão inválida ou expirada.' }); return; }
    const db = sql();
    const id = req.query && req.query.id ? Number(req.query.id) : null;

    if (!id){
      if (req.method === 'GET'){
        let rows = await db`
          SELECT v.*, p.nome AS prestador_nome, c.nome AS convenio_nome
          FROM vinculos v
          JOIN prestadores p ON p.id = v.prestador_id
          JOIN convenios c ON c.id = v.convenio_id
          ORDER BY c.nome, p.nome
        `;
        const escopo = await escopoDoUsuario(usuario);
        if (escopo !== null) rows = rows.filter(v => paresIncluem(escopo, v.prestador_id, v.convenio_id));
        const idsVinculos = rows.map(v => v.id);
        const tiposPorVinculo = new Map();
        if (idsVinculos.length){
          const tiposRows = await db`SELECT vinculo_id, tipo, particularidades FROM vinculos_tipos WHERE vinculo_id = ANY(${idsVinculos}) ORDER BY tipo`;
          for (const t of tiposRows){
            if (!tiposPorVinculo.has(t.vinculo_id)) tiposPorVinculo.set(t.vinculo_id, []);
            tiposPorVinculo.get(t.vinculo_id).push({ tipo: t.tipo, particularidades: t.particularidades });
          }
        }
        const comTipos = rows.map(v => ({ ...comSenhaDecifrada(v), tipos: tiposPorVinculo.get(v.id) || [] }));
        res.status(200).json({ vinculos: comTipos });
        return;
      }
      if (req.method === 'POST'){
        if (!ehAdmin(usuario)){ res.status(403).json({ erro: 'Acesso restrito ao administrador.' }); return; }
        const { prestador_id, convenio_id, login_portal, senha_portal, tipos } = req.body || {};
        if (!prestador_id || !convenio_id){ res.status(400).json({ erro: 'Selecione o prestador e o convênio.' }); return; }
        if (!Array.isArray(tipos) || !tipos.some(t => t && TIPOS_VALIDOS.includes(t.tipo))){ res.status(400).json({ erro: 'Selecione ao menos um tipo (SADT, CONSULTA ou GIH).' }); return; }
        const cifra = senha_portal ? cifrar(senha_portal) : { senha_cifrada: null, senha_iv: null, senha_auth_tag: null };
        try{
          const inserido = await db`
            INSERT INTO vinculos (prestador_id, convenio_id, login_portal, senha_cifrada, senha_iv, senha_auth_tag)
            VALUES (${prestador_id}, ${convenio_id}, ${login_portal || null}, ${cifra.senha_cifrada}, ${cifra.senha_iv}, ${cifra.senha_auth_tag})
            RETURNING *
          `;
          await salvarTipos(db, inserido[0].id, tipos);
          res.status(201).json({ vinculo: { ...comSenhaDecifrada(inserido[0]), tipos: tipos.filter(t => t && TIPOS_VALIDOS.includes(t.tipo)) } });
        }catch(err){
          if (err.code === '23505'){ res.status(409).json({ erro: 'Esse prestador já está vinculado a esse convênio.' }); return; }
          throw err;
        }
        return;
      }
      res.status(405).json({ erro: 'método não permitido' });
      return;
    }

    if (req.method === 'PATCH'){
      const linhas = await db`SELECT * FROM vinculos WHERE id = ${id}`;
      const vinculo = linhas[0];
      if (!vinculo){ res.status(404).json({ erro: 'Vínculo não encontrado.' }); return; }
      const escopo = await escopoDoUsuario(usuario);
      if (!paresIncluem(escopo, vinculo.prestador_id, vinculo.convenio_id)){ res.status(403).json({ erro: 'Você não tem acesso a esse vínculo.' }); return; }

      const { prestador_id, convenio_id, login_portal, senha_portal, tipos, ativo } = req.body || {};
      if ((ativo !== undefined || prestador_id !== undefined || convenio_id !== undefined) && !ehAdmin(usuario)){
        res.status(403).json({ erro: 'Só o administrador altera prestador, convênio ou status do vínculo.' });
        return;
      }
      if (tipos !== undefined && (!Array.isArray(tipos) || !tipos.some(t => t && TIPOS_VALIDOS.includes(t.tipo)))){
        res.status(400).json({ erro: 'Selecione ao menos um tipo (SADT, CONSULTA ou GIH).' });
        return;
      }

      let cifra = { senha_cifrada: vinculo.senha_cifrada, senha_iv: vinculo.senha_iv, senha_auth_tag: vinculo.senha_auth_tag };
      if (senha_portal !== undefined) cifra = senha_portal ? cifrar(senha_portal) : { senha_cifrada: null, senha_iv: null, senha_auth_tag: null };

      try{
        const result = await db`
          UPDATE vinculos SET
            prestador_id = COALESCE(${prestador_id ?? null}, prestador_id),
            convenio_id = COALESCE(${convenio_id ?? null}, convenio_id),
            login_portal = COALESCE(${login_portal ?? null}, login_portal),
            senha_cifrada = ${cifra.senha_cifrada},
            senha_iv = ${cifra.senha_iv},
            senha_auth_tag = ${cifra.senha_auth_tag},
            ativo = COALESCE(${ativo ?? null}, ativo)
          WHERE id = ${id}
          RETURNING *
        `;
        if (tipos !== undefined) await salvarTipos(db, id, tipos);
        const tiposRows = await db`SELECT tipo, particularidades FROM vinculos_tipos WHERE vinculo_id = ${id} ORDER BY tipo`;
        res.status(200).json({ vinculo: { ...comSenhaDecifrada(result[0]), tipos: tiposRows } });
      }catch(err){
        if (err.code === '23505'){ res.status(409).json({ erro: 'Esse prestador já está vinculado a esse convênio.' }); return; }
        throw err;
      }
      return;
    }

    if (req.method === 'DELETE'){
      if (!ehAdmin(usuario)){ res.status(403).json({ erro: 'Acesso restrito ao administrador.' }); return; }
      try{
        const result = await db`DELETE FROM vinculos WHERE id = ${id} RETURNING id`;
        if (!result.length){ res.status(404).json({ erro: 'Vínculo não encontrado.' }); return; }
        res.status(200).json({ ok: true });
      }catch(err){
        if (err.code === '23503'){
          res.status(409).json({ erro: 'Não é possível excluir: já existem lançamentos para esse vínculo. Desative-o em vez de excluir.' });
          return;
        }
        throw err;
      }
      return;
    }

    res.status(405).json({ erro: 'método não permitido' });
  }catch(err){
    console.error('vinculos error', err);
    res.status(500).json({ erro: 'Erro interno.' });
  }
};
