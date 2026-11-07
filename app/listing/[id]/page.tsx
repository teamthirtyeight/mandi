"use client";

// Product page: gallery, the piece's details, a buying panel that sends the
// buyer's agent to negotiate for this one piece (budget and arrive-by date),
// and the maker's story at the foot.
import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListingImage } from "@/components/ListingImage";
import { MakerAvatar } from "@/components/MakerAvatar";

interface Item {
  id: string;
  title: string;
  description: string;
  category: string;
  materials: string;
  dimensions: string | null;
  care: string | null;
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

const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const niceDate = (s: string) => new Date(`${s}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long" });

export default function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [item, setItem] = useState<Item | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState(0);
  const [budget, setBudget] = useState("");
  const [deadline, setDeadline] = useState("");
  const [busy, setBusy] = useState(false);
  const zoom = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    fetch(`/api/catalog/${id}`).then(async (r) => {
      const b = await r.json();
      if (!r.ok) return setError(b.error);
      const it: Item = b.item;
      setItem(it);
      setBudget(String(Math.round((it.listPriceMinor * 0.85) / 100)));
      // Default arrive-by: four weeks out, or a few days after the earliest arrival.
      const earliest = Date.now() + (it.shipByDays + it.transitDays) * DAY;
      setDeadline(iso(new Date(Math.max(Date.now() + 28 * DAY, earliest + 3 * DAY))));
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
      <main className="page grid gap-10 md:grid-cols-[1.15fr_1fr]" aria-busy="true">
        <div className="aspect-square w-full animate-pulse rounded-[1.25rem] bg-surface" />
        <div className="space-y-4">
          <div className="h-10 w-3/4 animate-pulse rounded-lg bg-surface" />
          <div className="h-8 w-28 animate-pulse rounded-lg bg-surface" />
          <div className="h-48 animate-pulse rounded-[1.25rem] bg-surface" />
        </div>
      </main>
    );

  const sold = item.stock <= 0 || item.status !== "active";
  const price = item.listPriceMinor / 100;
  const money = (n: number) =>
    new Intl.NumberFormat("en-GB", { style: "currency", currency: item.currency, maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n);
  const earliest = iso(new Date(Date.now() + (item.shipByDays + item.transitDays) * DAY));
  const b = Number(budget);
  const tooSoon = deadline !== "" && deadline < earliest;
  const madeIn = `${item.sellerCity}${item.sellerRegion ? `, ${item.sellerRegion}` : ""}`;
  const image = item.images[photo] ?? null;

  const facts: [string, string][] = [
    ["Made in", madeIn],
    ...(item.sellerCraft ? ([["Craft", item.sellerCraft]] as [string, string][]) : []),
    ["Materials", item.materials],
    ...(item.dimensions ? ([["Size", item.dimensions]] as [string, string][]) : []),
    ...(item.care ? ([["Care", item.care]] as [string, string][]) : []),
    ["Delivery", `Ships within ${item.shipByDays} days from India; arrives in about ${item.shipByDays + item.transitDays} days.`],
  ];

  return (
    <main className="page pb-28 md:pb-24">
      <nav aria-label="Breadcrumb" className="mb-5 text-sm text-ink-3">
        <Link href="/browse" className="hover:text-ink hover:underline">
          All pieces
        </Link>
        <span className="mx-2" aria-hidden="true">
          /
        </span>
        <span className="capitalize">{item.category}</span>
      </nav>

      <div className="grid items-start gap-10 md:grid-cols-[1.15fr_1fr] md:gap-x-10 lg:gap-x-14">
        {/* Photos: first everywhere */}
          <section aria-label="Photos" className="space-y-3 md:col-start-1 md:row-start-1">
            <button
              type="button"
              onClick={() => image && zoom.current?.showModal()}
              className={`group relative block w-full overflow-hidden rounded-[1.25rem] bg-surface ${image ? "cursor-zoom-in" : "cursor-default"}`}
              aria-label={image ? "View the photo full size" : undefined}
              disabled={!image}
            >
              <ListingImage src={image} title={item.title} className="aspect-square w-full" />
              {image && (
                <span className="chip absolute bottom-3 right-3 bg-raised/90 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  View full size
                </span>
              )}
            </button>
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


        {/* Buying panel: right column on wide screens, straight after the photo on phones */}
        <aside className="space-y-5 md:col-start-2 md:row-span-2 md:row-start-1 md:self-stretch" aria-label="Buy this piece">
          <div>
            {item.stock === 1 && !sold && <span className="chip chip-agreed mb-3">One of a kind</span>}
            <h1 className="display text-[clamp(2rem,4vw,2.75rem)]">{item.title}</h1>
            <a href="#maker" className="mt-3 flex items-center gap-2.5 text-ink-2 hover:text-ink">
              <MakerAvatar name={item.sellerName} craft={item.sellerCraft} size="sm" />
              <span>
                By <span className="font-semibold text-ink">{item.sellerName}</span> in {madeIn}
                <span className="block text-sm text-ink-3 underline underline-offset-2">Read their story</span>
              </span>
            </a>
          </div>

          <div className="flex items-baseline gap-3">
            <span className="money text-4xl">{money(price)}</span>
            <span className="text-ink-3">asking price</span>
          </div>

          {sold ? (
            <div className="panel p-5">
              <p className="title text-xl">Sold</p>
              <p className="mt-1 text-ink-2">This piece has found a home. {item.sellerName} may have similar work below.</p>
              <Link href="/browse" className="btn btn-secondary btn-sm mt-4">
                Browse other pieces
              </Link>
            </div>
          ) : (
            <form id="negotiate" onSubmit={sendAgent} className="panel scroll-mt-24 space-y-5 p-5 md:sticky md:top-24">
              <div>
                <h2 className="title text-xl">Send your agent to negotiate</h2>
                <p className="hint mt-1">It bargains with {item.sellerName}&apos;s agent and never goes over your budget.</p>
              </div>

              <div>
                <label htmlFor="budget" className="label">
                  The most you&apos;ll pay
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3">£</span>
                  <input
                    id="budget"
                    className="field money pl-7 text-lg"
                    inputMode="decimal"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value.replace(/[^\d.]/g, ""))}
                    aria-describedby="budget-hint"
                  />
                </div>
                <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Quick budgets">
                  {[0.9, 0.8, 0.7].map((f) => {
                    const v = Math.round(price * f);
                    return (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setBudget(String(v))}
                        aria-pressed={b === v}
                        className={`rounded-full border px-3 py-1 text-sm ${
                          b === v ? "border-indigo bg-indigo-soft text-indigo" : "border-line text-ink-2 hover:border-line-strong"
                        }`}
                      >
                        <span className="money">{money(v)}</span> <span className="text-ink-3">({Math.round((1 - f) * 100)}% off)</span>
                      </button>
                    );
                  })}
                </div>
                <p id="budget-hint" className="hint mt-2">
                  {b > price
                    ? "That's above the asking price. Your agent will still try to pay less."
                    : b > 0 && b < price * 0.6
                      ? "A budget this low rarely reaches a deal, but your agent will try."
                      : "Kept private: the seller's agent never sees it."}
                </p>
              </div>

              <div>
                <label htmlFor="deadline" className="label">
                  Arrive by
                </label>
                <input
                  id="deadline"
                  type="date"
                  className="field"
                  min={earliest}
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  aria-describedby="deadline-hint"
                />
                <p id="deadline-hint" className={`mt-2 text-sm ${tooSoon ? "text-madder" : "text-ink-3"}`}>
                  {tooSoon ? `It can't arrive before ${niceDate(earliest)}. Pick a later date.` : `Earliest arrival: ${niceDate(earliest)}.`}
                </p>
              </div>

              <button disabled={busy || !(b > 0) || tooSoon} className="btn btn-primary btn-lg w-full">
                {busy ? "Sending your agent…" : "Negotiate for me"}
              </button>
              {error && (
                <p role="alert" className="notice notice-bad text-sm">
                  {error}
                </p>
              )}

              <ul className="space-y-2 border-t border-line pt-4 text-sm text-ink-2">
                <Trust icon="lock">Your budget is never shown to the seller.</Trust>
                <Trust icon="shield">PayPal holds the money until {item.sellerName} ships.</Trust>
                <Trust icon="check">You approve the final price. Cancel any time before.</Trust>
              </ul>
            </form>
          )}
        </aside>

          <section aria-labelledby="about-heading" className="md:col-start-1 md:row-start-2">
            <h2 id="about-heading" className="title text-2xl">
              About this piece
            </h2>
            <p className="mt-3 max-w-[40rem] text-lg leading-relaxed text-ink-2">{item.description}</p>
            <dl className="mt-6 divide-y divide-line border-y border-line">
              {facts.map(([k, v]) => (
                <div key={k} className="grid gap-1 py-3 sm:grid-cols-[8rem_1fr] sm:gap-4">
                  <dt className="text-sm font-semibold text-ink-3">{k}</dt>
                  <dd className="text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
      </div>

      <CustomPiece listingId={id} sellerName={item.sellerName} />

      <MeetTheMaker item={item} />

      {/* Phone: keep the next step in reach */}
      {!sold && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur md:hidden">
          <span>
            <span className="money text-xl">{money(price)}</span> <span className="text-sm text-ink-3">asking</span>
          </span>
          <a href="#negotiate" className="btn btn-primary">
            Send my agent
          </a>
        </div>
      )}

      {image && (
        <dialog
          ref={zoom}
          onClick={(e) => e.target === zoom.current && zoom.current?.close()}
          className="m-auto max-h-[92vh] max-w-[92vw] rounded-[1.25rem] bg-raised p-0 backdrop:bg-ink/70"
          aria-label={`${item.title}, full size`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt={item.title} className="block max-h-[85vh] w-auto object-contain" />
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <p className="hint">{photo === 0 && item.imageCredit ? item.imageCredit : item.title}</p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => zoom.current?.close()}>
              Close
            </button>
          </div>
        </dialog>
      )}
    </main>
  );
}

