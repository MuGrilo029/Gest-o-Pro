# Matriz de papéis — Gestão Pro (proposta para aprovação do dono)

Decisão 31 de `docs/decisoes-do-dono.md`: Produto monta, dono aprova, só depois implementa.
Estado: **rascunho, não aprovado**. Base: branch `preparacao-lancamento` (27/11/2026).

## Como ler

Cada célula: **Hoje** (o que o código + RLS permitem) → **Proposta** (o que sugiro). Quando os dois são iguais aparece só um valor.
Ações: **V** ver · **C** criar · **E** editar · **X** excluir · **—** sem acesso.
**⚠** = diferença entre hoje e a proposta (precisa mudar código ou banco se o dono aprovar).
"Próprias" = só registros que o próprio usuário criou (`created_by = auth.uid()`).

### Fontes no código
- Front: `lib/modules.ts` → `canAccessViewFor`, `MANAGER_ONLY_VIEWS`, `SELLER_DEFAULT_VIEWS`; `contexts/StoreContext.tsx:271` (`isManager` = dono ou gerente).
- Banco: `database/migrations/003_multi_store_modules.sql` (RLS por loja; `sales`/`quotes` com regra de vendedor; financeiro só gerente), `005_store_manages_sellers.sql` (equipe), `supabase/functions/manage-users` (contas).
- Regra geral de hoje no front: **dono e gerente veem todas as telas** dos módulos ligados; vendedor só vê as telas marcadas para ele (padrão: Dashboard, Vendas/PDV, Histórico de Vendas, Orçamentos, Clientes) e **nunca** Configurações, Equipe, Contas a Pagar/Receber, Boletos, Relatórios.
- Regra geral de hoje no banco: as tabelas de operação (`products`, `stock_movements`, `customers`, `suppliers`, `orders`, `deliveries`, `production_orders`, `categories`, `card_fees`) usam só `store_isolation`: **qualquer membro da loja pode ver, criar, editar e excluir**, inclusive o vendedor. O bloqueio do vendedor nessas telas hoje é **só visual**.
- O front não esconde botões de excluir por papel (só `Settings.tsx` usa `isManager`). Onde o RLS recusa, o vendedor vê o botão e recebe erro.

## 1. Telas da loja (dono, gerente, vendedor)

| Módulo / tela | Dono | Gerente | Vendedor — hoje | Vendedor — proposta | Dif. |
|---|---|---|---|---|---|
| **Dashboard** (core) | V | V | V (tela). Cards financeiros vêm vazios: RLS esconde `transactions` | V só dos **próprios** números (vendas do dia/mês dele); sem cards financeiros da loja | ⚠ front |
| **Vendas / PDV** (core) | V C E X | V C E X | V C E das próprias; X recusado pelo banco (botão aparece) | V C E das próprias; **sem X**; botão escondido | ⚠ front (esconder X) |
| Histórico de vendas | V (todas) | V (todas) | V só próprias | V só próprias | — |
| Desconto na venda | sim | sim | sem limite hoje (não verificado no código) | limite por loja definido pelo dono **[dúvida D4]** | ⚠ se aprovado |
| **Clientes** (core) | V C E X | V C E X | V C E X (banco permite tudo) | V C E; **sem X** **[D7]** | ⚠ banco + front |
| **Estoque / produtos** (core) | V C E X | V C E X | tela oculta por padrão, mas pode ser liberada; banco permite V C E X | V (consulta de saldo e preço) se liberado; **sem C E X** e sem ver custo **[D7]** | ⚠ banco + front |
| Entrada de estoque / histórico | V C | V C | banco permite C | — | ⚠ banco |
| **Configurações** (core) — dados da empresa, categorias, taxas | V E | V E | — | — | — |
| Configurações — marca/cor, dados da loja (`stores`) | V E | V (hoje E só dono no banco; tela não diferencia) | — | — | ⚠ front (gerente vê botão e falha) |
| Configurações — escolher/trocar plano | V E | — | — | — | — |
| **Equipe** | V C E X de vendedores | V C E X de vendedores | — | — | — |
| Equipe — criar gerente ou outro dono | só admin da plataforma | só admin da plataforma | — | **dono cria gerente** **[dúvida D2]** | ⚠ se aprovado |
| **Financeiro** — contas a pagar/receber | V C E X | V C E X | — (tela). Banco deixa inserir **qualquer** lançamento (028 não aplicada) | — ; só o lançamento automático da própria venda | ⚠ banco (aplicar 028) |
| **Boletos** (Crescimento+) | V C E X | V C E X | — | — | — |
| **Fornecedores** (Crescimento+) | V C E X | V C E X | tela pode ser liberada; banco permite tudo | — | ⚠ banco |
| **Encomendas** (Crescimento+) | V C E X | V C E X | tela pode ser liberada; banco permite tudo. A venda dele gera encomenda automática | V das encomendas das **próprias** vendas | ⚠ banco + front |
| **Orçamentos** | V C E X | V C E X | V C E dos próprios; X recusado (botão aparece) | V C E dos próprios; converter em venda; sem X | ⚠ front (esconder X) |
| **Produção / OS** (inclui sob medida) | V C E X | V C E X | tela pode ser liberada; banco permite tudo. A venda dele gera OS automática | V das OS das próprias vendas (status para informar o cliente) **[D8]** | ⚠ banco + front |
| Ficha sob medida (`custom_production`) | V E | V E | idem produção | preencher na venda; depois só V | ⚠ |
| Anexos da produção (bucket `producao-anexos`) | V C X | V C X | não verificado | V das próprias | não verificado |
| **Entregas** | V C E X | V C E X | tela pode ser liberada; banco permite tudo | V das entregas das próprias vendas | ⚠ banco + front |
| **Relatórios** | V | V | — | — | — |
| **Comissão de vendedor** | **não existe no código** | — | — | V só a própria (extrato do mês) | ⚠ módulo novo |
| Comissão — definir regra/percentual | — | — | — | dono **[dúvida D1, D3]** | ⚠ módulo novo |
| Notificações push | recebe (decisão 28) | — | — | — | ⚠ hoje envia a mais membros (Backend, item 28) |
| Exportar dados (XLSX/CSV) | V | V | — | — | — |

