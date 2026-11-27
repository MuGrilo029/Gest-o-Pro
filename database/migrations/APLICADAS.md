# Histórico de migrações aplicadas — projeto yfyckreoprwfwhjadfkl

A tabela de histórico do Supabase (`supabase_migrations.schema_migrations`) não existe neste projeto, por isso o registro fica aqui. Atualize esta lista a cada migração aplicada.

| Migração | Estado | Observação |
|---|---|---|
| 001 | NÃO aplicada | Contém `DROP TABLE ... CASCADE`; substituída pela 007 |
| 002 | não verificado | — |
| 003, 004, 005 | aplicadas (antes desta sessão) | Verificadas no início do trabalho |
| 006 | aplicada | Assinaturas e clientes |
| 007 | aplicada | Push: tabela `push_subscriptions` e gatilho |
| 008 | aplicada | RPC `set_store_brand` |
| 009 | aplicada (encontrada no banco; não foi aplicada por esta sessão) | Tabelas `subscriptions`, `invoices`, `admin_audit_logs`; funções `admin_log_audit` e `admin_get_saas_metrics`; backfill gravou 2 assinaturas a R$ 199 (`starter`) |
| 009b | aplicada | Segurança da 009: log de auditoria sem UPDATE e DELETE (também REVOKE); cobrança só para dono e gerente; texto de `admin_get_saas_metrics` corrigido. Testada em ROLLBACK (admin, dono, gerente, vendedor, anon) e revisada pelo SecOps |
| 009c | aplicada | Corrige as 2 assinaturas antigas (starter, R$ 199, lojas sem plano) para custom, R$ 0. Conferência antes (2) e depois (2) |
| 010 | aplicada | Campos de orçamento e produção |
| 011 | aplicada | Bucket privado `producao-anexos` |
| 012 | aplicada | Teste grátis (colunas e tabela de limite) |
| 013 | aplicada | Endurecimento do cadastro |
| 014 | aplicada | Função de purga (padrão: simulação) |
| 015 | aplicada (reaplicada em UTF-8) | Proteção básica do teste grátis |
| 016 | aplicada (reaplicada em UTF-8) | Purga ao fim do teste |
| 017 | aplicada | Revoga EXECUTE de anon nas funções definer |
| 018 | aplicada (verificada em 26/11: `admin_set_plan` existe no banco) | Painel admin. Usa o log da 009 (`admin_audit_logs` e `admin_log_audit`). Testada em ROLLBACK antes de aplicar |
| 019 | aplicada (verificada em 26/11: políticas `products_insert_loja`, `products_update_loja`, `products_delete_loja` existem) | Políticas de escrita do bucket `products` por loja |
| 020 | aplicada (26/11/2026, após teste em ROLLBACK 12/12 e liberação do SecOps; verificada: `edit_sale_items(uuid, jsonb, numeric, numeric)`, SECURITY DEFINER, EXECUTE só para `authenticated`) | Edição transacional de venda: ajuste de estoque pela diferença (SALE/RETURN), encomenda e serviço fora do ajuste, total e desconto na mesma transação, auditoria AD-01 para admin da plataforma. Saída em `Shared/gestao-pro-revisao/sql/rollback-020-resultado.md` |
| 021 | aplicada | Auditoria obrigatória das ações do admin (status, extensão, criação de loja) na mesma transação; log com retenção de 5 anos (gatilhos de DELETE e TRUNCATE); `admin_log_audit` sem acesso para anon. Testada em ROLLBACK |
| 022 | aplicada (26/11/2026, após teste em ROLLBACK 4/4 e revisão do SecOps; verificada: `admin_create_client` e `admin_set_status` com padrão de 1 h, `start_self_trial` inalterada, EXECUTE só para `authenticated`) | Teste grátis de 1 hora como padrão do Admin (`admin_create_client` e `admin_set_status`). Corpos gerados da definição de produção; diff em `Shared/gestao-pro-revisao/sql/022-diff.md`. Saída do teste em `Shared/gestao-pro-revisao/sql/rollback-022-resultado.md` |
| 031 | aplicada (26/11/2026, após teste em ROLLBACK 4/4 e liberação do SecOps; verificada: `choose_trial_plan` presente, `admin_set_store_plan` removida) | Marca no Avançado e escolha do plano de trial pelo dono (só loja em trial). Fonte: `Shared/gestao-pro-revisao/sql/031-*.sql` |
| 032 | aplicada (26/11/2026, teste em ROLLBACK 8/8) | Estender e encerrar loja; encerrar loja com assinatura só com o cancelamento no Asaas habilitado (flag começa desligada); cancelamento confirmado pelo servidor. Fonte: `Shared/gestao-pro-revisao/sql/032-*.sql` |
| 034 | aplicada (26/11/2026, teste em ROLLBACK 8/8) | Listagem de lojas com filtros e cursor composto, e ficha da loja (só leitura; ficha grava auditoria). Fonte: `Shared/gestao-pro-revisao/sql/034-*.sql` |
| 035 | aplicada (26/11/2026, teste em ROLLBACK 7/7) | Catálogo de módulos e `billing_mode` em `stores`. Core: nenhuma chave (settings não é core, decisão do usuário). Fonte: `Shared/gestao-pro-revisao/sql/035-*.sql` |
| 036 | aplicada (26/11/2026, teste em ROLLBACK 9/9) | Overrides de módulo por loja, leitura com validade (`store_module_enabled`), job de expiração de overrides. Fonte: `Shared/gestao-pro-revisao/sql/036-*.sql` |
| 037 | aplicada (26/11/2026, teste em ROLLBACK 10/10) | Troca de plano: upgrade pendente até o pagamento da diferença, downgrade bloqueado por vendedores e agendado, valor do upgrade confirmado pelo gateway. Fonte: `Shared/gestao-pro-revisao/sql/037-*.sql` |
| 038 | aplicada (26/11/2026, teste em ROLLBACK 6/6) | Pagamento manual só para contrato fora do Asaas: registra, não ativa, recalcula módulos. Lojas que já pagaram seguem como estão. Fonte: `Shared/gestao-pro-revisao/sql/038-*.sql` |
| 040 | aplicada (26/11/2026, teste em ROLLBACK 8/8; 3 jobs ativos após o apply) | Agendamento pg_cron: carência (06:00 UTC), overrides e downgrades (de hora em hora). Requer 045. Fonte: `Shared/gestao-pro-revisao/sql/040-*.sql` |
| 042 | aplicada (26/11/2026, teste em ROLLBACK 5/5 reportado pelo Tonny) | Guarda de loja encerrada/cancelada dentro de `process_billing_event` (wrapper sobre a função da 024). Fonte: `Shared/gestao-pro-revisao/sql/042-*.sql` |
| 043 | aplicada (26/11/2026, teste em ROLLBACK 3/3: anon e authenticated sem EXECUTE; trigger ativo) | Higiene: sem EXECUTE de anon/authenticated/PUBLIC em `enforce_seller_limit` (trigger segue ligado). Fonte: `Shared/gestao-pro-revisao/sql/043-*.sql` |
| 044 | aplicada (26/11/2026, teste em ROLLBACK 10/10) | Mapa de módulos por plano (inicio 5, crescimento 9, avancado 13) e plano `custom` (R$ 99, 3 vendedores, anual R$ 990, módulos do crescimento). Fonte: `Shared/gestao-pro-revisao/sql/044-*.sql` |
| 045 | aplicada (26/11/2026, teste em ROLLBACK 3/3) | Auditoria pelo servidor (`_audit_server`) para o job de downgrade; `admin_log_audit` inalterado. Fonte: `Shared/gestao-pro-revisao/sql/045-*.sql` |
| 041 | NÃO aplicada (teste do webhook em banco, Back-end; ver mensagem) | Teste ROLLBACK ainda não rodado; não é migração de produção |
| 046 | aplicada (26/11/2026, teste em ROLLBACK 8/8; verificada: dashboard e sales com core = true; plano trial com 13 módulos do Avançado) | Módulos essenciais (core): Dashboard e Vendas/PDV, não desligáveis. Plano `trial` = módulos do Avançado; loja em trial vigente sem assinatura lê o Avançado (`store_effective_status` = 'trial'). Fonte: `Shared/gestao-pro-revisao/sql/046-*.sql` |
| 047 | aplicada (26/11/2026, teste em ROLLBACK 5/5; verificada: `store_brand_color` presente, sem EXECUTE para anon) | Getter da cor da marca (`store_brand_color(loja)`): devolve a cor só com o módulo brand habilitado; admin ou membro da loja. Fonte: `Shared/gestao-pro-revisao/sql/047-*.sql` |

