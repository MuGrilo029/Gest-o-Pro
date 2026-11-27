# Riscos de segurança — Gestão Pro (lançamento)

Registro da Segurança (Fase 5). **Não muda nenhuma decisão do dono** (`docs/decisoes-do-dono.md` manda). Cada risco diz o que pode dar errado, o impacto e a recomendação; implementar só com confirmação do dono.
Conferência em produção feita só por leitura em 27/11/2026 (projeto `yfyckreoprwfwhjadfkl`).

## Riscos aceitos pelo dono

| Nº | Risco | Decisão | Impacto | Recomendação |
|---|---|---|---|---|
| R1 | Senha mínima de 8 caracteres sem exigir números | 42 | Senhas fracas caem em ataque de dicionário/credential stuffing. | Ligar **Leaked Password Protection** no Auth (hoje desligada — advisor do Supabase) e manter o rate limit do Auth. Não muda a regra de 8 caracteres. |
| R2 | Senha provisória `12345678` para usuários criados pelo admin | 40 | Senha conhecida por todos: quem souber o e-mail entra até o usuário trocar. É a 1ª senha testada em qualquer ataque. | **Troca obrigatória no primeiro acesso** (flag no perfil + tela de troca antes de liberar o app). Não implementada: depende de confirmação do dono. |
| R3 | Impersonação sem log e sem limite de tempo (só o dono do SaaS) | 36 | Sem rastro do que foi visto/alterado na loja em nome do lojista; sessão esquecida aberta segue ativa. | **Risco aceito pelo dono; nenhuma ação no lançamento.** Mitigação existente: o servidor só deixa `is_platform_admin` trocar para loja alheia (`set_active_store` → `is_store_member`; `current_store_id` revalida). |
| R4 | Exportação e anonimização LGPD fora do lançamento | 48 | Pedido de titular (art. 18) atendido manualmente, com risco de prazo e erro. | Procedimento manual documentado (quem atende, em quantos dias, SQL revisado) até a funcionalidade existir. |
| R5 | Chave publicável antiga do Supabase no histórico do git (migração 001, commit `8fc5128`) | — | Chave publicável não dá acesso além do RLS, mas fica pública para sempre no histórico. | **Rotacionar** a chave publicável no painel e atualizar `VITE_SUPABASE_ANON_KEY` na Vercel. O gitleaks ignora só esse achado (`.gitleaksignore`). |

## Achados novos desta conferência

| Nº | Achado | Impacto | Recomendação | Resp. |
|---|---|---|---|---|
| A1 | O MCP chamado **`supabase-dev` aponta para produção** (tem as lojas COM STILLO e Royal Home). A decisão T5 o trata como banco de teste. | Teste ou migração "no banco de teste" cairia em produção. | Não usar esse MCP para escrita. Criar um projeto de teste separado (ou só PGlite/local) antes do E2E. | SD, B |
| A2 | Slugs reais não batem com a decisão 54: COM STILLO = `loja-principal`; Royal Home = `NULL`. | Guarda por slug (`com-stillo-moveis`, `royal-home`) não protege nada. | Guardar pelos ids: `450f3fcf-1d95-4308-8578-967ebb62d89e` e `5f60b2db-9111-4eda-ad29-d205fdaff308`. | B |
| A3 | Storage `products`: leitura pública para todos; `INSERT` aceita arquivo fora de qualquer pasta de loja; `UPDATE` com `WITH CHECK` só por bucket (permite mover objeto para a pasta de outra loja). | Fere a 46a (cada loja vê só as suas imagens). | Migração 048+: pasta `(storage.foldername(name))[1] = current_store_id()::text` em SELECT/INSERT/UPDATE/DELETE. Bucket público × link temporário segue bloqueado pelo dono (46b). | B |
| A4 | Leaked Password Protection desligada no Auth. | Agrava R1. | Ligar no painel (Auth → Passwords). | Painel |
| A5 | `search_path` mutável em `store_effective_status` e `update_push_subscriptions_updated_at`. | Baixo; risco de sequestro de função se alguém criar objetos em schema do path. | `SET search_path = public` numa migração. | B |
| A6 | Edge Function `billing-webhook` não está publicada (só `manage-users` v4 e `send-push-notification` v5). | Coerente com cobrança adiada. | Nada a fazer até a cobrança voltar. | — |
| A7 | `send-push-notification` tem `verify_jwt = false`. | A função valida sozinha: JWT do usuário ou `x-webhook-secret` (comparação em tempo constante). | Manter; o pen-test cobre chamada sem credencial. | — |
| A9 | Tabelas de operação (`products`, `customers`, `suppliers`, `orders`, `deliveries`, `production_orders`, `stock_movements`, `categories`, `card_fees`) só com `store_isolation` FOR ALL: o vendedor exclui e edita tudo pela API; o bloqueio é só visual. | Vendedor mal-intencionado apaga cadastro/estoque da loja. | Migração nova por papel: DELETE (e escrita em configurações como `card_fees`) só dono/gerente, reproduzindo o front de hoje. Teste no PGlite. | B, revisão S |
| A10 | Migração 028 (vendedor só insere receita da própria venda) **não aplicada**: `transactions_insert` aceita qualquer lançamento do vendedor. | Vendedor cria despesa/receita falsa no financeiro. | Testar a 028 no PGlite e listar para aprovação. Pendência: taxa de cartão (EXPENSE) gravada pelo vendedor. | B |
| A11 | Bucket `producao-anexos`: políticas só checam a pasta da loja; vendedor lê, envia e **exclui** anexos. | Perda de anexos de produção. | DELETE só dono/gerente na mesma migração da A9. | B |
| A8 | Política `Admins can update profiles` (`is_admin()` = `is_platform_admin()`). | Ok com uma única conta admin. | Manter só o dono com o flag (conferido: 1 conta). | — |

