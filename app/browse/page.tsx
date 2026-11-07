"use client";

// Public catalog: what Mandi's makers have for sale, with filters by kind of
// piece and by region, sorting, and keyword search.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ListingImage } from "@/components/ListingImage";
import { MakerAvatar } from "@/components/MakerAvatar";

interface Item {
  id: string;
  title: string;
  category: string;
  listPriceMinor: number;
  currency: string;
  image: string | null;
  sellerName: string;
  sellerCity: string;
  sellerRegion: string | null;
  sellerCraft: string | null;
}

// Listing categories grouped the way a shopper thinks about them.
const KINDS: { key: string; label: string; categories: string[] }[] = [
  { key: "sari", label: "Saris", categories: ["sari", "saree"] },
  { key: "wrap", label: "Scarves and shawls", categories: ["scarf", "shawl", "stole", "dupatta"] },
  { key: "home", label: "Home", categories: ["home", "cushion", "tablecloth"] },
  { key: "art", label: "Art", categories: ["art", "painting"] },
  { key: "acc", label: "Accessories", categories: ["accessory", "bag", "pouch"] },
];
const kindOf = (category: string) => KINDS.find((k) => k.categories.includes(category.toLowerCase()))?.key ?? "other";

type Sort = "new" | "low" | "high";

export default function BrowsePage() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Item[] | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [region, setRegion] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("new");

  useEffect(() => {
    const t = setTimeout(() => {
      fetch(`/api/catalog${q ? `?q=${encodeURIComponent(q)}` : ""}`)
        .then((r) => r.json())
        .then((b) => setItems(b.items));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const money = (m: number, c: string) =>
    new Intl.NumberFormat("en-GB", { style: "currency", currency: c, maximumFractionDigits: m % 100 ? 2 : 0 }).format(m / 100);

  const kinds = useMemo(
    () => KINDS.map((k) => ({ ...k, count: (items ?? []).filter((i) => kindOf(i.category) === k.key).length })).filter((k) => k.count > 0),
    [items],
  );
  const regions = useMemo(
    () => [...new Set((items ?? []).map((i) => i.sellerRegion).filter((r): r is string => Boolean(r)))].sort(),
    [items],
  );
  const shown = useMemo(() => {
    const list = (items ?? []).filter((i) => (!kind || kindOf(i.category) === kind) && (!region || i.sellerRegion === region));
    if (sort === "low") return [...list].sort((a, b) => a.listPriceMinor - b.listPriceMinor);
    if (sort === "high") return [...list].sort((a, b) => b.listPriceMinor - a.listPriceMinor);
    return list;
  }, [items, kind, region, sort]);
  const makers = new Set((items ?? []).map((i) => i.sellerName)).size;
  const filtered = Boolean(kind || region);

  return (
    <main className="page">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-xl">
          <h1 className="display text-5xl">Handmade, haggled for you</h1>
          <p className="mt-3 text-lg text-ink-2">
            Pieces from small workshops across India. Prices are the makers&apos; asking prices; your agent negotiates from there.
          </p>
        </div>
        <label className="w-full sm:w-80">
          <span className="sr-only">Search listings</span>
          <input
            type="search"
            className="field"
            placeholder="Search sari, phulkari, indigo"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search listings"
          />
        </label>
      </header>

      {items && items.length > 0 && (
        <div className="mt-8 space-y-3 border-y border-line py-4">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Kind of piece">
            <FilterChip active={!kind} onClick={() => setKind(null)}>
              Everything <span className="money text-ink-3">{items.length}</span>
            </FilterChip>
            {kinds.map((k) => (
              <FilterChip key={k.key} active={kind === k.key} onClick={() => setKind(kind === k.key ? null : k.key)}>
                {k.label} <span className="money text-ink-3">{k.count}</span>
              </FilterChip>
            ))}
            <label className="ml-auto flex items-center gap-2 text-sm text-ink-2">
              Sort
              <select className="field min-h-0 w-auto py-1.5 text-sm" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="new">Newest</option>
                <option value="low">Price, low to high</option>
                <option value="high">Price, high to low</option>
              </select>
            </label>
          </div>
          {regions.length > 1 && (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Made in">
              <span className="mr-1 text-sm text-ink-3">Made in</span>
              {regions.map((r) => (
                <FilterChip key={r} small active={region === r} onClick={() => setRegion(region === r ? null : r)}>
                  {r}
                </FilterChip>
              ))}
            </div>
          )}
        </div>
      )}

      {!items ? (
        <ul className="mt-10 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true" aria-label="Loading listings">
          {Array.from({ length: 8 }, (_, i) => (
            <li key={i}>
              <div className="aspect-[4/5] animate-pulse rounded-2xl bg-surface" />
              <div className="mt-3 h-4 w-3/4 animate-pulse rounded bg-surface" />
              <div className="mt-2 h-4 w-1/3 animate-pulse rounded bg-surface" />
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <div className="well mt-10 p-8 text-center">
          <p className="title text-xl">Nothing matches &ldquo;{q}&rdquo;</p>
          <p className="mt-2 text-ink-2">Try a broader word, like sari or shawl, or clear the search to see everything.</p>
          <button className="btn btn-secondary mt-4" onClick={() => setQ("")}>
            Clear search
          </button>
        </div>
      ) : (
        <>
          <p className="mt-6 text-sm text-ink-3" aria-live="polite">
            {filtered
              ? `${shown.length} of ${items.length} pieces`
              : `${items.length} pieces from ${makers} makers in ${regions.length} regions`}
          </p>
          {shown.length === 0 ? (
            <div className="well mt-4 p-8 text-center">
              <p className="title text-xl">No pieces match these filters</p>
              <button
                className="btn btn-secondary mt-4"
                onClick={() => {
                  setKind(null);
                  setRegion(null);
                }}
              >
                Show everything
              </button>
            </div>
          ) : (
            <ul className="mt-4 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
              {shown.map((i) => (
                <li key={i.id}>
                  <Link href={`/listing/${i.id}`} className="group block rounded-2xl">
                    <div className="overflow-hidden rounded-2xl bg-surface">
                      <ListingImage
                        src={i.image}
                        title={i.title}
                        className="aspect-[4/5] w-full transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none"
                      />
                    </div>
                    <div className="mt-3 flex items-start justify-between gap-3">
                      <p className="font-semibold leading-snug group-hover:underline group-hover:underline-offset-4">{i.title}</p>
                      <p className="money shrink-0 text-lg">{money(i.listPriceMinor, i.currency)}</p>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-sm text-ink-3">
                      <MakerAvatar name={i.sellerName} craft={i.sellerCraft} size="xs" />
                      <span className="min-w-0">
                        <span className="block truncate">
                          {i.sellerName} in {i.sellerCity}
                        </span>
                        {i.sellerCraft && <span className="block truncate text-xs">{i.sellerCraft}</span>}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}

function FilterChip({
  active,
  onClick,
  small = false,
  children,
}: {
  active: boolean;
  onClick: () => void;
  small?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${small ? "px-3 py-1 text-sm" : "px-3.5 py-1.5 text-[0.9375rem]"} ${
        active ? "border-indigo bg-indigo-soft text-indigo" : "border-line bg-raised text-ink-2 hover:border-line-strong hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
