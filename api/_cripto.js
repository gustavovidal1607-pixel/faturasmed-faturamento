const crypto = require('crypto');

// AES-256-GCM com chave só em variável de ambiente (nunca no banco) --
// usado pra senha de portal de convênio guardada em Vínculos, que precisa
// ser recuperável (cifra reversível, não hash).
function chave(){
  const hex = process.env.VINCULOS_CIFRA_KEY;
  if (!hex || hex.length !== 64){
    throw new Error('VINCULOS_CIFRA_KEY ausente ou inválida (precisa de 32 bytes em hex = 64 caracteres).');
  }
  return Buffer.from(hex, 'hex');
}

function cifrar(texto){
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', chave(), iv);
  const cifrado = Buffer.concat([cipher.update(String(texto), 'utf8'), cipher.final()]);
  return {
    senha_cifrada: cifrado.toString('base64'),
    senha_iv: iv.toString('base64'),
    senha_auth_tag: cipher.getAuthTag().toString('base64'),
  };
}

function decifrar({ senha_cifrada, senha_iv, senha_auth_tag }){
  if (!senha_cifrada) return null;
  const decipher = crypto.createDecipheriv('aes-256-gcm', chave(), Buffer.from(senha_iv, 'base64'));
  decipher.setAuthTag(Buffer.from(senha_auth_tag, 'base64'));
  const decifrado = Buffer.concat([decipher.update(Buffer.from(senha_cifrada, 'base64')), decipher.final()]);
  return decifrado.toString('utf8');
}

module.exports = { cifrar, decifrar };