## Conferência de 27/11/2026 (Backend, só leitura em produção)

Método: o banco local (PGlite) foi montado com `MASTER_SCHEMA.sql.example` + as migrações desta pasta, e comparado com produção por hash do corpo de cada função de `public` (`md5` de `prosrc`, sem `\r`), pelas políticas de RLS (`public` e `storage`) e pelas colunas. Resultado: igual a produção até a 047, com as exceções abaixo. Os arquivos 022–047 aplicados foram copiados de `Shared/gestao-pro-revisao/sql/*-apply.sql` para esta pasta (nomes `0NN_descricao.sql`). Script: `node tests/db/replay.mjs --hashes`.

| Migração | Estado em produção | Evidência |
|---|---|---|
| 023 (sync_sale_financial) | NÃO aplicada | função `sync_sale_financial` não existe; arquivo só em `Shared/gestao-pro-revisao/sql` |
| 024 (cobrança) | aplicada | `plans`, `plan_modules`, `billing_events`, `process_billing_event` com hash igual |
| 025 | não existe arquivo | — |
| 026 (CPF na venda) | NÃO aplicada | coluna `sales.customer_cpf` não existe |
| 027 (backfill de sale_id) | NÃO aplicada | 0 de 31 lançamentos com `sale_id` |
| 028 (lançamento por papel) | NÃO aplicada | `transactions_insert` só checa a loja. Substituída pela **057** |
| 029 (trial 1 h fixo) | NÃO aplicada | `admin_create_client` e `admin_set_status` com o corpo da 022. Arquivo em `pendentes/` (duração do trial bloqueada pelo dono) |
| 030, 033 | substituídas pela 038 | `admin_register_payment` com o corpo da 038 |
| 039 (correção expire_billing_grace) | aplicada | hash igual |
| 041 | não é migração | teste do webhook |
| objetos sem migração | existem | `card_fees`, `simulations` (registradas na **047b**, sem efeito em produção) e `rls_auto_enable` (gatilho do painel) |
| `supabase_migrations` | não existe | — |
| pg_cron | 3 jobs | `expire-billing-grace`, `expire-module-overrides`, `apply-pending-plan-changes` |

