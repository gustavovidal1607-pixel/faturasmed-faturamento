const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');

let sqlSingleton = null;
function sql(){
  if (!sqlSingleton) sqlSingleton = neon(process.env.DATABASE_URL);
  return sqlSingleton;
}

let schemaReady = null;
async function ensureSchema(){
  if (schemaReady) return schemaReady;
  const db = sql();
  // Se a promise rejeitar, esquece ela (schemaReady = null) em vez de
  // deixar guardada pra sempre, senão uma falha passageira deixa toda
  // invocação seguinte dessa mesma instância quente retornando erro 500.
  schemaReady = (async () => {
    await db`CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      login VARCHAR(60) UNIQUE NOT NULL,
      nome TEXT NOT NULL,
      salt VARCHAR(64) NOT NULL,
      hash VARCHAR(256) NOT NULL,
      papel VARCHAR(20) NOT NULL CHECK (papel IN ('funcionario','administrador')),
      ativo BOOLEAN NOT NULL DEFAULT true,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await db`CREATE TABLE IF NOT EXISTS sessoes (
      token VARCHAR(64) PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      expira_em TIMESTAMPTZ NOT NULL
    )`;

    // Tipos de faturamento suportados por um convênio -- nem todo convênio
    // fatura os três (ex: alguns não têm GIH).
    await db`CREATE TABLE IF NOT EXISTS convenios (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      tipos TEXT[] NOT NULL DEFAULT ARRAY['SADT','CONSULTA','GIH'],
      prazo_dia SMALLINT CHECK (prazo_dia BETWEEN 1 AND 31),
      ativo BOOLEAN NOT NULL DEFAULT true,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await db`CREATE UNIQUE INDEX IF NOT EXISTS idx_convenios_nome_unico ON convenios (lower(nome))`;

    await db`CREATE TABLE IF NOT EXISTS prestadores (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      especialidade TEXT,
      ativo BOOLEAN NOT NULL DEFAULT true,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await db`CREATE UNIQUE INDEX IF NOT EXISTS idx_prestadores_nome_unico ON prestadores (lower(nome))`;

    // Vínculo prestador+convênio: login/senha do portal daquele convênio
    // (a senha vem cifrada, ver api/_cripto.js) e as particularidades de
    // como faturar -- específicas dessa combinação, não do prestador nem
    // do convênio isoladamente.
    await db`CREATE TABLE IF NOT EXISTS vinculos (
      id SERIAL PRIMARY KEY,
      prestador_id INTEGER NOT NULL REFERENCES prestadores(id) ON DELETE CASCADE,
      convenio_id INTEGER NOT NULL REFERENCES convenios(id) ON DELETE CASCADE,
      login_portal TEXT,
      senha_cifrada TEXT,
      senha_iv TEXT,
      senha_auth_tag TEXT,
      particularidades TEXT,
      ativo BOOLEAN NOT NULL DEFAULT true,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(prestador_id, convenio_id)
    )`;

    // Quem fatura qual par prestador+convênio -- atribuição individual e
    // flexível, um funcionário responsável por vez em cada par.
    await db`CREATE TABLE IF NOT EXISTS atribuicoes (
      id SERIAL PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      prestador_id INTEGER NOT NULL REFERENCES prestadores(id) ON DELETE CASCADE,
      convenio_id INTEGER NOT NULL REFERENCES convenios(id) ON DELETE CASCADE,
      criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(prestador_id, convenio_id)
    )`;

    // Um lançamento por prestador+convênio+tipo+competência. Só existe
    // linha aqui quando alguém de fato lançou algo -- o "pendente" default
    // é calculado na hora (ver api/_faturamentos.js), sem precisar de um
    // job mensal pra pré-criar linhas.
    await db`CREATE TABLE IF NOT EXISTS faturamentos (
      id SERIAL PRIMARY KEY,
      convenio_id INTEGER NOT NULL REFERENCES convenios(id) ON DELETE CASCADE,
      prestador_id INTEGER NOT NULL REFERENCES prestadores(id) ON DELETE CASCADE,
      tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('SADT','CONSULTA','GIH')),
      competencia CHAR(7) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','faturado')),
      mes_completo BOOLEAN NOT NULL DEFAULT false,
      faturado_ate DATE,
      observacao TEXT,
      lancado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(convenio_id, prestador_id, tipo, competencia)
    )`;
    await db`CREATE INDEX IF NOT EXISTS idx_faturamentos_competencia ON faturamentos(competencia)`;
    await db`CREATE INDEX IF NOT EXISTS idx_faturamentos_status ON faturamentos(status)`;

    // Histórico completo de alterações de um lançamento (cada POST em
    // api/faturamentos.js grava uma linha aqui, nunca some).
    await db`CREATE TABLE IF NOT EXISTS faturamentos_historico (
      id SERIAL PRIMARY KEY,
      faturamento_id INTEGER NOT NULL REFERENCES faturamentos(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL,
      mes_completo BOOLEAN NOT NULL,
      faturado_ate DATE,
      observacao TEXT,
      alterado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await db`CREATE INDEX IF NOT EXISTS idx_faturamentos_historico_faturamento ON faturamentos_historico(faturamento_id)`;

    // Tarefas avulsas do administrador pro funcionário, com confirmação de
    // recebimento e de finalização em separado.
    await db`CREATE TABLE IF NOT EXISTS tarefas (
      id SERIAL PRIMARY KEY,
      descricao TEXT NOT NULL,
      prazo DATE,
      responsavel_usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      criado_por INTEGER NOT NULL REFERENCES usuarios(id),
      status VARCHAR(20) NOT NULL DEFAULT 'aguardando' CHECK (status IN ('aguardando','recebida','finalizada')),
      recebida_em TIMESTAMPTZ,
      finalizada_em TIMESTAMPTZ,
      observacao_final TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await db`CREATE INDEX IF NOT EXISTS idx_tarefas_responsavel_status ON tarefas(responsavel_usuario_id, status)`;
  })();
  schemaReady.catch(() => { schemaReady = null; });
  return schemaReady;
}

// Minúsculo, sem espaço nas pontas, espaços internos viram ponto (ex:
// "Maria Silva" -> "maria.silva").
function normalizarLogin(login){
  return String(login || '').trim().toLowerCase().replace(/\s+/g, '.');
}

function gerarSalt(){
  return crypto.randomBytes(16).toString('hex');
}

function hashSenha(senha, salt){
  return new Promise((resolve, reject) => {
    crypto.scrypt(senha, salt, 64, (err, derivedKey) => {
      if (err) reject(err); else resolve(derivedKey.toString('hex'));
    });
  });
}

async function verificarSenha(senha, salt, hashEsperado){
  const hash = await hashSenha(senha, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(hashEsperado, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function gerarToken(){
  return crypto.randomBytes(32).toString('hex');
}

async function criarSessao(usuarioId){
  const db = sql();
  const token = gerarToken();
  await db`INSERT INTO sessoes (token, usuario_id, expira_em) VALUES (${token}, ${usuarioId}, now() + interval '30 days')`;
  return token;
}

function permitirCors(req, res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS'){ res.status(204).end(); return true; }
  return false;
}

module.exports = {
  sql, ensureSchema, normalizarLogin, gerarSalt, hashSenha, verificarSenha,
  gerarToken, criarSessao, permitirCors
};
