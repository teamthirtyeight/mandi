"use client";

// Public catalog: what Mandi's sellers have, with photos and list prices.
import { useEffect, useState } from "react";
import Link from "next/link";
import { ListingImage } from "@/components/ListingImage";

interface Item {
  id: string;
  title: string;
  listPriceMinor: number;
  currency: string;
  image: string | null;
  sellerName: string;
  sellerCity: string;
}

export default function BrowsePage() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      fetch(`/api/catalog${q ? `?q=${encodeURIComponent(q)}` : ""}`)
        .then((r) => r.json())
        .then((b) => setItems(b.items));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const money = (m: number, c: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency: c }).format(m / 100);

  return (
    <main className="page">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-xl">
          <h1 className="display text-5xl">Handmade, haggled for you</h1>
          <p className="mt-3 text-lg text-ink-2">
            Pieces from small workshops in India. Prices are the sellers&apos; asking prices; your agent negotiates from there.
          </p>
        </div>
        <label className="w-full sm:w-80">
          <span className="sr-only">Search listings</span>
          <input
            type="search"
            className="field"
            placeholder="Search silk scarf, shawl, cushion"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search listings"
          />
        </label>
      </header>

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
          <p className="mt-2 text-ink-2">Try a broader word, like scarf or shawl, or clear the search to see everything.</p>
          <button className="btn btn-secondary mt-4" onClick={() => setQ("")}>
            Clear search
          </button>
        </div>
      ) : (
        <ul className="mt-10 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((i) => (
            <li key={i.id}>
              <Link href={`/listing/${i.id}`} className="group block rounded-2xl">
                <ListingImage src={i.image} title={i.title} className="aspect-[4/5] w-full rounded-2xl" />
                <div className="mt-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold leading-snug group-hover:underline group-hover:underline-offset-4">{i.title}</p>
                    <p className="mt-0.5 text-sm text-ink-3">
                      {i.sellerName}, {i.sellerCity}
                    </p>
                  </div>
                  <p className="money shrink-0 text-lg">{money(i.listPriceMinor, i.currency)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
