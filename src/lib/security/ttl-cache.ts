/**
 * Cache em memória com validade curta e tamanho máximo (por instância).
 * Usado para não consultar o banco a cada requisição repetida — inclusive as inválidas
 * (cache negativo), que é o que um ataque com chaves/tokens aleatórios geraria.
 */
export function createTtlCache<V>(opts: { ttlMs: number; maxEntries?: number }) {
  const map = new Map<string, { value: V; expires: number }>();
  const max = opts.maxEntries ?? 5_000;
  return {
    get(key: string, now = Date.now()): { hit: true; value: V } | { hit: false } {
      const e = map.get(key);
      if (!e) return { hit: false };
      if (e.expires <= now) {
        map.delete(key);
        return { hit: false };
      }
      return { hit: true, value: e.value };
    },
    set(key: string, value: V, now = Date.now()) {
      if (map.size >= max) map.delete(map.keys().next().value as string);
      map.set(key, { value, expires: now + opts.ttlMs });
    },
    clear() {
      map.clear();
    },
  };
}
