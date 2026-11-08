"use client";

// Product page: gallery, the piece's details, a buying panel that sends the
// buyer's agent to negotiate for this one piece (budget and arrive-by date),
// and the maker's story at the foot.
import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListingImage } from "@/components/ListingImage";
import { MakerAvatar } from "@/components/MakerAvatar";
import { ArrowRightIcon, ChatIcon, CheckIcon, LockIcon, PackageIcon, ShieldIcon, SparkIcon } from "@/components/Icons";

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

function ExpandIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5" />
    </svg>
  );
}

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
        <div className="panel flex flex-col items-center px-6 py-12 text-center sm:px-10">
          <span className="icon-tile h-12 w-12 bg-madder-soft text-madder">
            <PackageIcon size={22} />
          </span>
          <h1 className="title mt-4 text-2xl">We couldn&apos;t open this listing</h1>
          <p className="mt-2 max-w-md text-ink-2">{error}</p>
          <Link href="/browse" className="btn btn-secondary mt-6">
            Back to all listings
          </Link>
        </div>
      </main>
    );
  if (!item)
    return (
      <main className="page" aria-busy="true">
        <p className="sr-only" role="status">
          Loading the listing
        </p>
        <div className="mb-6 h-4 w-40 animate-pulse rounded bg-surface" />
        <div className="grid grid-cols-[minmax(0,1fr)] gap-8 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_25rem] lg:gap-12">
          <div className="space-y-3">
            <div className="aspect-square w-full animate-pulse rounded-[0.875rem] bg-surface" />
            <div className="flex gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 w-16 animate-pulse rounded-[0.625rem] bg-surface" />
              ))}
            </div>
          </div>
          <div className="space-y-4">
            <div className="h-9 w-11/12 animate-pulse rounded-lg bg-surface" />
            <div className="h-5 w-1/2 animate-pulse rounded bg-surface" />
            <div className="h-10 w-32 animate-pulse rounded-lg bg-surface" />
            <div className="h-80 animate-pulse rounded-[0.875rem] bg-surface" />
          </div>
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
      <nav aria-label="Breadcrumb" className="mb-6 flex items-center text-sm text-ink-3">
        <Link href="/browse" className="inline-flex min-h-10 items-center hover:text-ink hover:underline hover:underline-offset-4">
          All pieces
        </Link>
        <span className="mx-2 text-line-strong" aria-hidden="true">
          /
        </span>
        <span className="capitalize text-ink-2">{item.category}</span>
      </nav>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-8 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] md:gap-x-10 lg:grid-cols-[minmax(0,1fr)_25rem] lg:gap-x-14">
        {/* Photos: first everywhere */}
        <section aria-label="Photos" className="min-w-0 space-y-3 md:col-start-1 md:row-start-1">
          <div className={item.images.length > 1 ? "sm:grid sm:grid-cols-[4rem_minmax(0,1fr)] sm:gap-3" : ""}>
            <button
              type="button"
              onClick={() => image && zoom.current?.showModal()}
              className={`group relative block w-full overflow-hidden rounded-[0.875rem] border border-line bg-surface sm:col-start-2 sm:row-start-1 ${
                image ? "cursor-zoom-in" : "cursor-default"
              }`}
              aria-label={image ? "View the photo full size" : undefined}
              disabled={!image}
            >
              <ListingImage src={image} title={item.title} className="aspect-square w-full" />
              {image && (
                <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full border border-line bg-raised/95 px-3 py-1.5 text-xs font-medium text-ink shadow-[var(--shadow-sm)] transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-visible:opacity-100">
                  <ExpandIcon />
                  View full size
                </span>
              )}
              {item.stock === 1 && !sold && (
                <span className="chip chip-agreed absolute left-3 top-3 shadow-[var(--shadow-xs)]">One of a kind</span>
              )}
            </button>
            {item.images.length > 1 && (
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1 sm:col-start-1 sm:row-start-1 sm:mt-0 sm:flex-col sm:overflow-visible sm:pb-0">
                {item.images.map((src, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setPhoto(i)}
                    aria-label={`Photo ${i + 1}`}
                    aria-pressed={i === photo}
                    className={`shrink-0 overflow-hidden rounded-[0.625rem] border-2 transition-opacity ${
                      i === photo ? "border-indigo" : "border-transparent opacity-70 hover:opacity-100"
                    }`}
                  >
                    <ListingImage src={src} title={item.title} className="h-16 w-16" />
                  </button>
                ))}
              </div>
            )}
          </div>
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
        </section>

        {/* Buying panel: right column on wide screens, straight after the photo on phones */}
        <aside className="min-w-0 space-y-6 md:col-start-2 md:row-span-2 md:row-start-1 md:self-stretch" aria-label="Buy this piece">
          <div>
            <p className="eyebrow capitalize">{item.sellerCraft ?? item.category}</p>
            <h1 className="display mt-2 text-[clamp(1.75rem,3.4vw,2.375rem)]">{item.title}</h1>
            <a href="#maker" className="group mt-4 flex min-h-10 items-center gap-3 text-ink-2">
              <MakerAvatar name={item.sellerName} craft={item.sellerCraft} size="sm" />
              <span className="min-w-0 text-sm">
                By <span className="font-semibold text-ink">{item.sellerName}</span> in {madeIn}
                <span className="block text-indigo group-hover:underline group-hover:underline-offset-4">Read their story</span>
              </span>
            </a>
          </div>

          <div className="border-t border-line pt-5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="money text-[2.25rem] leading-none">{money(price)}</span>
              <span className="text-sm text-ink-3">asking price</span>
            </div>
            {!sold && <p className="hint mt-2">Your agent negotiates from this price.</p>}
          </div>

          {sold ? (
            <div className="panel p-5">
              <span className="chip">Sold</span>
              <p className="title mt-3 text-xl">This piece has found a home</p>
              <p className="mt-1 text-sm text-ink-2">{item.sellerName} may have similar work below.</p>
              <Link href="/browse" className="btn btn-secondary mt-4">
                Browse other pieces
              </Link>
            </div>
          ) : (
            <form
              id="negotiate"
              onSubmit={sendAgent}
              className="panel panel-raised scroll-mt-24 overflow-hidden md:sticky md:top-24"
            >
              <div className="flex items-start gap-3 border-b border-line bg-surface px-5 py-4">
                <span className="icon-tile">
                  <ChatIcon size={18} />
                </span>
                <div className="min-w-0">
                  <h2 className="title text-lg">Send your agent to negotiate</h2>
                  <p className="hint mt-0.5">It bargains with {item.sellerName}&apos;s agent and never goes over your budget.</p>
                </div>
              </div>

              <div className="space-y-5 p-5">
                <div>
                  <label htmlFor="budget" className="label">
                    The most you&apos;ll pay
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3">£</span>
                    <input
                      id="budget"
                      className="field money min-h-12 pl-7 text-lg"
                      inputMode="decimal"
                      value={budget}
                      onChange={(e) => setBudget(e.target.value.replace(/[^\d.]/g, ""))}
                      aria-describedby="budget-hint"
                    />
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2" role="group" aria-label="Quick budgets">
                    {[0.9, 0.8, 0.7].map((f) => {
                      const v = Math.round(price * f);
                      return (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setBudget(String(v))}
                          aria-pressed={b === v}
                          className={`flex min-h-10 flex-col items-center justify-center rounded-[0.5rem] border px-2 py-1 text-sm leading-tight transition-colors ${
                            b === v
                              ? "border-indigo bg-indigo-soft text-indigo"
                              : "border-line bg-raised text-ink hover:border-line-strong"
                          }`}
                        >
                          <span className="money">{money(v)}</span>{" "}
                          <span className={`text-xs ${b === v ? "text-indigo" : "text-ink-3"}`}>({Math.round((1 - f) * 100)}% off)</span>
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
                    className="field min-h-12"
                    min={earliest}
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    aria-describedby="deadline-hint"
                  />
                  <p id="deadline-hint" className={`mt-2 text-[0.8125rem] ${tooSoon ? "text-madder" : "text-ink-3"}`}>
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
              </div>

              <ul className="space-y-2.5 border-t border-line bg-surface px-5 py-4 text-sm text-ink-2">
                <Trust icon="lock">Your budget is never shown to the seller.</Trust>
                <Trust icon="shield">PayPal holds the money until {item.sellerName} ships.</Trust>
                <Trust icon="check">You approve the final price. Cancel any time before.</Trust>
              </ul>
            </form>
          )}
        </aside>

        <section aria-labelledby="about-heading" className="min-w-0 md:col-start-1 md:row-start-2">
          <h2 id="about-heading" className="title text-xl sm:text-2xl">
            About this piece
          </h2>
          <p className="mt-3 max-w-[40rem] leading-relaxed text-ink-2 sm:text-[1.0625rem]">{item.description}</p>
          <div className="panel mt-6 overflow-hidden">
            <h3 className="border-b border-line px-5 py-3 text-sm font-semibold">Details</h3>
            <dl className="divide-y divide-line">
              {facts.map(([k, v]) => (
                <div key={k} className="grid gap-1 px-5 py-3.5 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4">
                  <dt className="text-sm font-medium text-ink-3">{k}</dt>
                  <dd className="text-sm text-ink sm:text-[0.9375rem]">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </div>

      <CustomPiece listingId={id} sellerName={item.sellerName} />

      <MeetTheMaker item={item} />

      {/* Phone: keep the next step in reach */}
      {!sold && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-line bg-paper/95 px-4 py-3 shadow-[var(--shadow-lg)] backdrop-blur md:hidden">
          <span className="min-w-0">
            <span className="money block text-xl leading-tight">{money(price)}</span>
            <span className="block text-xs text-ink-3">asking price</span>
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
          className="m-auto max-h-[92vh] max-w-[92vw] overflow-hidden rounded-[0.875rem] border border-line bg-raised p-0 shadow-[var(--shadow-lg)] backdrop:bg-ink/70"
          aria-label={`${item.title}, full size`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt={item.title} className="block max-h-[82vh] w-auto object-contain" />
          <div className="flex items-center justify-between gap-4 border-t border-line px-4 py-3">
            <p className="hint min-w-0">{photo === 0 && item.imageCredit ? item.imageCredit : item.title}</p>
            <button type="button" className="btn btn-secondary btn-sm min-h-10" onClick={() => zoom.current?.close()}>
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
    <section aria-labelledby="custom-heading" className="panel mt-16 grid grid-cols-[minmax(0,1fr)] gap-6 p-5 sm:p-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:gap-10">
      <div>
        <span className="icon-tile">
          <SparkIcon size={18} />
        </span>
        <h2 id="custom-heading" className="title mt-4 text-xl sm:text-2xl">
          Have one made for you
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-2 sm:text-[0.9375rem]">
          A different colour, size or design. {sellerName}&apos;s agent quotes a price, {sellerName} approves it on WhatsApp, and PayPal sends you an invoice.
          You pay only if you&apos;re happy with it.
        </p>
      </div>
      {state === "sent" ? (
        <div className="notice notice-safe flex items-start gap-3 self-start">
          <CheckIcon size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Sent to {sellerName}.</p>
            <p className="mt-1 text-sm">
              You&apos;ll get the price and a PayPal invoice once they&apos;ve approved it. Follow it in{" "}
              <Link href="/orders" className="underline">
                My orders
              </Link>
              .
            </p>
          </div>
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
  const IconComponent = { lock: LockIcon, shield: ShieldIcon, check: CheckIcon }[icon];
  return (
    <li className="flex items-start gap-2.5">
      <IconComponent size={16} className="mt-0.5 shrink-0 text-leaf" />
      <span>{children}</span>
    </li>
  );
}

function MeetTheMaker({ item }: { item: Item }) {
  const money = (m: number, c: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency: c }).format(m / 100);
  return (
    <section id="maker" aria-labelledby="maker-heading" className="mt-16 scroll-mt-24">
      <h2 id="maker-heading" className="eyebrow">
        Meet the maker
      </h2>
      <div className="panel mt-4 overflow-hidden">
        <div className={`grid grid-cols-[minmax(0,1fr)] ${item.sellerPhotoUrl ? "md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]" : ""}`}>
          {item.sellerPhotoUrl && (
            <figure className="flex flex-col border-b border-line md:border-b-0 md:border-r">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.sellerPhotoUrl}
                alt={item.sellerPhotoCredit?.split(". Photo:")[0] ?? `${item.sellerCraft ?? "Craft"} in ${item.sellerCity}`}
                loading="lazy"
                className="aspect-[4/3] w-full bg-surface object-cover md:aspect-auto md:min-h-[22rem] md:flex-1"
              />
              {item.sellerPhotoCredit && (
                <figcaption className="hint border-t border-line px-5 py-3">
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

          <div className="p-5 sm:p-8">
            <div className="flex items-center gap-4">
              <MakerAvatar name={item.sellerName} craft={item.sellerCraft} />
              <div className="min-w-0">
                <p className="title text-2xl sm:text-3xl">{item.sellerName}</p>
                <p className="mt-1 text-sm text-ink-3">
                  {item.sellerCity}
                  {item.sellerRegion ? `, ${item.sellerRegion}` : ""}
                </p>
                {item.sellerCraft && <p className="chip chip-agreed mt-2">{item.sellerCraft}</p>}
              </div>
            </div>

            <p className="mt-6 max-w-[38rem] leading-relaxed text-ink-2">{item.sellerStory}</p>

            {item.sellerQuote && (
              <blockquote className="well mt-6 border-l-[3px] border-haldi p-4">
                <p className="title text-lg">&ldquo;{item.sellerQuote}&rdquo;</p>
                <footer className="hint mt-1">{item.sellerName}</footer>
              </blockquote>
            )}
          </div>
        </div>
      </div>

      {item.more.length > 0 && (
        <div className="mt-10">
          <div className="flex items-end justify-between gap-4">
            <h3 className="title text-xl">More from {item.sellerName}</h3>
            <Link href="/browse" className="link inline-flex min-h-10 items-center gap-1 text-sm">
              All pieces
              <ArrowRightIcon size={14} />
            </Link>
          </div>
          <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
            {item.more.map((m) => (
              <li key={m.id} className="min-w-0">
                <Link href={`/listing/${m.id}`} className="group block rounded-[0.875rem]">
                  <div className="overflow-hidden rounded-[0.875rem] border border-line bg-surface shadow-[var(--shadow-xs)] transition-shadow group-hover:shadow-[var(--shadow-md)]">
                    <ListingImage
                      src={m.image}
                      title={m.title}
                      className="aspect-[4/5] w-full transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none"
                    />
                  </div>
                  <p className="mt-2.5 line-clamp-2 text-sm font-medium leading-snug group-hover:underline group-hover:underline-offset-4">{m.title}</p>
                  <p className="money mt-1">{money(m.listPriceMinor, m.currency)}</p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
