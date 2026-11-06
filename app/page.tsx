import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 p-8">
      <div>
        <p className="text-sm uppercase tracking-wide text-neutral-500">Mandi</p>
        <h1 className="mt-2 text-5xl font-semibold leading-tight">
          Your AI shops. Their AI sells. PayPal makes it safe.
        </h1>
      </div>
      <ol className="grid gap-4 text-lg sm:grid-cols-3">
        <li className="rounded-xl border border-neutral-200 p-4">1. A seller&apos;s agent lists and defends the price.</li>
        <li className="rounded-xl border border-neutral-200 p-4">2. A buyer&apos;s agent negotiates within hard limits.</li>
        <li className="rounded-xl border border-neutral-200 p-4">3. PayPal holds the money until the item ships.</li>
      </ol>
      <div className="flex gap-3">
        <Link href="/sell" className="rounded-lg bg-neutral-900 px-5 py-3 text-white">I&apos;m selling</Link>
        <Link href="/shop" className="rounded-lg border border-neutral-300 px-5 py-3">I&apos;m shopping</Link>
      </div>
    </main>
  );
}
