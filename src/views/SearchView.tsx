import { useState, useCallback, useRef, useEffect } from "react";
import type { InstanceRow } from "../hprof.worker";
import type { WorkerProxy } from "../worker-proxy";
import { fmtSize } from "../format";
import { type NavFn, SortableTable, InstanceLink } from "../components";

function SearchView({ proxy, navigate, initialQuery }: { proxy: WorkerProxy; navigate: NavFn; initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery ?? "");
  const [results, setResults] = useState<InstanceRow[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchedRef = useRef(false);

  const doSearch = useCallback((q: string) => {
    if (q.length < 2) { setResults([]); return; }
    proxy.query<InstanceRow[]>("search", { query: q }).then(setResults).catch(console.error);
  }, [proxy]);

  // Run initial search from URL param
  useEffect(() => {
    if (initialQuery && initialQuery.length >= 2 && !searchedRef.current) {
      searchedRef.current = true;
      doSearch(initialQuery);
    }
  }, [initialQuery, doSearch]);

  const handleChange = useCallback((q: string) => {
    setQuery(q);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (q.length < 2) { setResults([]); return; }
    timerRef.current = setTimeout(() => {
      doSearch(q);
      // Update URL without adding to history
      const url = q ? `/search?q=${encodeURIComponent(q)}` : "/search";
      window.history.replaceState({ view: "search", params: { q } }, "", url);
    }, 300);
  }, [doSearch]);

  return (
    <div>
      <h2 className="text-lg font-semibold mb-3 text-stone-800">Search</h2>
      <input
        type="text" value={query} onChange={e => handleChange(e.target.value)}
        placeholder={"Class name or 0x\u2026 hex id"}
        className="w-full px-3 py-2 border border-stone-300 mb-3 focus:outline-none focus:ring-2 focus:ring-sky-400"
      />
      {results.length > 0 && (
        <SortableTable<InstanceRow>
          columns={[
            { label: "Retained", align: "right", sortKey: r => r.retainedTotal, render: r => <span className="font-mono">{fmtSize(r.retainedTotal)}</span> },
            { label: "Object", render: r => <InstanceLink row={r} navigate={navigate} /> },
          ]}
          data={results}
          rowKey={r => r.id}
        />
      )}
      {query.length >= 2 && results.length === 0 && (
        <div className="text-stone-500">No results found.</div>
      )}
    </div>
  );
}

export default SearchView;
