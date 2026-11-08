"use client";

// Seller edits one of their listings: text, prices, private floor and refund
// cap, stock, and whether it's on sale.
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { CheckIcon, LockIcon, PackageIcon, RefundIcon } from "@/components/Icons";

interface Listing {
  id: string;
  title: string;
  description: string;
  materials: string;
  listPrice: number;
  floorPrice: number;
  refundCap: number | null;
  stock: number;
  status: string;
}

const BackIcon = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </svg>
);

function MoneyInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <span className="money pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden="true">
        £
      </span>
      <input {...props} className="field money pl-8" />
    </div>
  );
}

export default function EditListing({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [l, setL] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/listings/${id}`).then(async (r) => {
      const b = await r.json();
      if (!r.ok) setError(b.error);
      else setL(b.listing);
    });
  }, [id]);

  async function save(status?: "active" | "paused") {
    if (!l) return;
    setBusy(true);
    setSaved(false);
    setError(null);
    const res = await fetch(`/api/listings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...l, status: status ?? (l.status === "paused" ? "paused" : "active") }),
    });
    const b = await res.json();
    setBusy(false);
    if (!res.ok) return setError(b.error);
    setL(b.listing);
    setSaved(true);
  }

  if (error && !l)
    return (
      <main className="page-narrow">
        <div className="panel p-6 sm:p-8">
          <span className="icon-tile bg-madder-soft text-madder" aria-hidden="true">
            <LockIcon size={18} />
          </span>
          <h1 className="title mt-4 text-2xl">{error}</h1>
          <p className="mt-2 text-ink-2">Only the seller who listed this piece can edit it.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href={`/login?next=/listings/${id}/edit`} className="btn btn-primary">
              Log in as the seller
            </Link>
            <Link href="/dashboard" className="btn btn-secondary">
              Back to dashboard
            </Link>
          </div>
        </div>
      </main>
    );
  if (!l)
    return (
      <main className="page" aria-busy="true">
        <p className="sr-only" role="status">
          Loading…
        </p>
        <div className="animate-pulse space-y-6" aria-hidden="true">
          <div className="h-4 w-32 rounded bg-surface" />
          <div className="h-9 w-56 rounded-lg bg-surface" />
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="space-y-6">
              <div className="panel h-80" />
              <div className="panel h-56" />
            </div>
            <div className="panel h-64" />
          </div>
        </div>
      </main>
    );
  const set = (k: keyof Listing) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setL({ ...l, [k]: typeof l[k] === "number" || k === "refundCap" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value });
  const STATUS: Record<string, { label: string; tone: string; note: string }> = {
    active: { label: "On sale", tone: "chip-safe", note: "Your agent is answering buyers for this piece." },
    paused: { label: "Paused", tone: "", note: "Buyers' agents can't find it until you put it back on sale." },
    sold: { label: "Sold out", tone: "chip-agreed", note: "Add stock to put it back on sale." },
  };
  const st = STATUS[l.status] ?? { label: l.status, tone: "", note: "" };

  return (
    <main className="page">
      <Link href="/dashboard" className="btn btn-quiet btn-sm -ml-2.5 min-h-10 text-sm">
        <BackIcon />
        Back to dashboard
      </Link>
      <header className="mt-2 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-6">
        <div className="min-w-0">
          <p className="eyebrow">Listing</p>
          <h1 className="title mt-1 text-3xl sm:text-4xl">Edit listing</h1>
          <p className="mt-1 truncate text-sm text-ink-3">{l.title}</p>
        </div>
        <span className={`chip ${st.tone}`}>{st.label}</span>
      </header>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <section className="panel">
            <div className="panel-head">
              <h2 className="title text-lg">Listing</h2>
            </div>
            <div className="space-y-5 p-5 sm:p-6">
              <div>
                <label className="label" htmlFor="title">
                  Title
                </label>
                <input id="title" className="field font-medium" value={l.title} onChange={set("title")} aria-label="Title" />
              </div>
              <div>
                <label className="label" htmlFor="description">
                  Description
                </label>
                <textarea id="description" className="field" rows={6} value={l.description} onChange={set("description")} aria-label="Description" />
                <p className="hint mt-1.5">Buyers&apos; agents read this when they compare pieces.</p>
              </div>
              <div>
                <label className="label" htmlFor="materials">
                  Materials
                </label>
                <input id="materials" className="field" value={l.materials} onChange={set("materials")} aria-label="Materials" />
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2 className="title text-lg">Prices and stock</h2>
                <p className="hint mt-0.5">Only the list price is public. Changes apply to new negotiations.</p>
              </div>
            </div>
            <div className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
              <div>
                <label className="label" htmlFor="list">
                  List price (£)
                </label>
                <MoneyInput id="list" type="number" min={1} value={l.listPrice} onChange={set("listPrice")} />
                <p className="hint mt-1.5">What buyers see.</p>
              </div>
              <div>
                <label className="label flex items-center gap-1.5" htmlFor="floor">
                  <LockIcon size={14} className="text-ink-3" />
                  Lowest you&apos;ll accept (£)
                </label>
                <MoneyInput id="floor" type="number" min={1} value={l.floorPrice} onChange={set("floorPrice")} />
                <p className="hint mt-1.5">Private. Buyers never see it.</p>
              </div>
              <div>
                <label className="label flex items-center gap-1.5" htmlFor="cap">
                  <RefundIcon size={14} className="text-ink-3" />
                  Refund your agent can give (£)
                </label>
                <MoneyInput id="cap" type="number" min={0} value={l.refundCap ?? ""} onChange={set("refundCap")} placeholder="Your default" />
                <p className="hint mt-1.5">Leave blank to use your default from My agent.</p>
              </div>
              <div>
                <label className="label flex items-center gap-1.5" htmlFor="stock">
                  <PackageIcon size={14} className="text-ink-3" />
                  In stock
                </label>
                <input id="stock" className="field money" type="number" min={0} value={l.stock} onChange={set("stock")} />
              </div>
            </div>
          </section>
        </div>

        <aside className="min-w-0 lg:sticky lg:top-6">
          <section className="panel panel-raised">
            <div className="panel-head">
              <h2 className="text-sm font-semibold">Status</h2>
              <span className={`chip ${st.tone}`}>{st.label}</span>
            </div>
            <div className="space-y-4 p-5">
              {st.note && <p className="text-sm text-ink-2">{st.note}</p>}
              <dl className="well grid grid-cols-2 gap-3 px-4 py-3">
                <div>
                  <dt className="stat-label">List price</dt>
                  <dd className="stat-value mt-0.5">£{l.listPrice || 0}</dd>
                </div>
                <div>
                  <dt className="stat-label">In stock</dt>
                  <dd className="stat-value mt-0.5">{l.stock ?? 0}</dd>
                </div>
              </dl>
            </div>
            <div className="space-y-3 border-t border-line bg-surface/60 p-5">
              {saved && (
                <p role="status" className="notice notice-safe flex items-start gap-2 text-sm">
                  <CheckIcon size={16} className="mt-0.5 shrink-0" />
                  Saved. New negotiations use these values.
                </p>
              )}
              {error && (
                <p role="alert" className="notice notice-bad text-sm">
                  {error}
                </p>
              )}
              <button onClick={() => save()} disabled={busy} className="btn btn-primary btn-lg w-full">
                {busy ? "Saving…" : "Save changes"}
              </button>
              {l.status === "paused" ? (
                <button onClick={() => save("active")} disabled={busy} className="btn btn-secondary w-full">
                  Put back on sale
                </button>
              ) : (
                <button onClick={() => save("paused")} disabled={busy} className="btn btn-secondary w-full">
                  Pause listing
                </button>
              )}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
