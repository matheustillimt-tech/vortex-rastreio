import { FlaskConical } from "lucide-react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AdPerformanceTable } from "@/components/dashboard/ad-performance-table";
import { LevelTabs } from "@/components/dashboard/level-tabs";
import { Card, CardHeader, Notice, PageHeader, SchemaPending } from "@/components/ui";
import { getCurrentUserId } from "@/lib/auth/session";
import { dateRange, parseLevel } from "@/lib/dashboard/filters";
import { schemaReady } from "@/lib/dashboard/load";
import { adPerformance } from "@/lib/domain/metrics";
import { getDb } from "@/lib/db";
import { ensureLab, labAdsReady, labAllowed, labCounts, labSchemaReady } from "@/lib/lab/setup";
import { scenarioList } from "@/lib/lab/scenarios";
import { int } from "@/lib/format";
import { loadWorkspaceData } from "@/lib/workspace/repo";
import { LabPanel } from "./lab-panel";

export const metadata: Metadata = { title: "Laboratório (simulação)", robots: { index: false } };

export default async function LabPage({ searchParams }: PageProps<"/laboratorio">) {
  const level = parseLevel(await searchParams);
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");
  // quem não está liberado nem descobre que a página existe
  if (!labAllowed(userId)) notFound();
  const db = await getDb();
  if (!(await schemaReady(db))) return <SchemaPending />;

  if (!(await labSchemaReady(db))) {
    return (
      <>
        <Banner />
        <PageHeader title="Laboratório" />
        <Notice tone="warn">
          O laboratório precisa da migração <code className="font-mono">0005_laboratorio</code>. Aplique as migrações pendentes com{" "}
          <code className="font-mono">supabase db push</code>.
        </Notice>
      </>
    );
  }

  const lab = await ensureLab(db, userId);
  const counts = await labCounts(db, userId, lab.workspaceId);
  const adsReady = await labAdsReady(db);
  const { from, to } = dateRange(30);
  const data = await loadWorkspaceData(db, userId, lab.workspaceId, from, to);
  const rows = adPerformance(data.orders, data.insights, data.costs, level);

  return (
    <>
      <Banner />
      <PageHeader
        title="Laboratório"
        description="Cenários rodando o mesmo código de produção num workspace separado. Nenhuma plataforma real é chamada."
      />
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {(
            [
              ["Sessões simuladas", counts.sessions],
              ["Eventos simulados", counts.events],
              ["Pedidos simulados", counts.orders],
              ["Webhooks simulados", counts.webhooks],
              ["Linhas de gasto simulado", counts.insights],
            ] as const
          ).map(([label, v]) => (
            <Card key={label} className="p-4">
              <p className="text-xs text-fg-2">{label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{int(v)}</p>
            </Card>
          ))}
        </div>
        <LabPanel scenarios={scenarioList()} />
        <Card>
          <CardHeader
            title="Campanhas simuladas (últimos 30 dias)"
            description="Mesma tabela da página Campanhas, com o gasto e as vendas do laboratório. Rode o cenário “Gasto de anúncios × vendas” para preencher."
            action={<LevelTabs />}
          />
          {adsReady ? (
            <AdPerformanceTable rows={rows} level={level} />
          ) : (
            <div className="p-5">
              <Notice tone="warn">
                O gasto simulado precisa da migration <code className="font-mono">0006_lab_anuncios</code>, ainda não aplicada neste banco.
              </Notice>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

/** Faixa permanente: não há como confundir com dado real. */
function Banner() {
  return (
    <div role="note" className="mb-5 flex items-center gap-2 rounded-lg border border-warning bg-warning/10 px-4 py-2.5 text-sm font-semibold">
      <FlaskConical size={16} className="text-warning" aria-hidden="true" />
      SIMULAÇÃO — dados fictícios, separados dos dados reais. Nada daqui aparece no painel.
    </div>
  );
}
