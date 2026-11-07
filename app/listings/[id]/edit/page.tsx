"use client";

// Seller edits one of their listings: text, prices, private floor and refund
// cap, stock, and whether it's on sale.
import { use, useEffect, useState } from "react";
import Link from "next/link";

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
          <h1 className="title text-2xl">{error}</h1>
          <p className="mt-2 text-ink-2">Only the seller who listed this piece can edit it.</p>
          <Link href={`/login?next=/listings/${id}/edit`} className="btn btn-primary mt-5">
            Log in as the seller
          </Link>
        </div>
      </main>
    );
  if (!l)
    return (
      <main className="page-narrow">
        <p className="text-ink-3" role="status">
          Loading…
        </p>
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
    <main className="page-narrow space-y-6">
      <Link href="/dashboard" className="link text-sm">
        Back to dashboard
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="title text-4xl">Edit listing</h1>
        <span className={`chip ${st.tone}`}>{st.label}</span>
      </header>
      {st.note && <p className="-mt-3 text-ink-2">{st.note}</p>}

      <section className="panel space-y-5 p-5 sm:p-7">
        <h2 className="title text-xl">Listing</h2>
        <div>
          <label className="label" htmlFor="title">
            Title
          </label>
          <input id="title" className="field title text-xl" value={l.title} onChange={set("title")} aria-label="Title" />
        </div>
        <div>
          <label className="label" htmlFor="description">
            Description
          </label>
          <textarea id="description" className="field" rows={4} value={l.description} onChange={set("description")} aria-label="Description" />
        </div>
        <div>
          <label className="label" htmlFor="materials">
            Materials
          </label>
          <input id="materials" className="field" value={l.materials} onChange={set("materials")} aria-label="Materials" />
        </div>
      </section>

      <section className="panel space-y-5 p-5 sm:p-7">
        <div>
          <h2 className="title text-xl">Prices and stock</h2>
          <p className="hint mt-1">Only the list price is public. Changes apply to new negotiations.</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="list">
              List price (£)
            </label>
            <input id="list" className="field money" type="number" min={1} value={l.listPrice} onChange={set("listPrice")} />
          </div>
          <div>
            <label className="label" htmlFor="floor">
              Lowest you&apos;ll accept (£)
            </label>
            <input id="floor" className="field money" type="number" min={1} value={l.floorPrice} onChange={set("floorPrice")} />
            <p className="hint mt-1">Private. Buyers never see it.</p>
          </div>
          <div>
            <label className="label" htmlFor="cap">
              Refund your agent can give (£)
            </label>
            <input id="cap" className="field money" type="number" min={0} value={l.refundCap ?? ""} onChange={set("refundCap")} placeholder="Your default" />
            <p className="hint mt-1">Leave blank to use your default from My agent.</p>
          </div>
          <div>
            <label className="label" htmlFor="stock">
              In stock
            </label>
            <input id="stock" className="field money" type="number" min={0} value={l.stock} onChange={set("stock")} />
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => save()} disabled={busy} className="btn btn-primary btn-lg">
          {busy ? "Saving…" : "Save changes"}
        </button>
        {l.status === "paused" ? (
          <button onClick={() => save("active")} disabled={busy} className="btn btn-secondary btn-lg">
            Put back on sale
          </button>
        ) : (
          <button onClick={() => save("paused")} disabled={busy} className="btn btn-secondary btn-lg">
            Pause listing
          </button>
        )}
      </div>
      {saved && (
        <p role="status" className="notice notice-safe">
          Saved. New negotiations use these values.
        </p>
      )}
      {error && (
        <p role="alert" className="notice notice-bad">
          {error}
        </p>
      )}
    </main>
  );
}
