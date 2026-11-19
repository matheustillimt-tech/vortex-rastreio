import type { Metadata } from "next";
import { headers } from "next/headers";
import { Card, CardHeader, Code, NoWorkspace, Notice, PageHeader, SchemaPending } from "@/components/ui";
import { requireWorkspace } from "@/lib/dashboard/load";
import { getDb } from "@/lib/db";
import { listSites } from "@/lib/workspace/repo";
import { setSiteStatusAction } from "./actions";
import { CopyButton, EditSiteForm, NewSiteForm } from "./site-forms";

export const metadata: Metadata = { title: "Sites" };

function snippet(origin: string, key: string) {
  return `<script async src="${origin}/t.js" data-key="${key}" data-consent="required"></script>`;
}

export default async function SitesPage() {
  const ctx = await requireWorkspace();
  if (ctx.kind === "no-workspace") return <NoWorkspace />;
  if (ctx.kind === "schema-pending") return <SchemaPending />;
  const isAdmin = ctx.membership.role !== "viewer";
  const sites = await listSites(await getDb(), ctx.userId, ctx.membership.workspaceId);
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;

  return (
    <>
      <PageHeader title="Sites" description="Onde o script de rastreamento está instalado. Cada site tem a própria chave pública." />
      {!isAdmin && (
        <div className="mb-5">
          <Notice>Você tem acesso de leitura. Só administradores cadastram e alteram sites.</Notice>
        </div>
      )}

      <div className="flex flex-col gap-5">
        {sites.length === 0 && (
          <Card className="p-6 text-center text-sm text-fg-2">Nenhum site cadastrado ainda. Cadastre o primeiro abaixo.</Card>
        )}

        {sites.map((s) => (
          <Card key={s.id}>
            <CardHeader
              title={s.name}
              description={s.status === "active" ? "Ativo: recebendo eventos" : "Desativado: eventos deste site são recusados"}
              action={
                isAdmin ? (
                  <form action={setSiteStatusAction}>
                    <input type="hidden" name="siteId" value={s.id} />
                    <input type="hidden" name="status" value={s.status === "active" ? "disabled" : "active"} />
                    <button
                      type="submit"
                      className={`h-8 rounded-lg border px-3 text-xs font-medium ${
                        s.status === "active" ? "border-border text-fg-2 hover:text-critical" : "border-brand text-fg"
                      }`}
                    >
                      {s.status === "active" ? "Desativar" : "Reativar"}
                    </button>
                  </form>
                ) : null
              }
            />
            <div className="flex flex-col gap-5 p-5">
              <div>
                <p className="mb-1.5 text-xs font-medium text-fg-2">Chave pública de rastreamento</p>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="break-all rounded-md border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-xs">{s.publicKey}</code>
                  <CopyButton value={s.publicKey} />
                </div>
                <p className="mt-1.5 text-xs text-fg-3">Não é segredo: ela aparece no HTML da página. A proteção vem dos domínios autorizados.</p>
              </div>

              <div>
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium text-fg-2">Instalação: cole antes de &lt;/head&gt; em todas as páginas</p>
                  <CopyButton value={snippet(origin, s.publicKey)} label="Copiar código" />
                </div>
                <Code>{snippet(origin, s.publicKey)}</Code>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-fg-2">
                  <li>Cole o código no cabeçalho das páginas de venda e de captura.</li>
                  <li>No seu banner de cookies, depois do aceite, chame <code className="font-mono">rastro(&apos;consent&apos;, true)</code>.</li>
                  <li>Abra a página e confira os eventos em Rastreamento.</li>
                </ol>
              </div>

              {s.allowedOrigins.length === 0 && (
                <Notice tone="warn">Sem domínios autorizados: qualquer site pode enviar eventos com esta chave. Defina os domínios antes de usar em produção.</Notice>
              )}

              <EditSiteForm siteId={s.id} name={s.name} origins={s.allowedOrigins} disabled={!isAdmin} />
            </div>
          </Card>
        ))}

        <Card>
          <CardHeader title="Cadastrar site" description="Uma chave nova e exclusiva é gerada automaticamente" />
          <div className="p-5">
            <NewSiteForm disabled={!isAdmin} />
          </div>
        </Card>
      </div>
    </>
  );
}
