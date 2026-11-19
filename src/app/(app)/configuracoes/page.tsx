import type { Metadata } from "next";
import { Card, CardHeader, NoWorkspace, Notice, PageHeader, SchemaPending } from "@/components/ui";
import { getDb } from "@/lib/db";
import { requireWorkspace } from "@/lib/dashboard/load";
import { env, isSupabaseConfigured } from "@/lib/env";
import { getCostsForUser } from "@/lib/workspace/repo";
import { CostsForm } from "./costs-form";

export const metadata: Metadata = { title: "Custos e conta" };

export default async function SettingsPage() {
  const ctx = await requireWorkspace();
  if (ctx.kind === "no-workspace") return <NoWorkspace />;
  if (ctx.kind === "schema-pending") return <SchemaPending />;
  const { userId, membership } = ctx;
  const costs = await getCostsForUser(await getDb(), userId, membership.workspaceId);
  return (
    <>
      <PageHeader title="Custos e conta" description={`Workspace: ${membership.workspaceName} · seu papel: ${membership.role}`} />
      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Custos" description="Lucro estimado = líquido − anúncios − custo por venda × vendas − fixos rateados" />
          <div className="p-5">
            <CostsForm initial={costs} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Conta e privacidade" />
          <div className="flex flex-col gap-3 p-5 text-sm text-fg-2">
            {isSupabaseConfigured() ? (
              <p>Login pelo Supabase Auth do seu projeto.</p>
            ) : (
              <Notice>Modo local: sem login. Usuário e workspace de desenvolvimento do banco local.</Notice>
            )}
            <p>
              Banco: <strong className="text-fg">{env.databaseUrl ? "Supabase (schema rastro)" : "local (PGlite em .data/)"}</strong>
            </p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>E-mail do comprador guardado só como hash SHA-256.</li>
              <li>Sem nome, CPF, telefone ou IP no banco.</li>
              <li>Eventos de navegação apagados após 13 meses.</li>
              <li>Payload bruto de webhook esvaziado após 90 dias.</li>
            </ul>
          </div>
        </Card>
      </div>
    </>
  );
}
