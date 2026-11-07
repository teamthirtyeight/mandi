"use client";

// Seller onboarding: photos + a voice note (any language), then the seller agent
// writes the listing, Channel3 suggests a price range, the seller sets a
// private floor and publishes (PayPal catalog product via the Agent Toolkit).
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface Me {
  name: string;
  role: "buyer" | "seller";
}
interface Draft {
  transcript: string | null;
  listing: { title: string; description: string; category: string; materials: string; search_query: string };
  images: string[];
  comps: {
    count: number;
    lowMinor: number;
    medianMinor: number;
    highMinor: number;
    samples: { title: string; priceMinor: number }[];
  } | null;
  suggested: { listPrice: number; floorLow: number; floorHigh: number } | null;
}

const gbp = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

export default function SellPage() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [photos, setPhotos] = useState<File[]>([]);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [recording, setRecording] = useState(false);
  const [notes, setNotes] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [listPrice, setListPrice] = useState(0);
  const [floor, setFloor] = useState(0);
  const [refundCap, setRefundCap] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<{ id?: string; title: string; paypalProductId: string | null } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((b) => setMe(b.user));
  }, []);

  async function toggleRecording() {
    if (recording) {
      recorder.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        setAudio(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
        stream.getTracks().forEach((t) => t.stop());
      };
      rec.start();
      recorder.current = rec;
      setRecording(true);
    } catch {
      setError("Microphone not available. Upload an audio file or type notes instead.");
    }
  }

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDraft(null);
    setPublished(null);
    const form = new FormData();
    form.set("notes", notes);
    photos.forEach((p) => form.append("photos", p));
    if (audio) form.set("audio", new File([audio], "voice-note.webm", { type: audio.type }));
    const res = await fetch("/api/sell/draft", { method: "POST", body: form });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) return setError(body.error);
    setDraft(body);
    // Comparable prices are shown as guidance only: online comps for handmade
    // goods often include luxury brands, so they never set the seller's price.
    setListPrice(0);
    setFloor(0);
  }

  async function publish() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/sell/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: draft.listing.title,
        description: draft.listing.description,
        category: draft.listing.category,
        materials: draft.listing.materials,
        images: draft.images,
        listPrice,
        floorPrice: floor,
        refundCap,
        comps: draft.comps,
      }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) return setError(body.error);
    setPublished(body);
  }

  const edit = (field: keyof Draft["listing"], value: string) =>
    setDraft((d) => (d ? { ...d, listing: { ...d.listing, [field]: value } } : d));

  if (me === undefined)
    return (
      <main className="page-narrow">
        <p className="text-ink-3">Loading…</p>
      </main>
    );
  if (!me || me.role !== "seller") {
    return (
      <main className="page-narrow">
        <div className="panel p-6 sm:p-8">
          <h1 className="title text-3xl">Sell on Mandi</h1>
          <p className="mt-3 text-ink-2">
            Listing needs a seller account. Log in, or create one in a minute: you&apos;ll need your PayPal email so buyers can pay you.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/signup?role=seller" className="btn btn-primary">
              Create a seller account
            </Link>
            <Link href="/login?next=/sell" className="btn btn-secondary">
              Log in
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (published) {
    return (
      <main className="page-narrow">
        <div className="panel overflow-hidden">
          <div className="bg-haldi-soft px-6 py-5 sm:px-8">
            <span className="chip chip-agreed">Published</span>
            <h1 className="title mt-3 text-3xl">{published.title} is live</h1>
          </div>
          <div className="space-y-4 px-6 py-6 sm:px-8">
            <p className="text-ink-2">
              Your agent will now answer buyers&apos; agents for this piece, never going below your floor price. You&apos;ll get a
              notification when it agrees a sale.
            </p>
            <p className="hint">
              {published.paypalProductId
                ? `Added to your PayPal catalog as product ${published.paypalProductId}.`
                : "The PayPal catalog product wasn't created. Check the PayPal keys; the listing is live either way."}
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Link href="/dashboard" className="btn btn-primary">
                Go to dashboard
              </Link>
              {published.id && (
                <Link href={`/listing/${published.id}`} className="btn btn-secondary">
                  View the listing
                </Link>
              )}
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => {
                  setPublished(null);
                  setDraft(null);
                  setPhotos([]);
                  setAudio(null);
                  setNotes("");
                }}
              >
                List another piece
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const step = draft ? 2 : 1;
  const priceReady = listPrice > 0 && floor > 0;

  return (
    <main className="page-narrow space-y-8">
      <header>
        <h1 className="title text-4xl">List a new piece</h1>
        <p className="mt-2 text-lg text-ink-2">Add photos and tell us about it in any language. Your agent writes the listing and sells it for you.</p>
      </header>

      <ol className="flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-label="Steps">
        {["Show the piece", "Check the listing", "Set your prices"].map((label, i) => {
          const n = i + 1;
          const state = n < step || (n === 3 && priceReady) ? "done" : n === step || (n === 3 && draft) ? "current" : "todo";
          return (
            <li key={label} className="flex items-center gap-2" aria-current={state === "current" ? "step" : undefined}>
              <span
                className={`money flex h-7 w-7 items-center justify-center rounded-full text-sm ${
                  state === "todo" ? "border border-line-strong text-ink-3" : state === "done" ? "bg-leaf text-paper" : "bg-indigo text-on-indigo"
                }`}
              >
                {n}
              </span>
              <span className={state === "todo" ? "text-ink-3" : "font-semibold"}>{label}</span>
            </li>
          );
        })}
      </ol>

      <form onSubmit={generate} className="panel space-y-6 p-5 sm:p-7">
        <div>
          <h2 className="title text-xl">1. Show the piece</h2>
          <p className="hint mt-1">Clear photos in daylight work best. The voice note can be in Hindi or any language.</p>
        </div>

        <div>
          <label className="label" htmlFor="photos">
            Photos <span className="font-normal text-ink-3">(1 to 3)</span>
          </label>
          <label
            htmlFor="photos"
            className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-line-strong bg-surface px-4 py-6 text-center hover:border-indigo"
          >
            <span className="font-semibold text-indigo">{photos.length ? "Choose different photos" : "Choose photos"}</span>
            <span className="hint">JPEG, PNG or WebP</span>
          </label>
          <input
            id="photos"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            onChange={(e) => setPhotos(Array.from(e.target.files ?? []).slice(0, 3))}
          />
          {photos.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {photos.map((p) => (
                <li key={p.name} className="chip">
                  {p.name}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="label">Voice note</p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={toggleRecording} className={`btn ${recording ? "btn-danger" : "btn-secondary"}`} aria-pressed={recording}>
              <span className={`h-2.5 w-2.5 rounded-full ${recording ? "animate-pulse bg-paper" : "bg-madder"}`} aria-hidden="true" />
              {recording ? "Stop recording" : audio ? "Record again" : "Record a voice note"}
            </button>
            <label className="btn btn-quiet cursor-pointer">
              Upload audio instead
              <input type="file" accept="audio/*" className="sr-only" onChange={(e) => setAudio(e.target.files?.[0] ?? null)} />
            </label>
            {audio && !recording && <span className="chip chip-safe">Voice note ready</span>}
          </div>
        </div>

        <div>
          <label className="label" htmlFor="notes">
            Notes <span className="font-normal text-ink-3">(optional, any language)</span>
          </label>
          <textarea
            id="notes"
            className="field"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Pure silk, zari border, four days on the loom"
          />
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <button disabled={busy || photos.length === 0} className="btn btn-primary btn-lg">
            {busy && !draft ? "Writing your listing…" : draft ? "Write it again" : "Write my listing"}
          </button>
          {busy && !draft ? (
            <p className="hint" role="status">
              Reading your photos, listening to the note and checking similar products. This takes about 20 seconds.
            </p>
          ) : (
            photos.length === 0 && <p className="hint">Add at least one photo to continue.</p>
          )}
        </div>
      </form>

      {draft && (
        <>
          <section className="panel space-y-5 p-5 sm:p-7">
            <div>
              <h2 className="title text-xl">2. Check the listing</h2>
              <p className="hint mt-1">Your agent wrote this from your photos and words. Change anything that isn&apos;t right.</p>
            </div>
            {draft.images.length > 0 && (
              <div className="flex gap-3">
                {draft.images.map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={src} alt="" className="h-24 w-24 rounded-xl object-cover" />
                ))}
              </div>
            )}
            {draft.transcript && (
              <div className="well px-4 py-3 text-sm">
                <p className="font-semibold">What your agent heard</p>
                <p className="mt-1 text-ink-2">{draft.transcript}</p>
              </div>
            )}
            <div>
              <label className="label" htmlFor="title">
                Title
              </label>
              <input id="title" className="field title text-xl" value={draft.listing.title} onChange={(e) => edit("title", e.target.value)} aria-label="Title" />
            </div>
            <div>
              <label className="label" htmlFor="description">
                Description
              </label>
              <textarea
                id="description"
                className="field"
                rows={4}
                value={draft.listing.description}
                onChange={(e) => edit("description", e.target.value)}
                aria-label="Description"
              />
            </div>
            <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <div>
                <dt className="text-ink-3">Category</dt>
                <dd className="font-semibold">{draft.listing.category}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Materials</dt>
                <dd className="font-semibold">{draft.listing.materials}</dd>
              </div>
            </dl>
          </section>

          <section className="panel space-y-6 p-5 sm:p-7">
            <div>
              <h2 className="title text-xl">3. Set your prices</h2>
              <p className="hint mt-1">Only the list price is public. Your floor and refund limit stay private and are enforced in code.</p>
            </div>

            {draft.comps ? (
              <div className="well px-4 py-3 text-sm">
                <p className="font-semibold">
                  Similar products online: {gbp(draft.comps.lowMinor / 100)} to {gbp(draft.comps.highMinor / 100)}
                </p>
                <p className="mt-1 text-ink-2">
                  {draft.comps.count} found, median {gbp(draft.comps.medianMinor / 100)}. These can include big brands, so use them as a guide
                  and set your own price.
                </p>
              </div>
            ) : (
              <p className="notice text-sm">No comparable products found online. Set the price you&apos;d normally ask.</p>
            )}

            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="list-price">
                  List price
                </label>
                <div className="relative">
                  <span className="money pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-2xl text-ink-3">£</span>
                  <input
                    id="list-price"
                    type="number"
                    min={1}
                    className="field money h-16 pl-9 text-[1.75rem]"
                    placeholder="0"
                    value={listPrice || ""}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setListPrice(v);
                      // Suggest a floor at 75% of the price until the seller moves the slider.
                      if (floor === 0 || floor > v) setFloor(Math.round(v * 0.75));
                    }}
                  />
                </div>
                <p className="hint mt-1">What buyers see. Agents start haggling from here.</p>
              </div>
              <div>
                <label className="label" htmlFor="floor">
                  Lowest you&apos;ll accept <span className="money ml-1 text-indigo">{gbp(floor)}</span>
                </label>
                <input
                  id="floor"
                  type="range"
                  min={1}
                  max={Math.max(1, listPrice)}
                  value={floor}
                  disabled={!(listPrice > 0)}
                  onChange={(e) => setFloor(Number(e.target.value))}
                  className="mt-4 block w-full accent-[var(--indigo)]"
                />
                <p className="hint mt-2">
                  Private. Buyers and their agents never see it.
                  {draft.suggested && ` Suggested: ${gbp(draft.suggested.floorLow)} to ${gbp(draft.suggested.floorHigh)}.`}
                </p>
              </div>
            </div>

            <div className="max-w-xs">
              <label className="label" htmlFor="refund-cap">
                Refund your agent can give
              </label>
              <div className="relative">
                <span className="money pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3">£</span>
                <input
                  id="refund-cap"
                  type="number"
                  min={0}
                  max={listPrice}
                  className="field money pl-8"
                  value={refundCap}
                  onChange={(e) => setRefundCap(Math.max(0, Math.min(listPrice, Number(e.target.value))))}
                  aria-label="Refund cap"
                />
              </div>
              <p className="hint mt-1">If a buyer reports damage, your agent can refund up to this on its own. Anything more waits for you.</p>
            </div>

            <div className="flex flex-wrap items-center gap-4 border-t border-line pt-5">
              <button onClick={publish} disabled={busy || !priceReady} className="btn btn-primary btn-lg">
                {busy ? "Publishing…" : "Publish listing"}
              </button>
              {!priceReady && <p className="hint">Set a list price to publish.</p>}
            </div>
          </section>
        </>
      )}

      {error && (
        <p role="alert" className="notice notice-bad">
          {error}
        </p>
      )}
    </main>
  );
}
