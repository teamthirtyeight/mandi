"use client";

// Public catalog: what Mandi's makers have for sale, with filters by kind of
// piece and by region, sorting, and keyword search.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ListingImage } from "@/components/ListingImage";
import { MakerAvatar } from "@/components/MakerAvatar";
import { LockIcon, ShieldIcon, ChatIcon } from "@/components/Icons";

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

function SearchIcon({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.4-4.4" />
    </svg>
  );
}

function PinIcon({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0113 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.25" />
    </svg>
  );
}

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
      {/* Header: title on the left, search on the right (stacked on phones) */}
      <header className="border-b border-line pb-8">
        <p className="eyebrow">The catalogue</p>
        <div className="mt-3 grid items-end gap-6 lg:grid-cols-[1fr_24rem]">
          <div className="max-w-2xl">
            <h1 className="display text-[clamp(2.25rem,5vw,3.25rem)]">Handmade, haggled for you</h1>
            <p className="lede mt-4">
              Pieces from small workshops across India. Prices are the makers&apos; asking prices; your agent negotiates from there.
            </p>
          </div>
          <label className="relative block w-full">
            <span className="sr-only">Search listings</span>
            <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              type="search"
              className="field min-h-12 rounded-[0.625rem] pl-10 text-[0.9375rem]"
              placeholder="Search sari, phulkari, indigo"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search listings"
            />
          </label>
        </div>
        <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-2">
          {[
            { icon: ChatIcon, text: "Your agent negotiates the price" },
            { icon: LockIcon, text: "Your budget stays private" },
            { icon: ShieldIcon, text: "PayPal holds payment until it ships" },
          ].map(({ icon: IconComponent, text }) => (
            <li key={text} className="flex items-center gap-2">
              <IconComponent size={16} className="shrink-0 text-indigo" />
              {text}
            </li>
          ))}
        </ul>
      </header>

      {/* Filter bar */}
      {items && items.length > 0 && (
        <div className="mt-6 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Kind of piece">
              <FilterChip active={!kind} onClick={() => setKind(null)}>
                Everything <span className={`num text-xs ${!kind ? "text-indigo" : "text-ink-3"}`}>{items.length}</span>
              </FilterChip>
              {kinds.map((k) => (
                <FilterChip key={k.key} active={kind === k.key} onClick={() => setKind(kind === k.key ? null : k.key)}>
                  {k.label} <span className={`num text-xs ${kind === k.key ? "text-indigo" : "text-ink-3"}`}>{k.count}</span>
                </FilterChip>
              ))}
            </div>
            <label className="flex shrink-0 items-center gap-2 text-sm text-ink-3">
              Sort by
              <select
                className="field min-h-10 w-auto py-1.5 pr-8 text-sm font-medium"
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
              >
                <option value="new">Newest</option>
                <option value="low">Price, low to high</option>
                <option value="high">Price, high to low</option>
              </select>
            </label>
          </div>
          {regions.length > 1 && (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Made in">
              <span className="mr-1 flex items-center gap-1.5 text-sm text-ink-3">
                <PinIcon />
                Made in
              </span>
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
        <>
          <p className="sr-only" role="status">
            Loading listings
          </p>
          <div className="mt-6 flex gap-2" aria-hidden="true">
            {[96, 72, 140, 64, 100].map((w, i) => (
              <div key={i} className="h-10 animate-pulse rounded-full bg-surface" style={{ width: w }} />
            ))}
          </div>
          <ul
            className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 sm:gap-x-6 sm:gap-y-10 md:grid-cols-3 lg:grid-cols-4"
            aria-busy="true"
            aria-label="Loading listings"
          >
            {Array.from({ length: 8 }, (_, i) => (
              <li key={i}>
                <div className="aspect-[4/5] animate-pulse rounded-[0.875rem] bg-surface" />
                <div className="mt-3 h-4 w-11/12 animate-pulse rounded bg-surface" />
                <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-surface" />
                <div className="mt-3 h-5 w-1/4 animate-pulse rounded bg-surface" />
              </li>
            ))}
          </ul>
        </>
      ) : items.length === 0 ? (
        <div className="panel mx-auto mt-10 flex max-w-lg flex-col items-center px-6 py-12 text-center">
          <span className="icon-tile h-12 w-12">
            <SearchIcon size={22} />
          </span>
          <p className="title mt-4 text-xl">{q ? <>Nothing matches &ldquo;{q}&rdquo;</> : "Nothing to show yet"}</p>
          {q && (
            <>
              <p className="mt-2 text-sm text-ink-2">Try a broader word, like sari or shawl, or clear the search to see everything.</p>
              <button className="btn btn-secondary mt-6" onClick={() => setQ("")}>
                Clear search
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          <p className="mt-6 border-t border-line pt-4 text-sm text-ink-3" aria-live="polite">
            {filtered
              ? `${shown.length} of ${items.length} pieces`
              : `${items.length} pieces from ${makers} makers in ${regions.length} regions`}
          </p>
          {shown.length === 0 ? (
            <div className="panel mx-auto mt-6 flex max-w-lg flex-col items-center px-6 py-12 text-center">
              <span className="icon-tile h-12 w-12">
                <SearchIcon size={22} />
              </span>
              <p className="title mt-4 text-xl">No pieces match these filters</p>
              <button
                className="btn btn-secondary mt-6"
                onClick={() => {
                  setKind(null);
                  setRegion(null);
                }}
              >
                Show everything
              </button>
            </div>
          ) : (
            <ul className="mt-5 grid grid-cols-2 gap-x-4 gap-y-8 sm:gap-x-6 sm:gap-y-10 md:grid-cols-3 lg:grid-cols-4">
              {shown.map((i) => (
                <li key={i.id} className="min-w-0">
                  <Link href={`/listing/${i.id}`} className="group block rounded-[0.875rem]">
                    <div className="overflow-hidden rounded-[0.875rem] border border-line bg-surface shadow-[var(--shadow-xs)] transition-shadow duration-200 group-hover:shadow-[var(--shadow-md)]">
                      <ListingImage
                        src={i.image}
                        title={i.title}
                        className="aspect-[4/5] w-full transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none"
                      />
                    </div>
                    <div className="mt-3 min-w-0">
                      <p className="line-clamp-2 text-sm font-medium leading-snug text-ink group-hover:underline group-hover:underline-offset-4 sm:text-[0.9375rem]">
                        {i.title}
                      </p>
                      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-xs text-ink-3 sm:text-sm">
                        <MakerAvatar name={i.sellerName} craft={i.sellerCraft} size="xs" />
                        <span className="truncate">
                          {i.sellerName} in {i.sellerCity}
                        </span>
                      </div>
                      {i.sellerCraft && <p className="mt-1 truncate text-xs text-ink-3">{i.sellerCraft}</p>}
                      <p className="mt-2 flex items-baseline gap-1.5">
                        <span className="money text-base sm:text-lg">{money(i.listPriceMinor, i.currency)}</span>
                        <span className="text-xs text-ink-3">asking</span>
                      </p>
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
      className={`inline-flex min-h-10 items-center gap-1.5 rounded-full border font-medium transition-colors ${
        small ? "px-3.5 text-sm" : "px-4 text-sm"
      } ${
        active
          ? "border-indigo bg-indigo-soft text-indigo"
          : "border-line bg-raised text-ink-2 shadow-[var(--shadow-xs)] hover:border-line-strong hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