/** Made to order: the seller's agent quotes, the artisan approves, PayPal sends an invoice. */
function CustomPiece({ listingId, sellerName }: { listingId: string; sellerName: string }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent" | "login">("idle");
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    setError(null);
    const res = await fetch("/api/commissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listingId, request: text }),
    });
    if (res.status === 401 || res.status === 403) return setState("login");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setState("idle");
      return setError(body.error ?? "That didn't go through. Try again.");
    }
    setState("sent");
  }

  return (
    <section aria-labelledby="custom-heading" className="mt-16 grid gap-6 rounded-[1.25rem] border border-line p-5 sm:p-8 md:grid-cols-[1fr_1.2fr]">
      <div>
        <h2 id="custom-heading" className="title text-2xl">
          Have one made for you
        </h2>
        <p className="mt-2 text-ink-2">
          A different colour, size or design. {sellerName}&apos;s agent quotes a price, {sellerName} approves it on WhatsApp, and PayPal sends you an invoice.
          You pay only if you&apos;re happy with it.
        </p>
      </div>
      {state === "sent" ? (
        <div className="notice notice-safe self-start">
          <p className="font-semibold">Sent to {sellerName}.</p>
          <p className="mt-1">
            You&apos;ll get the price and a PayPal invoice once they&apos;ve approved it. Follow it in{" "}
            <Link href="/orders" className="underline">
              My orders
            </Link>
            .
          </p>
        </div>
      ) : (
        <form onSubmit={send} className="space-y-3">
          <label htmlFor="custom-request" className="label">
            What should {sellerName} make?
          </label>
          <textarea
            id="custom-request"
            className="field"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="The same weave in emerald green, 2 metres long, for my sister's wedding."
          />
          {error && <p className="notice notice-bad text-sm">{error}</p>}
          {state === "login" && (
            <p className="notice text-sm">
              <Link href={`/login?next=/listing/${listingId}`} className="font-semibold underline">
                Log in as a buyer
              </Link>{" "}
              to ask for a custom piece.
            </p>
          )}
          <button className="btn btn-secondary" disabled={state === "busy" || text.trim().length < 10}>
            {state === "busy" ? "Asking…" : `Ask ${sellerName}`}
          </button>
        </form>
      )}
    </section>
  );
}

function Trust({ icon, children }: { icon: "lock" | "shield" | "check"; children: React.ReactNode }) {
  const path = {
    lock: "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z",
    shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
    check: "M5 12.5l4.5 4.5L19 7.5",
  }[icon];
  return (
    <li className="flex items-start gap-2.5">
      <svg className="mt-0.5 shrink-0 text-leaf" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={path} />
      </svg>
      <span>{children}</span>
    </li>
  );
}

function MeetTheMaker({ item }: { item: Item }) {
  const money = (m: number, c: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency: c }).format(m / 100);
  return (
    <section id="maker" aria-labelledby="maker-heading" className="mt-20 scroll-mt-24 border-t border-line pt-12">
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