### A aplicar (escritas e testadas só no PGlite; nenhuma aplicada)

047b, 048, 049, 050, 051, 052, 053, 054, 055, 056, 057, 058, 059, 060, 061, 062, 063 — nesta ordem. A 060 só redefine create_sale e cria _is_finite/_is_card_method/_is_debit_method (nenhuma tabela alterada). A 061 adiciona CHECK NOT VALID de finitude em sales, sale_items e transactions (sem mexer em dados). A 062 adiciona CHECK NOT VALID de 0 a 100 em card_fees.percentage. A 063 cria delete_sale e tira o DELETE direto de sales (policy sales_delete e privilégio); só junto com o front usando delete_sale. A 059 (tabelas: transactions, sales, sale_items; apaga _seller_sale_tx_ok) só junto com o front usando create_sale no addSale; sem isso, o vendedor não consegue vender. Ver a lista com as tabelas alteradas no relatório do Backend ao SeniorDev.

### Pendente de aprovação

- **064** (limite de desconto do vendedor, D4): escrita e testada só no PGlite, não aplicada. Altera `stores` (coluna `seller_max_discount_percent` com padrão 10, CHECK e gatilho), cria `set_seller_discount_limit` e redefine `create_sale`. Venda de vendedor com desconto acima de 10% passa a ser recusada assim que for aplicada.

## Aplicação de 27/11/2026 (SeniorDev, com aprovação do dono via Tonny Stark)

- **Snapshot antes:** schema `snapshot_20261127` no próprio banco (36 tabelas de `public` copiadas, mais `_policies` 57, `_functions` 68, `_grants`, `_triggers` e `_storage_objects_meta`), sem acesso para anon e authenticated. Cópia local em JSON fora do repositório.
- **Lote 1** (compatível com o front antigo): 047b, 048, 049, 050, 051, 052, 053, 054, 055, 056, 057, 058, 062 — todas sem erro, nesta ordem.
- **Deploy:** branch `preparacao-lancamento` (cdae04f) publicada em produção na Vercel (`gest-o-pro-three.vercel.app`), a partir da branch, sem mudar a `main`.
- **Lote 2** (só com o front novo): 059, 060, 061, 063 — sem erro, aplicadas logo antes da publicação.
- **Verificação:** planos 1/3/6 e anual = 10×; `custom` inativo; core = dashboard, sales, customers, inventory, settings; `delete_sale` existe e `_seller_sale_tx_ok` não; `sales` sem policy nem GRANT de DELETE para authenticated; trigger `tg_sales_seller_guard`; CHECKs de finitude e de `card_fees`; anon sem EXECUTE em `create_sale` e `delete_sale`. Teste em transação desfeita, como vendedor real: INSERT direto em `sales` e em `transactions`, DELETE direto em `sales` e `delete_sale` foram recusados.
- **Não aplicadas:** 023, 026, 027 e 029 (pendentes ou substituídas, ver acima). `purge_unconverted_trial` (052) existe, mas não está agendada nem foi executada.

## Aplicação da 064 (27/11/2026, SeniorDev, com aprovação do dono via Tonny Stark)

- **Snapshot antes:** schema `snapshot_20261127_064` (`stores`, `sales`, `_functions`, `_grants`, `_policies`), sem acesso para anon e authenticated; cópia local em JSON fora do repositório.
- **064_limite_desconto_vendedor** aplicada sem erro, antes da publicação do front. Coluna `stores.seller_max_discount_percent` (NOT NULL, padrão 10; as 6 lojas ficaram com 10); anon sem EXECUTE em `create_sale` e `set_seller_discount_limit`.
- **Teste em transação desfeita, como vendedor real** (com a loja ativa marcada só dentro da transação): desconto de 20 e de 10,02 sobre 100 recusado; 10 e 5 aceitos; mudar o limite por RPC recusado; UPDATE direto alterou 0 linhas. Nada gravado.
