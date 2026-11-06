"use client";

// Seller onboarding: photos + a voice note (any language) → the seller agent
// writes the listing, Channel3 suggests a price range, the seller sets a
// private floor and publishes (PayPal catalog product via the Agent Toolkit).
import { useEffect, useRef, useState } from "react";

interface Seller {
  id: string;
  name: string;
  city: string;
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
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [sellerId, setSellerId] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [recording, setRecording] = useState(false);
  const [notes, setNotes] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [listPrice, setListPrice] = useState(95);
  const [floor, setFloor] = useState(70);
  const [refundCap, setRefundCap] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<{ title: string; paypalProductId: string | null } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);

  useEffect(() => {
    fetch("/api/sellers")
      .then((r) => r.json())
      .then((b) => {
        setSellers(b.sellers);
        if (b.sellers[0]) setSellerId(b.sellers[0].id);
      });
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
    form.set("sellerId", sellerId);
    form.set("notes", notes);
    photos.forEach((p) => form.append("photos", p));
    if (audio) form.set("audio", new File([audio], "voice-note.webm", { type: audio.type }));
    const res = await fetch("/api/sell/draft", { method: "POST", body: form });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) return setError(body.error);
    setDraft(body);
    if (body.suggested) {
      setListPrice(Math.round(body.suggested.listPrice));
      setFloor(Math.round(body.suggested.floorLow));
    }
  }

  async function publish() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/sell/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sellerId,
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

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <header>
        <p className="text-sm uppercase tracking-wide text-neutral-500">Sell on Mandi</p>
        <h1 className="text-3xl font-semibold">Photos and a voice note. Your agent does the rest.</h1>
      </header>

      <form onSubmit={generate} className="space-y-4 rounded-xl border border-neutral-200 p-5">
        <label className="block">
          <span className="text-sm text-neutral-600">Seller</span>
          <select
            className="mt-1 block w-full rounded-lg border border-neutral-300 px-3 py-2"
            value={sellerId}
            onChange={(e) => setSellerId(e.target.value)}
          >
            {sellers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.city}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm text-neutral-600">Photos (1–3)</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="mt-1 block"
            onChange={(e) => setPhotos(Array.from(e.target.files ?? []).slice(0, 3))}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={toggleRecording}
            className={`rounded-lg px-4 py-2 ${recording ? "bg-red-600 text-white" : "border border-neutral-300"}`}
          >
            {recording ? "Stop recording" : audio ? "Re-record voice note" : "Record voice note"}
          </button>
          <label className="text-sm text-neutral-600">
            or upload audio{" "}
            <input type="file" accept="audio/*" onChange={(e) => setAudio(e.target.files?.[0] ?? null)} />
          </label>
          {audio && !recording && <span className="text-sm text-green-700">Voice note ready</span>}
        </div>
        <label className="block">
          <span className="text-sm text-neutral-600">Notes (optional, any language)</span>
          <textarea
            className="mt-1 block w-full rounded-lg border border-neutral-300 p-3"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Pure silk, zari border, four days on the loom"
          />
        </label>
        <button
          disabled={busy || !sellerId || photos.length === 0}
          className="rounded-lg bg-neutral-900 px-5 py-3 text-white disabled:opacity-40"
        >
          {busy && !draft ? "Writing your listing…" : "Write my listing"}
        </button>
      </form>

      {draft && (
        <section className="space-y-4 rounded-xl border border-neutral-200 p-5">
          <div className="flex gap-3">
            {draft.images.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={src} alt="" className="h-24 w-24 rounded-lg object-cover" />
            ))}
          </div>
          {draft.transcript && (
            <p className="text-sm text-neutral-500">
              Heard: <span className="italic">{draft.transcript}</span>
            </p>
          )}
          <input
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xl font-semibold"
            value={draft.listing.title}
            onChange={(e) => edit("title", e.target.value)}
            aria-label="Title"
          />
          <textarea
            className="w-full rounded-lg border border-neutral-300 p-3"
            rows={3}
            value={draft.listing.description}
            onChange={(e) => edit("description", e.target.value)}
            aria-label="Description"
          />
          <p className="text-sm text-neutral-600">
            {draft.listing.category} · {draft.listing.materials}
          </p>

          {draft.comps ? (
            <div className="rounded-lg bg-neutral-50 p-3 text-sm">
              <p>
                {draft.comps.count} similar products sell for {gbp(draft.comps.lowMinor / 100)}–{gbp(draft.comps.highMinor / 100)} (median{" "}
                {gbp(draft.comps.medianMinor / 100)}).
              </p>
            </div>
          ) : (
            <p className="text-sm text-neutral-500">No comparable prices found; set your own.</p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm text-neutral-600">List price</span>
              <input
                type="number"
                min={1}
                className="mt-1 block w-full rounded-lg border border-neutral-300 px-3 py-2 text-[28px] font-semibold"
                value={listPrice}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setListPrice(v);
                  if (floor > v) setFloor(v);
                }}
              />
            </label>
            <label className="block">
              <span className="text-sm text-neutral-600">Your floor (private): {gbp(floor)}</span>
              <input
                type="range"
                min={1}
                max={Math.max(1, listPrice)}
                value={floor}
                onChange={(e) => setFloor(Number(e.target.value))}
                className="mt-4 block w-full"
              />
              <span className="text-xs text-neutral-500">
                Enforced in code. Buyers and their agents never see it.
                {draft.suggested && ` Suggested: ${gbp(draft.suggested.floorLow)}–${gbp(draft.suggested.floorHigh)}.`}
              </span>
            </label>
          </div>

          <label className="block max-w-xs">
            <span className="text-sm text-neutral-600">Refund cap (private): {gbp(refundCap)}</span>
            <input
              type="number"
              min={0}
              max={listPrice}
              className="mt-1 block w-full rounded-lg border border-neutral-300 px-3 py-2"
              value={refundCap}
              onChange={(e) => setRefundCap(Math.max(0, Math.min(listPrice, Number(e.target.value))))}
              aria-label="Refund cap"
            />
            <span className="text-xs text-neutral-500">Your agent can refund up to this for a damage claim. Anything more waits for you.</span>
          </label>

          <button onClick={publish} disabled={busy} className="rounded-lg bg-neutral-900 px-5 py-3 text-white disabled:opacity-40">
            {busy ? "Publishing…" : "Publish"}
          </button>
          {published && (
            <p className="text-green-800">
              Published “{published.title}”.{" "}
              {published.paypalProductId ? `PayPal product ${published.paypalProductId}.` : "PayPal product not created (check PayPal keys)."}
            </p>
          )}
        </section>
      )}

      {error && <p className="text-red-700">{error}</p>}
    </main>
  );
}
