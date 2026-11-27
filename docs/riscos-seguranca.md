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
| A1 | O MCP `supabase-dev` (`yfyckreoprwfwhjadfkl`) tem COM STILLO e Royal Home. | — | **Encerrado:** decisão 54 revogada pelo dono (27/11). O projeto é de teste (`gestao-pro-teste`), inclusive essas lojas. | — |
| A2 | Slugs reais não batiam com a decisão 54. | — | **Encerrado:** decisão 54 revogada; as guardas por loja foram retiradas na 052 (Backend). | — |
| A3 | Storage `products`: leitura pública para todos; `INSERT` aceita arquivo fora de qualquer pasta de loja; `UPDATE` com `WITH CHECK` só por bucket (permite mover objeto para a pasta de outra loja). | Fere a 46a (cada loja vê só as suas imagens). | Migração 048+: pasta `(storage.foldername(name))[1] = current_store_id()::text` em SELECT/INSERT/UPDATE/DELETE. Bucket público × link temporário segue bloqueado pelo dono (46b). | B — **coberto em `6873a0b` (Backend), testado no PGlite, revisado por S; não aplicado** |
| A4 | Leaked Password Protection desligada no Auth. | Agrava R1. | Ligar no painel (Auth → Passwords). | Painel |
| A5 | `search_path` mutável em `store_effective_status` e `update_push_subscriptions_updated_at`. | Baixo; risco de sequestro de função se alguém criar objetos em schema do path. | `SET search_path = public` numa migração. | B — **coberto em `6873a0b` (Backend), testado no PGlite, revisado por S; não aplicado** |
| A6 | Edge Function `billing-webhook` não está publicada (só `manage-users` v4 e `send-push-notification` v5). | Coerente com cobrança adiada. | Nada a fazer até a cobrança voltar. | — |
| A7 | `send-push-notification` tem `verify_jwt = false`. | A função valida sozinha: JWT do usuário ou `x-webhook-secret` (comparação em tempo constante). | Manter; o pen-test cobre chamada sem credencial. | — |
| A9 | Tabelas de operação (`products`, `customers`, `suppliers`, `orders`, `deliveries`, `production_orders`, `stock_movements`, `categories`, `card_fees`) só com `store_isolation` FOR ALL: o vendedor exclui e edita tudo pela API; o bloqueio é só visual. | Vendedor mal-intencionado apaga cadastro/estoque da loja. | Migração nova por papel: DELETE (e escrita em configurações como `card_fees`) só dono/gerente, reproduzindo o front de hoje. Teste no PGlite. | B, revisão S — **coberto em `6873a0b` (Backend), testado no PGlite, revisado por S; não aplicado** |
| A10 | Migração 028 (vendedor só insere receita da própria venda) **não aplicada**: `transactions_insert` aceita qualquer lançamento do vendedor. | Vendedor cria despesa/receita falsa no financeiro. | Testar a 028 no PGlite e listar para aprovação. Pendência: taxa de cartão (EXPENSE) gravada pelo vendedor. | B — **057 em `6873a0b`; ver A13** |
| A11 | Bucket `producao-anexos`: políticas só checam a pasta da loja; vendedor lê, envia e **exclui** anexos. | Perda de anexos de produção. | DELETE só dono/gerente na mesma migração da A9. | B — **coberto em `6873a0b` (Backend), testado no PGlite, revisado por S; não aplicado** |
| A13 | 057 (antiga 028): na **própria venda**, o vendedor insere quantas receitas `INCOME 'Vendas'` quiser, de qualquer valor, e taxas de cartão repetidas (confirmado no PGlite: 3 × 999.999 aceitas numa venda de 100). Venda de outro vendedor é recusada. | Receita/despesa falsas e comissão futura inflada. | Limitar a soma de receitas ao `sales.total` e 1 taxa por venda, ou tirar o INSERT direto do vendedor quando o front usar `create_sale` (055). | B — **fechado:** a correção na 057 (`8f0e5d3`) foi reprovada (bulk insert e `UPDATE` de `sales.total` passavam). A 059 (`9c53568`) põe venda, itens e lançamentos do vendedor só pelo `create_sale`, com trigger nos valores da venda. A 060/061/062 (`d45293c`, `4decc2b`, `d07cfd3`) recalculam os valores no servidor, recusam NaN/Infinity e limitam a taxa. Revisado por S; não aplicado. **Requer o front com `create_sale`.** |
| A14 | `delete_sale` (063) e o `deleteSale` atual não apagam os anexos de OS no bucket `producao-anexos`. | Baixo: arquivos de clientes ficam retidos depois da exclusão da venda (LGPD, minimização/retenção). | Depois do lançamento: apagar os anexos pela Storage API (Edge Function ou cliente) ao excluir a OS, ou criar uma rotina de limpeza de órfãos. | B, pós-lançamento |
| A8 | Política `Admins can update profiles` (`is_admin()` = `is_platform_admin()`). | Ok com uma única conta admin. | Manter só o dono com o flag (conferido: 1 conta). | — |

| A12 | CSP dependia de Google Fonts e `quickchart.io` (o QR enviava o link de avaliação a terceiros). | — | **Resolvido:** o Frontend passou a usar fontes locais (`@fontsource`) e QR gerado no navegador (`qrcode`, data: URL) no commit `b371fbd` (`feat/frontend-lancamento`); a CSP ficou só com self, `*.supabase.co` e `vercel.live`. | F, S |

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
- **Estagiario1:** aprovou `45045f5`, `d2cdde3`, `4879203` e `374173f` (ressalva baixa do instante antes do perfil carregar resolvida no commit seguinte).
- **Harness de RLS no PGlite (Backend):** entregue em `620c7c8`; 142/142 e replay duplo ok no worktree do Backend.
- **Migrações 048–063 (Backend, `feat/backend-lancamento` até `4a9b384`):** todas revisadas e aprovadas (a 057 foi substituída pela 059–062; a 063 é o `delete_sale`, com DELETE direto em `sales` revogado). Vitest 162/162 e replay duplo ok. Nenhuma aplicada fora do PGlite. A 059–063 só entram junto com o front usando `create_sale` e `delete_sale`.
- **Resolvido:** a impersonação restaurada do `sessionStorage` é descartada quando o perfil não é `is_platform_admin`, e o contexto só expõe `impersonatedStore` ao admin (nem por um instante antes do perfil carregar). Testes em `tests/platformAdminAccess.test.ts`.
- **Baixo (aceito):** a imagem unsplash existe só nos dados de exemplo (`MOCK_DATA` em `store.tsx`); a CSP a bloqueia e o efeito é só uma imagem quebrada nesses exemplos.
- **A12 resolvido:** CSP enxuta. Ela depende de `b371fbd` (Frontend): se esta branch entrar antes dela, as fontes do Google ficam bloqueadas. Integrar as duas juntas.
