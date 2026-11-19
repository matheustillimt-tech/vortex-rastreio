"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { useActionState } from "react";
import { resetLabAction, runLabAction, type RunState } from "./actions";

const btn = "h-9 rounded-lg px-4 text-sm font-medium disabled:opacity-50";

export function LabPanel({ scenarios }: { scenarios: Array<{ id: string; title: string; description: string }> }) {
  const [state, run, running] = useActionState<RunState, FormData>(runLabAction, { ok: true, message: "" });
  const [reset, doReset, resetting] = useActionState<RunState, FormData>(resetLabAction, { ok: true, message: "" });
  const byId = new Map((state.results ?? []).map((r) => [r.id, r]));

  return (
    <div className="flex flex-col gap-5">
      <form action={run} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="scenario" value="all" />
        <button type="submit" disabled={running} className={`${btn} bg-fg text-bg`}>
          {running ? "Rodando…" : "Rodar todos os cenários"}
        </button>
        {state.message && (
          <p role="status" className={`text-sm ${state.ok ? "text-good" : "text-critical"}`}>
            {state.message}
          </p>
        )}
      </form>

      <ul className="flex flex-col gap-3">
        {scenarios.map((s) => {
          const r = byId.get(s.id);
          return (
            <li key={s.id} className="min-w-0 rounded-xl border border-border bg-surface">
              <div className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    {r &&
                      (r.pass ? (
                        <CheckCircle2 size={16} className="text-good" aria-hidden="true" />
                      ) : (
                        <XCircle size={16} className="text-critical" aria-hidden="true" />
                      ))}
                    {s.title}
                    {r && <span className={`text-xs ${r.pass ? "text-good" : "text-critical"}`}>{r.pass ? "Aprovado" : "Falhou"}</span>}
                  </p>
                  <p className="mt-0.5 text-xs text-fg-2">{s.description}</p>
                </div>
                <form action={run} className="shrink-0">
                  <input type="hidden" name="scenario" value={s.id} />
                  <button type="submit" disabled={running} className={`${btn} h-8 border border-border text-xs text-fg-2 hover:text-fg`}>
                    Rodar
                  </button>
                </form>
              </div>
              {r && (
                <div className="min-w-0 overflow-x-auto border-t border-border">
                  {r.error && <p className="px-4 py-2 text-sm text-critical">Erro: {r.error}</p>}
                  {r.steps.length > 0 && (
                    <table className="w-full min-w-[480px] text-sm">
                      <caption className="sr-only">Esperado e encontrado em {s.title}</caption>
                      <thead>
                        <tr className="text-left text-xs text-fg-3">
                          <th scope="col" className="px-4 py-1.5 font-medium">Verificação</th>
                          <th scope="col" className="px-2 py-1.5 font-medium">Esperado</th>
                          <th scope="col" className="px-2 py-1.5 font-medium">Encontrado</th>
                          <th scope="col" className="px-4 py-1.5 font-medium">Resultado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.steps.map((st) => (
                          <tr key={st.label} className="border-t border-border">
                            <td className="px-4 py-2">{st.label}</td>
                            <td className="px-2 py-2 tabular-nums">{st.expected}</td>
                            <td className="px-2 py-2 tabular-nums">{st.found}</td>
                            <td className={`px-4 py-2 font-medium ${st.pass ? "text-good" : "text-critical"}`}>{st.pass ? "Passou" : "Falhou"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <form action={doReset} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
        <p className="text-sm font-medium">Zerar o laboratório</p>
        <p className="text-xs text-fg-2">
          Apaga visitas, eventos, webhooks, pedidos, contadores e gasto de anúncios simulado <strong>somente</strong> do workspace de simulação. O banco recusa a operação em
          qualquer workspace de produção. Os dados de simulação também são apagados sozinhos depois de 7 dias.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="confirm" className="size-4" /> Entendo que isso apaga os dados de simulação
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={resetting} className={`${btn} border border-critical text-critical`}>
            {resetting ? "Zerando…" : "Zerar laboratório"}
          </button>
          {reset.message && (
            <p role="status" className={`text-sm ${reset.ok ? "text-fg-2" : "text-critical"}`}>
              {reset.message}
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