| A12 | CSP: além de Supabase, Vercel e o próprio domínio (T4), precisa de Google Fonts (`index.css`, `pages/Quotes.tsx`) e `quickchart.io` (QR em `pages/Deliveries.tsx`, que também envia o link de avaliação a esse serviço). | Sem eles, fontes e QR quebram. | Mantidos na CSP; para ficar só com Supabase/domínio, o Frontend auto-hospeda as fontes e gera o QR localmente. Decisão do SeniorDev. | SD, F |

## Conferido e ok (27/11/2026, leitura)
- RLS ligado em **todas** as tabelas de `public` (nenhuma sem RLS).
- `profiles`: leitura própria, do admin ou de colegas da mesma loja; sem UPDATE pelo próprio usuário; gatilho `protect_platform_admin_flag` impede promover-se a admin.
- Exatamente **1** conta com `is_platform_admin`.
- Todas as RPCs `admin_*` e `apply_plan_modules` checam `is_platform_admin`/`_require_platform_admin`; nenhuma executável por `anon`; `process_billing_event` sem EXECUTE para `authenticated`.
- `edit_sale_items` exige dono/gerente (`is_store_manager`) e a mesma loja.
- Painel admin e impersonação só para `is_platform_admin`: interface (`PLATFORM_ADMIN_VIEWS`, teste `tests/platformAdminAccess.test.ts`) e servidor (`set_active_store` → `is_store_member`; `current_store_id` revalida membro ou admin). Não existe papel de suporte.
- Realtime: nenhuma tabela de negócio publicada (só `messages_*` internas do Realtime).
- Vault: só o segredo `push_webhook_secret` (valor não lido).
- Bundle do build sem `service_role`, chave privada VAPID, `sb_secret_`, JWT ou tokens; `.env` fora do git (`.gitignore` atualizado); gitleaks sem achados novos no histórico.

## Depende do painel Supabase/Vercel (não verificável por SQL; conferir manualmente, sem alterar sem aprovação)
1. **PITR** ligado e janela de retenção (Database → Backups) — decisão 51.
2. **Segredos das Edge Functions** (Edge Functions → Secrets): existem `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_WEBHOOK_SECRET`, `ALLOWED_ORIGINS` (sem `*`) — só os nomes. No Vault há apenas `push_webhook_secret`.
3. **Auth → Passwords**: mínimo 8, sem regra de número (decisão 42) e ligar Leaked Password Protection (A4).
4. **Auth → Rate limits** e confirmação de e-mail; URLs de redirecionamento só do domínio do app (domínio definitivo pendente).
5. **Rotacionar a chave publicável** (R5) e atualizar `VITE_SUPABASE_ANON_KEY` na Vercel.
6. **Realtime → Settings**: canais privados/autorização (sem tabelas de negócio publicadas hoje).
7. **Vercel**: variáveis de produção só com `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`; conferir a CSP no console do preview; trocar o domínio na CSP/`ALLOWED_ORIGINS` quando o domínio definitivo existir.
8. **GitHub**: Actions ligado e branch protection exigindo o job `CI` (após o push aprovado).

## Pendências desta entrega (27/11/2026)
- **Estagiario1:** revisou `45045f5`; ajustes aplicados em `d2cdde3` (CSP, checksum do gitleaks, R3, A12, pen-test 4.2) e o teste de impersonação no commit seguinte. Falta a revisão desses dois commits.
- **Harness de RLS no PGlite (Backend):** ainda não entregue; pedido com os casos exigidos (isolamento A×B, DELETE do vendedor nas 9 tabelas e em `producao-anexos`, `admin_*` e `set_active_store` para não-admin, Storage `products` por pasta).
- **Migrações 048+ (Backend):** ainda não existem na branch do Backend; revisão de isolamento, papéis, Storage `products` e sessões pendente. Nenhuma migração aplicada.
- **Baixo (anotado):** a interface restaura `impersonatedStore` do `sessionStorage` sem checar o admin; só muda o aviso na tela, pois os dados passam pelo RLS (pen-test 2.7).
