# Checklist de Segurança — Gestão Pro (multi-loja)

Projeto Supabase de **produção**: o referenciado em `.env.local` (ref iniciado em `yfyck…`).
Marque cada item só depois de verificar no painel ou no banco. Nada aqui vale como "conforme" sem evidência.

## 1. Banco e RLS (produção `yfyck…`)
- [ ] Migrações `database/migrations/001`–`005` e as de licença aplicadas, nessa ordem.
- [ ] **Nunca reexecutar `MASTER_SCHEMA.sql` em produção**: ele recria políticas "qualquer logado vê tudo" e desfaz o isolamento por loja.
- [ ] Toda tabela de negócio com RLS ativo e política `store_isolation` baseada em `current_store_id()`.
- [ ] **Licença/teste grátis validados no banco**: `current_store_id()` só devolve a loja se a licença estiver válida (trial ou plano). Teste grátis = **3 horas** (`trial_ends_at` com hora/minuto). O front só mostra aviso; quem bloqueia é o RLS.
- [ ] Só `is_platform_admin` altera licença, validade e lojas (RPC ou Edge Function). Toda alteração fica em log de auditoria.
- [ ] Teste de isolamento executado com 2 lojas × papéis OWNER/MANAGER/SELLER e administrador (SELECT/INSERT/UPDATE/DELETE), incluindo UUID de outra loja enviado direto na API.

## 2. Administrador da plataforma
- [ ] **Único** `is_platform_admin = true`: `techflowia@gmail.com`. Conferir no SQL Editor:
  `select email from profiles where is_platform_admin;` — deve retornar uma linha.
- [ ] A migração 003 marcou como administrador todo usuário que era `ADMIN` no schema antigo; remover a flag de qualquer outra conta.
- [ ] **MFA (TOTP) obrigatório** na conta do administrador; senha única e forte; e-mail de recuperação protegido com MFA.
- [ ] A flag só muda pelo SQL Editor (trigger `protect_platform_admin_flag`). Nunca criar política que permita editar `profiles.is_platform_admin`.
- [ ] Nenhuma checagem de admin feita por e-mail no front-end; a decisão é sempre do banco.

## 3. Supabase Auth
- [ ] **Cadastro público desligado** (Authentication > Providers > Email > desativar "Allow new users to sign up"). Contas só nascem pela Edge Function `manage-users`.
- [ ] Política de senha do Auth: mínimo 10 caracteres, exigir letras e números; proteção contra senha vazada ativada (se disponível no plano).
- [ ] SMTP real configurado se houver recuperação de senha por e-mail.
- [ ] URL do site e redirecionamentos autorizados configurados; remover URLs de teste.

## 4. Edge Functions
- [ ] Segredos definidos (Edge Functions > Secrets), nunca no código ou no front:
  `ALLOWED_ORIGINS` (URL final do site, separadas por vírgula, **sem `*`**), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_WEBHOOK_SECRET`.
  Sem `ALLOWED_ORIGINS` só `localhost` é aceito, então produção quebra de propósito até configurar.
- [ ] `manage-users` e `send-push-notification` publicadas com **verificação de JWT ligada** (padrão). `--no-verify-jwt` só se o gatilho do banco precisar; nesse caso a função já exige `x-webhook-secret`.
- [ ] `manage-users`: dono/gerente só cria/atualiza **vendedores da própria loja**; não reaproveita contas de outras lojas; não troca senha de administrador nem de conta em mais de uma loja; senha mínima de 10 caracteres com letras e números, ou senha provisória gerada pelo servidor.
- [ ] `send-push-notification`: notifica só dono/gerente da loja da venda e o autor da venda; dados vêm do banco, não do corpo da requisição.
- [ ] Gatilho `tr_venda_finalizada_push` (migração 001) atualizado: URL do projeto `yfyck…` (o texto atual aponta para outro projeto) e cabeçalho `x-webhook-secret` lido do Vault; sem isso, o push automático pára de funcionar. Não duplicar o disparo com o front.
- [ ] Revisar logs das funções por erros 401/403 repetidos.

## 5. Variáveis de ambiente (hospedagem)
- [ ] Front recebe só `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` e `VITE_VAPID_PUBLIC_KEY`.
- [ ] `service_role`, `VAPID_PRIVATE_KEY` e `PUSH_WEBHOOK_SECRET` **nunca** no front nem no repositório.
- [ ] `.env.local` fora do git (já verificado: não rastreado e sem histórico). Se uma chave sensível já foi exposta em chat, e-mail ou commit, rotacionar.

> [!WARNING]
> Nunca use a `service_role` no frontend: daria acesso total ao banco para qualquer pessoa.

## 6. Storage
- [ ] Bucket `products`: caminhos por loja (`<store_id>/...`) e políticas de escrita/remoção comparando a pasta com `current_store_id()`; hoje qualquer usuário logado altera arquivos de qualquer loja.
- [ ] Decidir se o bucket continua público (imagens de produto) ou passa a URL assinada.

## 7. Dependências e front
- [ ] `xlsx` 0.18.5 (alta) trocado pela versão corrigida do SheetJS (≥ 0.20.2, distribuída pelo CDN oficial) e `ws` atualizado; `npm audit --omit=dev` sem severidade alta.
- [ ] Importação de planilha com limite de tamanho e verificação de extensão.
- [ ] Dados do `localStorage` (`COM_STILLO_DB_V1`) limpos no logout e na troca de loja.
- [ ] HTTPS obrigatório; cabeçalhos de segurança (CSP, X-Content-Type-Options, frame-ancestors) configurados na hospedagem.

## 8. LGPD e operação
- [ ] Política de privacidade e termos de uso publicados; contrato (DPA) com cada loja: a loja é controladora, a plataforma é operadora.
- [ ] Rotina para exportar e anonimizar/excluir dados de um titular (clientes, entregas).
- [ ] Backup/PITR ativo no Supabase e restauração testada.
- [ ] Plano de resposta a incidentes (contato, prazo de comunicação à ANPD e aos titulares).

## 9. Testes antes de vender
- [ ] Testes de RLS (2 lojas × 3 papéis), licença expirada/trial de 3 h, `manage-users` (casos negados) e push entre lojas, rodando em CI.
