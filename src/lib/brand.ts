/**
 * Nome do produto exibido no painel, no título das abas e nas mensagens.
 * Para usar a sua marca, defina NEXT_PUBLIC_BRAND_NAME (ex.: "Rastreio da Minha Empresa").
 * Lido no build: depois de mudar na Vercel, faça um novo deploy.
 */
export const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME?.trim() || "Vórtex Rastreio";
