/**
 * Helper untuk mengambil SEMUA baris dari Supabase tanpa terbatas
 * pada batas default 1000 baris per permintaan.
 *
 * PostgREST membatasi jumlah baris per request (default 1000), jadi
 * kita ambil data secara bertahap (paging) sampai habis.
 */
export async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
  maxPages = 500,
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error) {
      console.error("fetchAllRows error:", error);
      break;
    }
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}

/** Ambil semua baris untuk daftar id dengan cara chunk + paging. */
export async function fetchAllByIds<T>(
  ids: string[],
  buildQuery: (chunk: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  chunkSize = 100,
): Promise<T[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += chunkSize) chunks.push(ids.slice(i, i + chunkSize));
  const results = await Promise.all(
    chunks.map((chunk) => fetchAllRows<T>((from, to) => buildQuery(chunk, from, to))),
  );
  return results.flat();
}
