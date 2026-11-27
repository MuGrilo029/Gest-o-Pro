# E2E (Playwright)

```bash
npx playwright install chromium   # uma vez
npm run e2e                       # modo mock (padrão)
```

## Modos

| Modo | Banco | Quando usar |
|---|---|---|
| `mock` (padrão) | Supabase falso em memória (`e2e/support/supabaseMock.ts`), interceptado no navegador | Testa a tela: roda em qualquer máquina, sem rede |
| `env` | Supabase **local** ou de **teste** | Testa tela + banco de verdade (RLS, RPCs, gatilhos) |

O mock reproduz os contratos combinados com o Backend (create_sale, admin_*, manage-users, LIMITE_VENDEDORES).
Ele **não** prova as regras do banco: isso é o teste do Backend (PGlite) e o modo `env`.

## Fluxos cobertos

- `login.spec.ts`: dono entra; senha errada; admin cai no painel de assinaturas (sem KPIs).
- `loja.spec.ts`: venda no PDV (via `create_sale`), entrada de estoque, conta a pagar.
- `admin.spec.ts`: criar loja paga (senha provisória 12345678), downgrade com exclusão de vendedores, limite de vendedores na equipe.
- `mobile.spec.ts`: PDV, Estoque, Clientes, Dashboard e Financeiro em 390px sem conteúdo fora da tela.

## Modo `env` (o que falta para rodar)

Hoje **não há** banco de teste liberado para escrita (o `supabase-dev` é produção, só leitura). Para rodar:

1. Subir um Supabase local (`supabase start`, precisa de Docker) ou um projeto de teste, com as migrações até a 059.
2. Semear: conta admin (`is_platform_admin = true`), conta dona com a loja **"Loja E2E Móveis"** no plano Crescimento,
   3 vendedores, produtos **"Sofá E2E 3 lugares"** (SKU E2E-SOF, estoque ≥ 1) e **"Mesa E2E"** (SKU E2E-MES).
3. Variáveis:

```bash
E2E_MODE=env
E2E_SUPABASE_URL=http://127.0.0.1:54321
E2E_SUPABASE_ANON_KEY=...            # chave anon do banco de teste
E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=...
E2E_OWNER_EMAIL=... E2E_OWNER_PASSWORD=...
E2E_FORBIDDEN_STORE_IDS=<ids das lojas reais>   # o teste para se a conta enxergar uma delas
# E2E_ALLOW_REMOTE_TEST=1            # só para projeto de TESTE remoto
```

## Guardas

- O ref do projeto de produção (`yfyckreoprwfwhjadfkl`) é recusado sempre.
- URL que não é local só com `E2E_ALLOW_REMOTE_TEST=1`.
- Lojas reais são reconhecidas pelo **id** (`E2E_FORBIDDEN_STORE_IDS`), não pelo slug.
- No modo `env`, os testes de admin criam uma loja nova e excluem 2 vendedores da loja de teste: use só banco descartável.
