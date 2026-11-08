"use client";

// Seller onboarding: photos + a voice note (any language), then the seller agent
// writes the listing, Channel3 suggests a price range, the seller sets a
// private floor and publishes (PayPal catalog product via the Agent Toolkit).
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRightIcon, CheckIcon, LockIcon, PackageIcon, RefundIcon, SparkIcon } from "@/components/Icons";

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

const ImageIcon = ({ size = 18, className }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <circle cx="9" cy="10" r="1.75" />
    <path d="M20.5 16l-5-5-8.5 8.5" />
  </svg>
);
const MicIcon = ({ size = 18, className }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
    <rect x="9" y="3.5" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0013 0M12 18v2.5" />
  </svg>
);
const UploadIcon = ({ size = 18, className }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
    <path d="M12 15.5V4.5M7.5 9L12 4.5 16.5 9M4.5 15v2.5a2 2 0 002 2h11a2 2 0 002-2V15" />
  </svg>
);

function SectionHead({ n, title, hint, done }: { n: number; title: string; hint: string; done?: boolean }) {
  return (
    <div className="flex items-start gap-3 border-b border-line px-5 py-4 sm:px-6">
      <span
        className={`money mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm ${
          done ? "bg-leaf-soft text-leaf" : "bg-indigo-soft text-indigo"
        }`}
        aria-hidden="true"
      >
        {done ? <CheckIcon size={15} /> : n}
      </span>
      <div className="min-w-0">
        <h2 className="title text-lg">
          <span className="sr-only">{n}. </span>
          {title}
        </h2>
        <p className="hint mt-0.5">{hint}</p>
      </div>
    </div>
  );
}

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

  // Local previews of the chosen photos (display only).
  const previews = useMemo(() => photos.map((p) => URL.createObjectURL(p)), [photos]);
  const shownPreviews = useRef<string[]>([]);
  useEffect(() => {
    shownPreviews.current.filter((u) => !previews.includes(u)).forEach((u) => URL.revokeObjectURL(u));
    shownPreviews.current = previews;
  }, [previews]);

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
      <main className="page" aria-busy="true">
        <p className="sr-only" role="status">
          Loading…
        </p>
        <div className="animate-pulse space-y-6" aria-hidden="true">
          <div className="space-y-3">
            <div className="h-9 w-64 rounded-lg bg-surface" />
            <div className="h-4 w-full max-w-md rounded bg-surface" />
          </div>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="panel h-96" />
            <div className="panel h-64" />
          </div>
        </div>
      </main>
    );
  if (!me || me.role !== "seller") {
    return (
      <main className="page-narrow">
        <div className="panel overflow-hidden">
          <div className="p-6 sm:p-8">
            <span className="icon-tile" aria-hidden="true">
              <PackageIcon size={18} />
            </span>
            <h1 className="title mt-4 text-2xl sm:text-3xl">Sell on Mandix</h1>
            <p className="mt-2 text-ink-2">
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
        </div>
      </main>
    );
  }

  if (published) {
    return (
      <main className="page-narrow">
        <div className="panel panel-raised overflow-hidden">
          <div className="border-b border-line bg-haldi-soft px-6 py-6 sm:px-8">
            <span className="chip chip-agreed">
              <CheckIcon size={13} />
              Published
            </span>
            <h1 className="title mt-3 text-2xl sm:text-3xl">{published.title} is live</h1>
          </div>
          <div className="space-y-4 px-6 py-6 sm:px-8">
            <p className="text-ink-2">
              Your agent will now answer buyers&apos; agents for this piece, never going below your floor price. You&apos;ll get a
              notification when it agrees a sale.
            </p>
            <p className="hint">
              {published.paypalProductId
                ? `Added to your PayPal catalogue as product ${published.paypalProductId}.`
                : "We couldn't add it to your PayPal catalogue this time. The listing is live either way."}
            </p>
            <div className="flex flex-wrap gap-3 border-t border-line pt-5">
              <Link href="/dashboard" className="btn btn-primary">
                Go to dashboard
                <ArrowRightIcon size={16} />
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
  const errorBox = error && (
    <p role="alert" className="notice notice-bad text-sm">
      {error}
    </p>
  );

  return (
    <main className="page">
      <header className="flex flex-col gap-5 border-b border-line pb-6 md:flex-row md:items-end md:justify-between">
        <div className="max-w-xl">
          <p className="eyebrow">New listing</p>
          <h1 className="title mt-1 text-3xl sm:text-4xl">List a new piece</h1>
          <p className="mt-2 text-ink-2">Add photos and tell us about it in any language. Your agent writes the listing and sells it for you.</p>
        </div>

        <ol className="flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label="Steps">
          {["Show the piece", "Check the listing", "Set your prices"].map((label, i) => {
            const n = i + 1;
            const state = n < step || (n === 3 && priceReady) ? "done" : n === step || (n === 3 && draft) ? "current" : "todo";
            return (
              <li key={label} className="flex items-center gap-2" aria-current={state === "current" ? "step" : undefined}>
                <span
                  className={`money flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                    state === "todo"
                      ? "border border-line-strong text-ink-3"
                      : state === "done"
                        ? "bg-leaf text-paper"
                        : "bg-indigo text-on-indigo"
                  }`}
                >
                  {state === "done" ? <CheckIcon size={13} /> : n}
                </span>
                <span className={state === "todo" ? "text-ink-3" : "font-medium text-ink"}>{label}</span>
              </li>
            );
          })}
        </ol>
      </header>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Main column */}
        <div className="min-w-0 space-y-6">
          <form onSubmit={generate} className="panel">
            <SectionHead n={1} title="Show the piece" hint="Clear photos in daylight work best. The voice note can be in Hindi or any language." done={!!draft} />

            <div className="space-y-6 p-5 sm:p-6">
              <div>
                <label className="label" htmlFor="photos">
                  Photos <span className="font-normal text-ink-3">(1 to 3)</span>
                </label>
                <label
                  htmlFor="photos"
                  className="group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[0.625rem] border border-dashed border-line-strong bg-surface px-4 py-8 text-center transition-colors hover:border-indigo hover:bg-indigo-soft/40"
                >
                  <span className="icon-tile bg-raised shadow-[var(--shadow-xs)]">
                    <ImageIcon size={18} />
                  </span>
                  <span className="text-sm font-medium text-indigo">{photos.length ? "Choose different photos" : "Choose photos"}</span>
                  <span className="hint">JPEG, PNG or WebP, up to 3</span>
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
                  <ul className="mt-3 grid grid-cols-3 gap-3" aria-label="Chosen photos">
                    {photos.map((p, i) => (
                      <li key={p.name} className="min-w-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={previews[i]} alt="" className="aspect-square w-full rounded-[0.5rem] border border-line object-cover" />
                        <p className="mt-1 truncate text-xs text-ink-3" title={p.name}>
                          {p.name}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className="label">Voice note</p>
                <div className="well flex flex-wrap items-center gap-3 p-3">
                  <button
                    type="button"
                    onClick={toggleRecording}
                    className={`btn ${recording ? "btn-danger" : "btn-secondary"}`}
                    aria-pressed={recording}
                  >
                    {recording ? (
                      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-paper" aria-hidden="true" />
                    ) : (
                      <MicIcon size={16} className="text-madder" />
                    )}
                    {recording ? "Stop recording" : audio ? "Record again" : "Record a voice note"}
                  </button>
                  <label className="btn btn-quiet cursor-pointer">
                    <UploadIcon size={16} />
                    Upload audio instead
                    <input type="file" accept="audio/*" className="sr-only" onChange={(e) => setAudio(e.target.files?.[0] ?? null)} />
                  </label>
                  {audio && !recording && (
                    <span className="chip chip-safe">
                      <CheckIcon size={13} />
                      Voice note ready
                    </span>
                  )}
                </div>
                <p className="hint mt-1.5">Speak in whichever language you&apos;re most comfortable with. Your agent writes the listing in English.</p>
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
            </div>

            <div className="flex flex-col gap-3 border-t border-line bg-surface/60 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
              <button disabled={busy || photos.length === 0} className="btn btn-primary w-full sm:w-auto">
                <SparkIcon size={16} />
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

          {!draft && errorBox}

          {busy && !draft && (
            <div className="panel animate-pulse" aria-hidden="true">
              <div className="border-b border-line px-5 py-4 sm:px-6">
                <div className="h-5 w-40 rounded bg-surface" />
              </div>
              <div className="space-y-4 p-5 sm:p-6">
                <div className="flex gap-3">
                  <div className="h-20 w-20 rounded-[0.5rem] bg-surface" />
                  <div className="h-20 w-20 rounded-[0.5rem] bg-surface" />
                </div>
                <div className="h-10 rounded-[0.5rem] bg-surface" />
                <div className="h-24 rounded-[0.5rem] bg-surface" />
              </div>
            </div>
          )}

          {draft && (
            <section className="panel">
              <SectionHead n={2} title="Check the listing" hint="Your agent wrote this from your photos and words. Change anything that isn't right." />
              <div className="space-y-5 p-5 sm:p-6">
                {draft.images.length > 0 && (
                  <div className="grid grid-cols-3 gap-3 sm:flex">
                    {draft.images.map((src, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={src} alt="" className="aspect-square w-full rounded-[0.5rem] border border-line object-cover sm:h-24 sm:w-24" />
                    ))}
                  </div>
                )}
                {draft.transcript && (
                  <div className="well flex gap-3 px-4 py-3 text-sm">
                    <MicIcon size={16} className="mt-0.5 shrink-0 text-ink-3" />
                    <div className="min-w-0">
                      <p className="font-medium text-ink">What your agent heard</p>
                      <p className="mt-1 text-ink-2">{draft.transcript}</p>
                    </div>
                  </div>
                )}
                <div>
                  <label className="label" htmlFor="title">
                    Title
                  </label>
                  <input id="title" className="field font-medium" value={draft.listing.title} onChange={(e) => edit("title", e.target.value)} aria-label="Title" />
                </div>
                <div>
                  <label className="label" htmlFor="description">
                    Description
                  </label>
                  <textarea
                    id="description"
                    className="field"
                    rows={5}
                    value={draft.listing.description}
                    onChange={(e) => edit("description", e.target.value)}
                    aria-label="Description"
                  />
                  <p className="hint mt-1.5">Buyers&apos; agents read this when they compare pieces.</p>
                </div>
                <dl className="grid gap-3 sm:grid-cols-2">
                  <div className="well px-4 py-3">
                    <dt className="stat-label">Category</dt>
                    <dd className="mt-0.5 text-sm font-medium">{draft.listing.category}</dd>
                  </div>
                  <div className="well px-4 py-3">
                    <dt className="stat-label">Materials</dt>
                    <dd className="mt-0.5 text-sm font-medium">{draft.listing.materials}</dd>
                  </div>
                </dl>
              </div>
            </section>
          )}
        </div>

        {/* Side card: pricing, status, publish */}
        <aside className="min-w-0 space-y-4 lg:sticky lg:top-6">
          {!draft ? (
            <div className="panel">
              <div className="panel-head">
                <h2 className="text-sm font-semibold">
                  <span className="sr-only">3. </span>Pricing and publishing
                </h2>
                <span className="chip">Draft</span>
              </div>
              <div className="space-y-4 p-5">
                <p className="text-sm text-ink-2">Once your agent has written the listing, you&apos;ll set your prices here and publish.</p>
                <ul className="space-y-3 text-sm">
                  <li className="flex gap-3">
                    <PackageIcon size={16} className="mt-0.5 shrink-0 text-ink-3" />
                    <span className="text-ink-2">A public list price buyers see</span>
                  </li>
                  <li className="flex gap-3">
                    <LockIcon size={16} className="mt-0.5 shrink-0 text-ink-3" />
                    <span className="text-ink-2">A private lowest price your agent never goes below</span>
                  </li>
                  <li className="flex gap-3">
                    <RefundIcon size={16} className="mt-0.5 shrink-0 text-ink-3" />
                    <span className="text-ink-2">A refund your agent can give on its own</span>
                  </li>
                </ul>
              </div>
            </div>
          ) : (
            <section className="panel panel-raised">
              <SectionHead n={3} title="Set your prices" hint="Only the list price is public. Your floor and refund limit stay private, and Mandix checks every offer against them." done={priceReady} />

              <div className="space-y-5 p-5">
                {draft.comps ? (
                  <div className="well px-4 py-3 text-sm">
                    <p className="stat-label">Similar products online</p>
                    <p className="money mt-0.5 text-ink">
                      {gbp(draft.comps.lowMinor / 100)} to {gbp(draft.comps.highMinor / 100)}
                    </p>
                    <p className="hint mt-1">
                      {draft.comps.count} found, median {gbp(draft.comps.medianMinor / 100)}. These can include big brands, so use them as a guide and set
                      your own price.
                    </p>
                  </div>
                ) : (
                  <p className="notice text-sm">No comparable products found online. Set the price you&apos;d normally ask.</p>
                )}

                <div>
                  <label className="label" htmlFor="list-price">
                    List price
                  </label>
                  <div className="relative">
                    <span className="money pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-xl text-ink-3">£</span>
                    <input
                      id="list-price"
                      type="number"
                      min={1}
                      className="field money h-14 pl-8 text-2xl"
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
                  <p className="hint mt-1.5">What buyers see. Agents start haggling from here.</p>
                </div>

                <div>
                  <label className="label flex items-baseline justify-between gap-2" htmlFor="floor">
                    <span className="flex items-center gap-1.5">
                      <LockIcon size={14} className="text-ink-3" />
                      Lowest you&apos;ll accept
                    </span>
                    <span className="money text-indigo">{gbp(floor)}</span>
                  </label>
                  <input
                    id="floor"
                    type="range"
                    min={1}
                    max={Math.max(1, listPrice)}
                    value={floor}
                    disabled={!(listPrice > 0)}
                    onChange={(e) => setFloor(Number(e.target.value))}
                    className="block h-10 w-full accent-[var(--indigo)] disabled:opacity-50"
                  />
                  <p className="hint mt-1">
                    Private. Buyers and their agents never see it.
                    {draft.suggested && ` Suggested: ${gbp(draft.suggested.floorLow)} to ${gbp(draft.suggested.floorHigh)}.`}
                  </p>
                </div>

                <div>
                  <label className="label" htmlFor="refund-cap">
                    Refund your agent can give
                  </label>
                  <div className="relative">
                    <span className="money pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3">£</span>
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
                  <p className="hint mt-1.5">If a buyer reports damage, your agent can refund up to this on its own. Anything more waits for you.</p>
                </div>
              </div>

              <div className="space-y-3 border-t border-line bg-surface/60 p-5">
                {errorBox}
                <button onClick={publish} disabled={busy || !priceReady} className="btn btn-primary btn-lg w-full">
                  {busy ? "Publishing…" : "Publish listing"}
                </button>
                {!priceReady && <p className="hint text-center">Set a list price to publish.</p>}
              </div>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
