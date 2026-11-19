import { BRAND_NAME } from "@/lib/brand";

/** Marca: três pontos em trilha ascendente (um "rastro"). Nome configurável em src/lib/brand.ts. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <rect width="24" height="24" rx="7" fill="var(--fg)" />
        <circle cx="7" cy="16.5" r="1.8" fill="var(--brand-glow)" opacity="0.45" />
        <circle cx="12" cy="12" r="2.2" fill="var(--brand-glow)" opacity="0.7" />
        <circle cx="17" cy="7.5" r="2.6" fill="var(--brand-glow)" />
      </svg>
      <span className="text-[15px]">{BRAND_NAME}</span>
    </span>
  );
}
