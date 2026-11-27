# Decisões do dono — Gestão Pro

Fonte: respostas do dono (27/11/2026), repassadas por Tonny Stark. Vale a resposta mais recente.
Branch de integração: `preparacao-lancamento`. Este arquivo é a fonte de verdade das decisões de produto; código e banco seguem ele.

Legenda de responsável: **B** Backend · **F** Frontend · **S** Segurança · **P** Produto · **SD** SeniorDev · **E1/E2** Estagiários (revisão, não alteram código) · **Dono** decisão do dono.
Estado: **pronto** · **a fazer** · **bloqueado pelo dono** (sem resposta; não decidir sozinho).

## Limites (precisam de aprovação de Tonny/dono)
Migração em produção, deploy em produção, publicar Termos, cobrança real no Asaas, alterar dados das lojas reais (`com-stillo-moveis`, `royal-home`), criar repositório novo, apagar dados, push no GitHub.
Migrações são escritas e testadas só em banco de teste/local.

## Tabela por pergunta

| Nº | Decisão do dono | Ação | Resp. | Estado |
|---|---|---|---|---|
| 1 | Início R$49 (1 vendedor), Crescimento R$99 (3), Avançado R$199 (6). Cobrança por loja. Anual = 10 meses. | `lib/plans.ts` e `plan_modules`/`plans` no banco: Avançado `maxSellers = 6` (hoje `null` = ilimitado; **6 confirmado pelo dono**); preço anual = 10× mensal. | B, F | feito na branch (B 048, F 0c5bbf7); falta merge |
| 2 | "Com Stillo" é legado/teste. | Remover o plano custom do fluxo (telas, seletor, RPC). Não tocar os dados da loja `com-stillo-moveis`. | B, F | feito no banco (B 048); tela a conferir (F) |
| 3 | Duração do trial (1h, 3h ou 7–14 dias), se dá acesso ao Avançado e se há plano gratuito: **sem resposta**. | Manter o comportamento atual (1h no cadastro, 3h no admin) até decidir. | Dono | bloqueado pelo dono |
| 4 | Excesso de vendedores bloqueia. No downgrade, avisa e obriga excluir vendedores. | RPC/trigger bloqueia criar vendedor acima do limite; troca para plano menor exige excluir excedentes antes (tela de aviso + validação no banco). | B, F | feito na branch (B 049, F 17113fd); falta merge |
| 5–12 | Cobrança (Asaas, upgrade pró-rata, reembolso, cancelamento, assinatura vencida, MRR, NF da assinatura): **adiada pelo dono**. | Não implementar nada de cobrança nesta entrega. Checkout Asaas segue desligado; itens que dependem de cobrança ficam adiados. | Dono | adiado pelo dono |
| 13 | Entram: vendas/PDV, estoque, clientes, financeiro, fornecedores, orçamentos, produção sob medida, entregas, encomendas, boletos, relatórios, comissão de vendedor. Fora: m–t. | Conferir que os 12 módulos funcionam ponta a ponta; esconder/remover qualquer resto de m–t. | F, B | a fazer |
| 14 | Core sempre ligados: Dashboard, Vendas, Clientes, Estoque, Configurações. | Core não pode ser desligado por plano nem por override (banco e front). | B, F | feito na branch (B 048, F 0c5bbf7); falta merge |
| 15 | Boletos, Fornecedores e Encomendas entram a partir do Crescimento. | Adicionar `boletos`, `suppliers`, `orders` ao Crescimento e Avançado em `plan_modules` e `lib/plans.ts`. | B, F | feito na branch (B 048, F 0c5bbf7); falta merge |
| 16 | Corrigir divergência `lib/plans.ts` × `plan_modules`. | Banco é a fonte de verdade; `lib/plans.ts` espelha; teste em `tests/plans.test.ts` garante igualdade. | B | feito na branch (B 048 + `tests/plans.test.ts`); falta merge |
| 17 | Override por loja: só liga/desliga, sem motivo nem validade. | Remover campos/telas de motivo e validade do override. | B, F | feito na branch (B 048, F 17113fd); falta merge |
| 18 | Foco em lojas de móveis; permitir expandir ao comércio geral. | Manter nomes/módulos genéricos; nada de regra de móveis cravada no núcleo (ficam em módulos como `custom_production`). | SD | a fazer (padrão de revisão) |
| 19 | Serviço sob medida gera OS, entrega e lançamento financeiro automaticamente. | Conferir/implementar a geração automática na venda (uma transação). | B | feito na branch (B 055 `create_sale`); falta merge |
| 20a | Estoque com depósitos separados: sim. | Modelo de depósitos (depósito × loja) por loja, com transferência e saldo por local. | B, F | banco feito (B 056); tela de depósitos a fazer (F) |
| 20b | CMV: "As contas por categoria de fornecedor" — **ambíguo**. | Não implementar regra nova de CMV até esclarecer. | Dono | bloqueado pelo dono |
| 21 | NF-e não é obrigatória. | Nenhuma integração fiscal no lançamento. | — | pronto |
| 22 | Remover importação XLSX. | Tirar importação de `pages/Settings.tsx`. Exportação XLSX/CSV fica (não foi pedida a remoção). | F | a conferir (F) |
| 23 | 35 lojistas em 12 meses; 2–3 vendedores por loja. | Dimensionamento: plano atual do Supabase/Vercel basta; sem multi-região. | SD | pronto |
| 24 | PWA (site), sem app nativo. 390px não é prioridade; SeniorDev define a ordem das telas. | Ordem mobile: 1) Vendas/PDV, 2) Estoque, 3) Clientes, 4) Dashboard, 5) Financeiro; demais depois. | F | a fazer |
| 25 | Sem offline. | Service worker só para instalação/push; sem cache de dados. | F | pronto |
| 26 | Só pt-BR e BRL. | Sem i18n. | — | pronto |
| 27 | Sem API pública nem webhooks para terceiros. | Nada a fazer (o webhook de cobrança é interno). | — | pronto |
| 28 | Push só para o dono da loja, todos os eventos, só canal push. | `send-push-notification` envia só ao OWNER; eventos: nova venda, estoque baixo, conta vencida e demais eventos existentes. | B | feito na branch (B 054 + função); falta merge |
| 29 | Um lojista = uma loja. | Bloquear criação de segunda loja para o mesmo dono (cadastro e admin). | B | feito na branch (B 050); falta merge |
| 30 | Loja criada pelo cadastro com trial e também pelo admin. | Manter os dois caminhos, ambos pela mesma RPC de criação. | B, F | feito na branch (B 050); falta merge |
| 31 | Papéis dono/gerente/vendedor: Produto monta a matriz; dono aprova. | Matriz de telas × permissões em `docs/matriz-papeis.md`; implementar só após aprovação. | P → Dono | a fazer |
| 32 | E-mail de colegas visível para vendedor: **sem resposta**. | Manter o mascaramento atual; corrigir só vazamentos já mascarados na tela (aria-labels). | Dono | bloqueado pelo dono |
| 33 | Painel admin: **APENAS o dono do SaaS acessa** (decisão final, substitui "dono e suporte"). | Sem papel de suporte. Acesso só por `is_platform_admin` (uma conta). Remover qualquer papel/conta de suporte do código, RLS, UI e testes; teste garante que não-admin não acessa. | B, F, S | feito na branch (B 050, F 17113fd, S e8acd70); falta merge |
| 34 | Ações: criar loja (trial ou paga), estender, suspender, encerrar, trocar plano, override, pagamento manual, gerenciar equipe. | RPCs admin para cada ação + telas do painel novo. | B, F | feito na branch (B 050, F 17113fd); falta merge |
| 35 | Tela de admin só com assinaturas. A "leitura da loja para suporte" no painel **saiu**. | Painel lista assinaturas e ações; sem tela de leitura de dados da loja nem de vendas/financeiro. | F | feito na branch (F 17113fd); falta merge |
| 36 | Impersonação: sim, só pelo dono do SaaS, sem limite de tempo e sem log. | Manter impersonação sem expirar, restrita a `is_platform_admin`; não registrar log (o log de fim proposto foi retirado). Risco registrado por S. | F, S | pronto (S e8acd70/374173f em `preparacao-lancamento`) |
| 37 | Ações de risco sem motivo e sem aprovação em 2 etapas. | Tirar `MotivoDialog` das ações do admin. | F | feito na branch (F 17113fd); falta merge |
| 38 | Sem KPIs no painel. | Remover cards de MRR/churn/totais do painel. | F | feito na branch (F 17113fd); falta merge |
| 39 | Auditoria 5 anos é decisão interna; sem exportação. | Manter retenção; nenhuma tela de exportação. | — | pronto |
| 40 | Admin cria usuários em qualquer loja; senha provisória 12345678, troca depois. | `manage-users` aceita senha padrão 12345678. Risco registrado; troca obrigatória no 1º acesso **só com confirmação**. | B, S | feito na branch (B `manage-users`); falta merge |
| 41 | Painel atual (STORE_ADMIN, AdminDashboard, ClientesArea) será refeito. | Novo painel admin enxuto (assinaturas + ações da 34). | F, B | feito na branch (F 17113fd); falta merge |
| 42 | Senha mínima 8, sem exigir números. | Alinhar `lib/utils.ts`, `SelfSignup`, `manage-users` e config do Auth em 8 sem regra de número. Auth do `gestao-pro-teste` já em 8 (27/11). Proteção contra senha vazada exige plano Pro. Risco registrado. | B, F, S | feito na branch (B `lib/utils.ts`, F ae422d0); Auth em 8 |
| 43 | MFA (quem; app ou SMS): **sem resposta**. | Nada implementado. | Dono | bloqueado pelo dono |
| 44 | Sem Turnstile. | Remover/desligar código de captcha e doc `captcha-turnstile.md` fica como referência. | F | feito na branch (F ae422d0); falta merge |
| 45 | Normalização de e-mail (+tag) e SSO: **sem resposta**. | Nada implementado. | Dono | bloqueado pelo dono |
| 46a | Cada loja vê só as suas imagens de produto. | RLS de Storage do bucket `products` por loja (leitura e escrita). | B, S | feito na branch (B 051); aprovado por S (A3) |
| 46b | Bucket público ou link temporário: **sem resposta**. | Implementar a 46a de forma compatível com as duas opções (caminho por `store_id`). | Dono | bloqueado pelo dono |
| 47 | Produto redige Termos e Política; rascunho aprovado pelo dono quando entregue; **publicação pendente, fora desta entrega**. Aceite guardado no banco. | Rascunho em `docs/legal/`; tabela de aceite (usuário, versão, data) + registro no cadastro. | P, B, F | feito na branch (B 051, F ae422d0); falta merge |
| 48 | Exportação/anonimização LGPD não é exigida antes do lançamento. | Fora do lançamento; risco registrado por S. | S | pronto |
| 49 | Trial não convertido guarda só o login do dono; o resto é apagado. | Rotina que apaga dados da loja de trial vencido e mantém a conta do dono. **Escrita e testada só em banco de teste; execução real precisa de aprovação.** | B | função feita (B 052), sem agendamento; execução real só com aprovação |
| 50 | Sem contrato DPA. | Nada a fazer. | — | pronto |
| 51 | Backup nativo do Supabase (PITR) basta. | Confirmar PITR ligado no painel. | S | a fazer |
| 52 | Corrigir pendências antes de publicar. | Este plano. | SD | a fazer |
| 53 | Domínio, razão social e CNPJ: **não existem**. | Termos e rodapé com campos a preencher. | Dono | bloqueado pelo dono |
| 54 | Lojas reais `com-stillo-moveis` e `royal-home` não podem ser tocadas. | **Revogada pelo dono (27/11):** todas as lojas do `supabase-dev` (projeto `gestao-pro-teste`) são de teste, inclusive COM STILLO e Royal Home. Migrações: teste no PGlite → export das tabelas afetadas → aplicação via Management API. | B, SD | pronto |
| 55 | Bloqueadores de venda: estoque e financeiro. | E2E desses dois fluxos é condição de lançamento. | F, B | a fazer: E2E ainda não existe (sem Playwright no repositório) |
| 56 | SeniorDev monta a ordem de entrega. | Ver "Ordem de execução". | SD | pronto |
| 57 | E2E e pen-test antes do lançamento. | E2E (Playwright) dos fluxos core no banco de teste; pen-test por S. | F, S | a fazer: E2E não existe; pen-test em andamento (S) |
| 58 | Suporte por WhatsApp. Número: **não informado**. | Botão de suporte com número configurável (vazio até o dono informar). | F / Dono | bloqueado pelo dono (número) |
| 59 | Sem onboarding guiado nem tutorial. | Nada a fazer. | — | pronto |
| 60 | Landing sai do projeto e fica guardada à parte. | Landing (estava em `Shared/gestao-pro-sales`, fora do repositório) copiada para `Shared/Gestao-Pro-Landing`. Não entra no GitHub. | SD | pronto |
| 61 | Não existe PRD. | Este arquivo serve de escopo. | SD | pronto |
| 62 | Stack mantida: React/Vite + Supabase + Vercel. | — | — | pronto |
| — | Dados de demonstração: **sem resposta**. | Nada criado. | Dono | bloqueado pelo dono |

