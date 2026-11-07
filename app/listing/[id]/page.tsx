"use client";

// Product page: photos, the seller's story, list price, and "send my agent"
// for this one item with a budget and deadline.
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListingImage } from "@/components/ListingImage";
import { swatchStyle } from "@/lib/swatch";

interface Item {
  id: string;
  title: string;
  description: string;
  materials: string;
  listPriceMinor: number;
  currency: string;
  images: string[];
  imageCredit: string | null;
  imageSource: string | null;
  stock: number;
  status: string;
  sellerName: string;
  sellerCity: string;
  sellerStory: string;
  shipByDays: number;
  transitDays: number;
  sellerRegion: string | null;
  sellerCraft: string | null;
  sellerQuote: string | null;
  sellerPhotoUrl: string | null;
  sellerPhotoCredit: string | null;
  sellerPhotoSource: string | null;
  more: { id: string; title: string; listPriceMinor: number; currency: string; image: string | null }[];
}

export default function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [item, setItem] = useState<Item | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState(0);
  const [budget, setBudget] = useState("");
  const [deadline, setDeadline] = useState(() => new Date(Date.now() + 28 * 86400000).toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/catalog/${id}`).then(async (r) => {
      const b = await r.json();
      if (!r.ok) return setError(b.error);
      setItem(b.item);
      setBudget(String(Math.round((b.item.listPriceMinor * 0.9) / 100)));
    });
  }, [id]);

  async function sendAgent(e: React.FormEvent) {
    e.preventDefault();
    if (!item) return;
    setBusy(true);
    setError(null);
    const requestText = `${item.title}, under £${budget}, by ${new Date(deadline).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
    const res = await fetch("/api/mandates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestText, listingId: item.id }),
    });
    const m = await res.json();
    if (res.status === 401) return router.push(`/login?next=/listing/${id}`);
    if (!res.ok) {
      setBusy(false);
      return setError(m.error);
    }
    const c = await fetch(`/api/mandates/${m.id}/confirm`, { method: "POST" });
    if (!c.ok) {
      setBusy(false);
      return setError((await c.json()).error);
    }
    router.push(`/deal/${m.id}`);
  }

  if (error && !item)
    return (
      <main className="page-narrow">
        <div className="panel p-8">
          <h1 className="title text-2xl">We couldn&apos;t open this listing</h1>
          <p className="mt-2 text-ink-2">{error}</p>
          <Link href="/browse" className="btn btn-secondary mt-6">
            Back to all listings
          </Link>
        </div>
      </main>
    );
  if (!item)
    return (
      <main className="page grid gap-10 md:grid-cols-2" aria-busy="true">
        <div className="aspect-square w-full animate-pulse rounded-[1.25rem] bg-surface" />
        <div className="space-y-4">
          <div className="h-10 w-3/4 animate-pulse rounded-lg bg-surface" />
          <div className="h-8 w-28 animate-pulse rounded-lg bg-surface" />
          <div className="h-24 animate-pulse rounded-lg bg-surface" />
        </div>
      </main>
    );
  const money = (m: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: item.currency }).format(m / 100);
  const sold = item.stock <= 0 || item.status !== "active";

  return (
    <main className="page">
      <Link href="/browse" className="btn btn-quiet btn-sm -ml-2 mb-4">
        <span aria-hidden="true">&larr;</span> All listings
      </Link>
      <div className="grid gap-10 md:grid-cols-[1.1fr_1fr]">
        <section className="space-y-3">
          <ListingImage src={item.images[photo] ?? null} title={item.title} className="aspect-square w-full rounded-[1.25rem] bg-surface" />
          {photo === 0 && item.imageCredit && (
            <p className="hint">
              {item.imageCredit}
              {item.imageSource && (
                <>
                  {", "}
                  <a href={item.imageSource} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                    Wikimedia Commons
                  </a>
                </>
              )}
            </p>
          )}
          {item.images.length > 1 && (
            <div className="flex gap-2">
              {item.images.map((src, i) => (
                <button
                  key={i}
                  onClick={() => setPhoto(i)}
                  aria-label={`Photo ${i + 1}`}
                  aria-pressed={i === photo}
                  className={`overflow-hidden rounded-xl border-2 ${i === photo ? "border-indigo" : "border-transparent"}`}
                >
                  <ListingImage src={src} title={item.title} className="h-16 w-16" />
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-6">
          <div>
            <h1 className="display text-[clamp(2rem,4vw,2.75rem)]">{item.title}</h1>
            <p className="mt-3 flex items-baseline gap-3">
              <span className="money text-3xl">{money(item.listPriceMinor)}</span>
              <span className="text-ink-3">list price</span>
            </p>
          </div>
          <div className="space-y-2 text-ink-2">
            <p>{item.description}</p>
            <p className="text-sm">
              <span className="font-semibold text-ink">Materials:</span> {item.materials}
            </p>
          </div>

          <div className="flex items-center gap-3 border-y border-line py-4">
            <MakerAvatar name={item.sellerName} craft={item.sellerCraft} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                Made by {item.sellerName} in {item.sellerCity}
                {item.sellerRegion ? `, ${item.sellerRegion}` : ""}
              </p>
              <p className="hint">
                Ships within {item.shipByDays} days and arrives in about {item.shipByDays + item.transitDays} days.
              </p>
            </div>
            <a href="#maker" className="link shrink-0 text-sm">
              Their story
            </a>
          </div>

          {sold ? (
            <div className="panel p-5">
              <p className="title text-xl">Sold</p>
              <p className="mt-1 text-ink-2">This piece has found a home. Browse other work from small sellers.</p>
              <Link href="/browse" className="btn btn-secondary btn-sm mt-4">
                Browse listings
              </Link>
            </div>
          ) : (
            <form onSubmit={sendAgent} className="panel space-y-4 p-5">
              <div>
                <h2 className="title text-xl">Send your agent to negotiate</h2>
                <p className="hint mt-1">It bargains with {item.sellerName}&apos;s agent and never goes over your budget.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="budget" className="label">
                    Your budget (£)
                  </label>
                  <input id="budget" className="field money" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="deadline" className="label">
                    Arrive by
                  </label>
                  <input id="deadline" type="date" className="field" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
                </div>
              </div>
              <button disabled={busy || !(Number(budget) > 0)} className="btn btn-primary btn-lg w-full">
                {busy ? "Sending your agent…" : "Negotiate for me"}
              </button>
              <p className="hint">Your budget stays private. Nothing is paid until you approve a deal.</p>
            </form>
          )}
          {error && (
            <p role="alert" className="notice notice-bad">
              {error}
            </p>
          )}
        </section>
      </div>

      <MeetTheMaker item={item} />
    </main>
  );
}

// Woven-swatch avatar with the maker's initial (the makers are fictional, so
// no portrait photos; a real seller's photo could go here instead).
function MakerAvatar({ name, craft, size = "lg" }: { name: string; craft: string | null; size?: "sm" | "lg" }) {
  return (
    <span
      aria-hidden="true"
      className={`display flex shrink-0 items-center justify-center rounded-full text-white ring-4 ring-paper ${
        size === "sm" ? "h-11 w-11 text-lg" : "h-20 w-20 text-3xl"
      }`}
      style={swatchStyle(`${name} ${craft ?? ""}`)}
    >
      {name.charAt(0)}
    </span>
  );
}

function MeetTheMaker({ item }: { item: Item }) {
  const money = (m: number, c: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency: c }).format(m / 100);
  return (
    <section id="maker" aria-labelledby="maker-heading" className="mt-16 scroll-mt-24 border-t border-line pt-12">
      <div className={`grid items-start gap-10 ${item.sellerPhotoUrl ? "md:grid-cols-[1fr_1.1fr]" : ""}`}>
        {item.sellerPhotoUrl && (
          <figure>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.sellerPhotoUrl}
              alt={item.sellerPhotoCredit?.split(". Photo:")[0] ?? `${item.sellerCraft ?? "Craft"} in ${item.sellerCity}`}
              loading="lazy"
              className="aspect-[4/3] w-full rounded-[1.25rem] bg-surface object-cover"
            />
            {item.sellerPhotoCredit && (
              <figcaption className="hint mt-2">
                {item.sellerPhotoCredit}
                {item.sellerPhotoSource && (
                  <>
                    {", "}
                    <a href={item.sellerPhotoSource} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                      Wikimedia Commons
                    </a>
                  </>
                )}
              </figcaption>
            )}
          </figure>
        )}

        <div>
          <h2 id="maker-heading" className="text-ink-3">
            Meet the maker
          </h2>
          <div className="mt-3 flex items-center gap-4">
            <MakerAvatar name={item.sellerName} craft={item.sellerCraft} />
            <div>
              <p className="display text-4xl">{item.sellerName}</p>
              <p className="mt-1 text-ink-2">
                {item.sellerCity}
                {item.sellerRegion ? `, ${item.sellerRegion}` : ""}
              </p>
            </div>
          </div>
          {item.sellerCraft && <p className="chip chip-agreed mt-4">{item.sellerCraft}</p>}

          <p className="mt-5 max-w-[38rem] text-lg leading-relaxed text-ink-2">{item.sellerStory}</p>

          {item.sellerQuote && (
            <blockquote className="mt-6 border-l-4 border-haldi pl-4">
              <p className="title text-xl">&ldquo;{item.sellerQuote}&rdquo;</p>
              <footer className="hint mt-1">{item.sellerName}</footer>
            </blockquote>
          )}

          {item.more.length > 0 && (
            <div className="mt-8">
              <h3 className="font-semibold">More from {item.sellerName}</h3>
              <ul className="mt-3 grid grid-cols-3 gap-3">
                {item.more.map((m) => (
                  <li key={m.id}>
                    <Link href={`/listing/${m.id}`} className="group block">
                      <ListingImage src={m.image} title={m.title} className="aspect-square w-full rounded-xl" />
                      <p className="mt-1.5 line-clamp-2 text-sm leading-snug group-hover:underline">{m.title}</p>
                      <p className="money text-sm">{money(m.listPriceMinor, m.currency)}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