### Proposta para dono × gerente (resumo)
Gerente = dono **menos**: escolher/trocar plano e assinatura, editar dados da loja/marca, criar gerente. Hoje isso já vale no banco (`stores_update` só OWNER; `choose_trial_plan` só OWNER), mas o front mostra os botões ao gerente. **[dúvida D5]**: gerente vê financeiro e relatórios? Hoje vê. Mantive.

## 2. Painel admin da plataforma (só o dono do SaaS)

Decisão atualizada (commit `ef2f3bf`): **só o dono do SaaS** acessa o painel e a impersonação. **Não existe papel nem conta de suporte.** Acesso só por `profiles.is_platform_admin = true`, nas RPCs, no RLS e na interface. Hoje já é assim (único papel de plataforma). Ações da decisão 34.

| Ação no painel | Dono do SaaS — hoje | Dono do SaaS — proposta | Dif. |
|---|---|---|---|
| Ver lista de assinaturas (loja, plano, status, vencimento) | sim | sim | — |
| Abrir a ficha da loja | sim | sim | — |
| Ver dados da loja por impersonação | sim | sim, sem limite de tempo e sem log (decisão 36) | — |
| Criar loja (trial ou paga) | sim | sim | — |
| Estender trial/assinatura | sim | sim | — |
| Suspender loja | sim | sim | — |
| Encerrar loja | sim | sim | — |
| Trocar plano | sim (tela usa RPC antiga `admin_set_plan`) | sim, pela RPC 037 | ⚠ front |
| Override de módulo (liga/desliga) | sim, com motivo/validade | sim, sem motivo/validade (decisão 17) | ⚠ |
| Registrar pagamento manual | sim | [ADIADO: cobrança] | — |
| Gerenciar equipe de qualquer loja (criar usuário, senha provisória 12345678, papel) | sim | sim | — |
| Ações de risco com motivo (`MotivoDialog`) | sim | sem motivo (decisão 37) | ⚠ front |
| KPIs (MRR, churn) | sim | **removido** (decisão 38) | ⚠ front |
| Auditoria das ações administrativas | gravada (5 anos) | gravada; impersonação sem log | — |

Dono, gerente e vendedor de loja **nunca** acessam o painel nem a impersonação: hoje garantido por `PLATFORM_ADMIN_VIEWS` (front) e `is_platform_admin()` (banco). Segurança testa isso (pedido do SeniorDev).

## 3. Diferenças que viram trabalho (se o dono aprovar)

| # | Mudança | Camada | Resp. sugerido |
|---|---|---|---|
| M1 | RLS por papel nas tabelas de operação: vendedor só lê `products`, `customers` (C E sem X), sem escrita em `suppliers`, `stock_movements`; `orders`/`deliveries`/`production_orders` só leitura das próprias vendas | Banco | B, revisão S |
| M2 | Aplicar a 028 (vendedor só insere receita da própria venda) + resolver a taxa de cartão gravada pelo vendedor | Banco | B |
| M3 | Esconder botões que o papel não pode usar (excluir venda/orçamento/cliente; marca/plano para gerente) | Front | F |
| M4 | Dashboard do vendedor com números próprios | Front | F |
| M5 | Módulo de comissão (regra, cálculo na venda, extrato) — **não existe** | Banco + Front | B, F (depende de D1/D3) |
| M6 | Push só para o dono | Edge Function | B (já na decisão 28) |
| M7 | Esconder custo do produto para o vendedor | Front + view/RPC | F, B |

## Não verificado
- Se o vendedor consegue editar itens de venda já finalizada pela RPC `edit_sale_items` (020) — regra interna da RPC não lida.
- Limite de desconto no PDV.
- Acesso do vendedor ao bucket `producao-anexos` (011).
- Como a impersonação passa pelo RLS de `current_store_id()` (exige ser membro da loja).
- Comissão: não há tabela, tela nem cálculo no repositório (busca por `commission`/`comiss` sem resultado).

## Dúvidas para o dono
Ver `duvidas-dono.md` (D1–D8, L1–L8).
