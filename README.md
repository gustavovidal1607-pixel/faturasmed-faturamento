# Faturas Med - Faturamento

Controle de faturamento por prestador/convênio: substitui a planilha de fechamento, registrando quem já faturou (e o quê) em cada competência, por tipo (SADT, CONSULTA, GIH). Separado do painel de contas a receber (`faturas-med-gestao`) -- este aqui cobre a etapa anterior, de fato faturar.

## Antes de rodar

1. **Banco de dados**: criar um projeto novo em [neon.tech](https://neon.tech) e copiar a connection string.
2. **Chave de cifra dos vínculos**: gerar 32 bytes aleatórios em hex:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
3. Copiar `.env.example` para `.env` e preencher `DATABASE_URL` e `VINCULOS_CIFRA_KEY`. Na Vercel, cadastrar as mesmas variáveis em Project Settings → Environment Variables.
4. Abrir `api/_auth.js` e conferir `ADMIN_BOOTSTRAP_LOGIN` -- é o único login que consegue criar a primeira conta (de administrador) no primeiro acesso. Depois disso, o resto da equipe ganha login/senha criados pelo administrador na aba **Usuários**.

## Rodando localmente

```
npm install
npx vercel dev
```

Acesse a URL local e faça login com o `ADMIN_BOOTSTRAP_LOGIN` configurado (a senha é definida nesse primeiro login) -- isso cria a conta de administrador.

## Deploy

```
npx vercel --prod
```

com as variáveis de ambiente já configuradas no projeto da Vercel.

## Modelo

- **Convênios**: nome, tipos de faturamento que aceita (SADT/CONSULTA/GIH), prazo de fechamento (dia do mês).
- **Prestadores**: nome, especialidade.
- **Vínculos** (prestador + convênio): login/senha do portal daquele convênio (senha cifrada, AES-256-GCM) e particularidades de como faturar essa combinação específica.
- **Atribuições**: qual funcionário é responsável por faturar qual par prestador+convênio.
- **Faturamentos**: um lançamento por prestador+convênio+tipo+competência, com status (pendente/faturado), se foi o mês inteiro ou até que data, e histórico completo de alterações.
- **Tarefas**: designadas pelo administrador, com confirmação de recebimento e de finalização em separado.
- **Painel** (administrador): convênios com prazo de fechamento próximo e prestadores ainda sem lançamento "faturado" na competência atual.

## Estrutura

- `api/` -- funções serverless (Vercel). Arquivos com `_` na frente são módulos internos, não roteados.
- `index.html`, `css/`, `js/` -- frontend em HTML/JS puro, sem build step.
