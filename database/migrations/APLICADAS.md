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
| 018 | NÃO aplicada | Painel admin. Ajustada para usar o log da 009 (`admin_audit_logs` e `admin_log_audit`). Testada em ROLLBACK (plano, pagamento e conversão gravam no log; dono bloqueado). Aguarda aprovação |
| 019 | aplicada | Políticas de escrita do bucket `products` por loja |
| 020 | NÃO aplicada | Edição transacional de venda. Aguarda aprovação do SecOps |
| 021 | aplicada | Auditoria obrigatória das ações do admin (status, extensão, criação de loja) na mesma transação; log com retenção de 5 anos (gatilhos de DELETE e TRUNCATE); `admin_log_audit` sem acesso para anon. Testada em ROLLBACK |