## Itens "o time resolve sozinho"

| Item | Decisão do time | Ação | Resp. | Estado |
|---|---|---|---|---|
| T1 Migrações até 047 em produção; ambientes iguais sem CLI | Leitura em produção para conferir `schema_migrations`/objetos; manter `database/migrations/APLICADAS.md` como registro. | Conferir (só leitura) e atualizar o registro. | B | pronto (620c7c8, `APLICADAS.md`) |
| T2 Edge Functions publicadas; token do webhook; VAPID e segredos no Vault | Conferir versões publicadas e segredos (sem ler valores). Nenhum segredo no front. | Conferência + grep no bundle. | S | a fazer |
| T3 RLS: `profiles`, MASTER_SCHEMA fora de uso, trigger de roles, 1 conta `is_platform_admin`, Realtime com RLS | MASTER_SCHEMA já virou `.example`. Demais: conferir no banco. | Teste de RLS automatizado. | S | a fazer (MASTER_SCHEMA: pronto) |
| T4 CSP e cabeçalhos no `vercel.json` | Sem Turnstile, a CSP fica só com Supabase e domínio próprio. | Adicionar CSP em `vercel.json` (domínio definitivo pendente). | S | pronto (f203e78; domínio pendente) |
| T5 Staging, banco de teste, CI/CD, Gitleaks, gate de deploy | Banco de teste: projeto `gestao-pro-teste` (MCP `supabase-dev`), confirmado pelo dono como teste. Testes primeiro em PGlite. CI no GitHub Actions do repositório atual: tsc, build, Vitest, gitleaks. | Workflow `.github/workflows/ci.yml`. | S, B | pronto (CI com tsc, build, Vitest, gitleaks) |
| T6 Refatorar `store.tsx`; padrões de commit/branch/co-autor; lint/format | Não refatorar `store.tsx` antes do lançamento. Commits convencionais em pt-BR; branch por frente a partir de `preparacao-lancamento`; trailer de co-autor OpenBot. | Seguir na revisão. | SD | pronto |
| T7 Módulos 02/06/08/12/13/14/16; recuperação de senha; templates de notificação; latência/multi-região | Recuperação de senha pelo Auth do Supabase; templates em pt-BR; sem multi-região. | Conferir recuperação de senha no E2E. | B, F | a fazer |
| T8 Observabilidade, rate limit, WAF; RPC ou REST | Rate limit nas Edge Functions feito (memória). Front usa RPC para escrita sensível. Logs do Supabase/Vercel bastam. | — | B | pronto (rate limit) |

