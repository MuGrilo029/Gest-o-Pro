# Captcha no cadastro público (preparado, NÃO aplicado)

Status: aguardando chaves do provedor. Nada foi alterado no projeto Supabase.

## Estado atual (lido em 2026, projeto yfyckreoprwfwhjadfkl)
- `mailer_autoconfirm = false`: confirmação de e-mail obrigatória (ok).
- `security_captcha_enabled = false`.
- `security_captcha_provider = hcaptcha` (pré-selecionado pelo painel), sem segredo.

## Chaves que faltam (o usuário precisa fornecer)
- Provedor escolhido: Cloudflare Turnstile (recomendado pela Arquitetura e SecOps). Se preferir hCaptcha, troque o provedor abaixo.
- `TURNSTILE_SECRET_KEY`: segredo do servidor (vai para o Supabase Auth).
- `VITE_TURNSTILE_SITE_KEY`: chave pública do widget (vai para o front, `.env.local`).

## Aplicar depois que as chaves existirem
Management API (substituir `<TURNSTILE_SECRET_KEY>`; não colar o valor em arquivos versionados):

```
PATCH https://api.supabase.com/v1/projects/yfyckreoprwfwhjadfkl/config/auth
{
  "security_captcha_enabled": true,
  "security_captcha_provider": "turnstile",
  "security_captcha_secret": "<TURNSTILE_SECRET_KEY>"
}
```

## Front-end (a fazer pelo Front-end)
- Renderizar o widget Turnstile na tela de cadastro com `VITE_TURNSTILE_SITE_KEY`.
- Enviar o token no cadastro: `supabase.auth.signUp({ email, password, options: { captchaToken } })`.
- Depois da confirmação do e-mail, chamar `start_self_trial(p_name)` (migrações 012 e 013 exigem e-mail confirmado).

## Teste de aceitação
- Cadastro sem token é recusado pelo Auth.
- Cadastro com token válido envia e-mail de confirmação; sem confirmar, `start_self_trial` é recusado.