## Confirmações do dono (atualização 27/11/2026)
1. Avançado com 6 vendedores: **confirmado**.
2. Painel admin: **apenas o dono** (sem suporte, sem leitura de loja para suporte).
3. Termos: rascunho aprovado quando entregue; publicação pendente.
4. Cobrança (5–12): adiada.

Seguem pendentes: duração do trial, MFA, SSO e +tag, e-mail de colegas, dados de demonstração, imagens (público ou link), CMV, domínio, razão social, CNPJ, número do WhatsApp.

## Estado da execução (27/11/2026 05:05)
- **Branches locais, sem push:** `feat/backend-lancamento` (620c7c8, 6873a0b, 8f0e5d3), `feat/frontend-lancamento` (até b371fbd + alterações não commitadas), `feat/seguranca-lancamento` (16f87c0). Nada mesclado em `preparacao-lancamento` ainda.
- **Correções de segurança no banco (048–058):** A3 imagens por loja, A5 `search_path`, A9 vendedor não apaga pela API, A11 anexos de produção aprovados por S. Migração 028 refeita como 057; achado A13 (receita/taxa infladas pelo vendedor) corrigido em 8f0e5d3, **aguarda nova revisão de S**.
- **Testes (SeniorDev, 05:05):** backend — tsc ok, build ok, Vitest 144/144 (inclui RLS no PGlite), replay duplo das migrações ok. Frontend — tsc ok, build ok, Vitest 73/73. **E2E: não existe ainda.**
- **Banco `supabase-dev`:** nada aplicado. Aplicar 022–058 exige acesso DDL e aprovação do dono, com snapshot das tabelas afetadas antes.
- **Frontend parado:** créditos de uso acabaram durante a última tarefa; há trabalho não commitado no worktree.

## Riscos registrados por Segurança (sem mudar a decisão)
- Senha de 8 caracteres sem números.
- Senha provisória 12345678 — recomendação: troca obrigatória no primeiro acesso (não implementada sem confirmação).
- Impersonação sem log e sem limite de tempo.
- Exportação/anonimização LGPD fora do lançamento.
- Chave publicável antiga do Supabase ficou no histórico do git (migração 001): recomenda-se rotacionar.

## Ordem de execução
1. **Fase 0 (feito):** branch `preparacao-lancamento`, baseline de segurança, este documento, landing separada.
2. **Fase 1 — banco (B, revisão E1):** planos 1/3/6, módulos por plano (15/16), core fixo (14), override sem motivo/validade (17), limite e downgrade (4), uma loja por dono (29), senha 8 (42), senha provisória (40), painel só do dono — sem papel suporte (33), RLS de imagens (46a), aceite dos Termos (47), limpeza de trial (49, só teste). Migrações novas a partir de 048, testadas só em banco de teste.
3. **Fase 2 — front (F, revisão E2):** remover XLSX import (22), Com Stillo (2), Turnstile (44); painel admin refeito (34/35/37/38/41); downgrade com exclusão de vendedores (4); telas de senha; aceite dos Termos; ordem mobile (24).
4. **Fase 3 — push e regras de negócio (B):** push só para o dono (28); sob medida gera OS/entrega/financeiro (19); depósitos (20a).
5. **Fase 4 — produto (P, em paralelo desde já):** matriz de papéis (31) e rascunho de Termos/Política (47).
6. **Fase 5 — segurança (S, em paralelo):** RLS, sessões, service_role/VAPID fora do front, CSP, CI com gitleaks, testes de RLS, riscos.
7. **Fase 6 — verificação (SD):** tsc, build, Vitest, testes de RLS, E2E no banco de teste; varredura de segredos; push da branch só com aprovação.
