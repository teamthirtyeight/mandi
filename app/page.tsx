import Link from "next/link";
import { getUser } from "@/lib/auth/session";
import { LoginPanel } from "@/components/LoginPanel";
import { TryDemoButton } from "@/components/TryDemoButton";
import { NegotiationChat } from "@/components/NegotiationChat";
import { LANGUAGE_INFO, SELLER_LANGUAGES } from "@/lib/i18n/seller";

const BUYERS = [
  { title: "Say it once", body: "“Silk scarf for my mum, under £90, by Dec 20.” That's the whole brief." },
  { title: "Your agent haggles", body: "It bargains with several makers at once, and never goes over your budget or tells them what it is." },
  { title: "Pay when it ships", body: "You approve the best deal in PayPal. The money is held, not paid, until the seller ships." },
];

const SELLERS = [
  { title: "List by talking", body: "Photos and a voice note in Hindi, Tamil or Bengali become an English listing in a minute." },
  { title: "Sell while you weave", body: "Your agent answers buyers around the clock and never goes below your floor price." },
  { title: "Hear it on WhatsApp", body: "Every sale, payment and refund arrives on your phone, in your language, in rupees." },
];

// A real negotiation from the demo, replayed: the thing Mandi does.
const HAGGLE: { who: "seller" | "buyer"; text: string; price: number }[] = [
  { who: "seller", text: "Pure mulberry silk with a zari border, woven on a pit loom over four days.", price: 95 },
  { who: "buyer", text: "It's lovely, and it's for my mum. Would you do £70?", price: 70 },
  { who: "seller", text: "For a gift, I can come down to £88 and add gift wrapping.", price: 88 },
  { who: "buyer", text: "Could we meet at £78?", price: 78 },
  { who: "seller", text: "£83, wrapped, and shipped within two days.", price: 83 },
  { who: "buyer", text: "£80 with the wrapping and I'll buy it now.", price: 80 },
];

const SAFETY = [
  {
    title: "Agents talk, people decide",
    body: "No agent can move money. You approve the payment in PayPal; the seller is paid only when they ship with tracking.",
  },
  {
    title: "Limits that can't be argued away",
    body: "A rules engine checks every offer. Budgets and floor prices are never broken or revealed, even by a hijacked agent.",
  },
  {
    title: "Problems get sorted",
    body: "Report an issue with a photo. The seller's agent refunds small amounts at once; bigger ones go to the seller.",
  },
];

export default async function Home() {
  const user = await getUser().catch(() => null);

  return (
    <main>
      {/* Why Mandi, with login on the right */}
      <section className="mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-10 sm:px-6 lg:grid-cols-[1fr_24rem] lg:gap-16 lg:pt-16">
        <div>
          <h1 className="display text-[clamp(2.75rem,6.5vw,4.5rem)]">Send an agent to the bazaar.</h1>
          <p className="mt-5 max-w-[36rem] text-xl text-ink-2">
            Mandi is a market where AI agents bargain for you. Buyers get a fair price on handmade work; artisans in India
            sell abroad in their own language. PayPal holds the money until the piece ships.
          </p>

          <div className="mt-10 grid gap-8 sm:grid-cols-2">
            <Audience heading="If you're buying" tone="indigo" points={BUYERS} />
            <Audience heading="If you're selling" tone="haldi" points={SELLERS} />
          </div>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start" aria-label={user ? "Your account" : "Log in"}>
          {user ? <SignedIn name={user.name} role={user.role} /> : <LoginPanel compact />}
        </aside>
      </section>

      {/* Proof: a real deal, end to end */}
      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="title text-3xl">One request, start to finish</h2>
          <p className="mt-2 max-w-2xl text-ink-2">
            Sarah asked for a silk scarf under £90. Her agent bargained with three sellers at once. Here is Meera&apos;s side
            of it, and the message Meera got when it sold.
          </p>
          <div className="mt-8 grid items-start gap-8 lg:grid-cols-[1fr_1fr]">
            <HaggleReplay />
            <figure className="space-y-3">
              <div className="rounded-[1.25rem] bg-[#e7ded3] p-4 dark:bg-[#1f2a2a]">
                <div className="ml-auto max-w-[92%] overflow-hidden rounded-xl rounded-tr-sm bg-white shadow-sm dark:bg-[#1e3a33]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/whatsapp-sold-card.png"
                    alt="WhatsApp card in Hindi: बिक गया! ₹10,057, £80.00, Handwoven Banarasi silk scarf, please ship within 2 days, the money is held safely by PayPal."
                    width={1200}
                    height={750}
                    className="block h-auto w-full"
                  />
                  <p lang="hi" className="px-3 pb-2 pt-2 text-[0.9375rem] leading-snug text-[#111b21] dark:text-[#e9edef]">
                    <b>बिक गया! ₹10,057 (£80.00)</b>
                    <br />
                    कृपया 2 दिन में भेजें। पैसा PayPal में सुरक्षित है।
                  </p>
                </div>
              </div>
              <figcaption className="hint">
                What Meera received on WhatsApp, in Hindi and rupees. She ships, adds tracking, and PayPal pays her.
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      {/* Why it's safe */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="title text-3xl">Built so nobody gets cheated</h2>
        <div className="mt-8 grid gap-8 md:grid-cols-3">
          {SAFETY.map((s) => (
            <div key={s.title}>
              <h3 className="title text-xl">{s.title}</h3>
              <p className="mt-2 text-ink-2">{s.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <TryDemoButton hostile label="Run the attack test" />
          <span className="hint">A hijacked seller agent tries to make the buyer overpay. Watch the engine stop it.</span>
        </div>
      </section>

      {/* The potential: every maker, every language */}
      <section className="border-t border-line">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="title text-3xl">Every maker, in their own language</h2>
          <p className="mt-2 max-w-2xl text-ink-2">
            India has millions of weavers, printers and embroiderers who can&apos;t sell abroad because of language, haggling
            and trust. Mandi&apos;s agents handle all three. Sellers can already work in:
          </p>
          <ul className="mt-6 flex flex-wrap gap-2.5" aria-label="Seller languages">
            {SELLER_LANGUAGES.map((code) => (
              <li key={code} lang={code} className="rounded-full border border-line bg-raised px-4 py-1.5 text-lg">
                {LANGUAGE_INFO[code].native}
              </li>
            ))}
          </ul>
          <div className="mt-10 flex flex-wrap items-start gap-3">
            <TryDemoButton />
            <Link href="/browse" className="btn btn-secondary btn-lg">
              Browse the work
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function Audience({ heading, tone, points }: { heading: string; tone: "indigo" | "haldi"; points: { title: string; body: string }[] }) {
  return (
    <div>
      <h2 className={`title border-l-4 pl-3 text-xl ${tone === "indigo" ? "border-indigo" : "border-haldi"}`}>{heading}</h2>
      <ul className="mt-4 space-y-4">
        {points.map((p) => (
          <li key={p.title}>
            <p className="font-semibold">{p.title}</p>
            <p className="text-ink-2">{p.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SignedIn({ name, role }: { name: string; role: string }) {
  const seller = role === "seller";
  return (
    <div className="panel p-5">
      <p className="text-ink-2">Welcome back,</p>
      <p className="title text-2xl">{name}</p>
      <div className="mt-5 grid gap-2">
        <Link href={seller ? "/dashboard" : "/shop"} className="btn btn-primary btn-lg w-full">
          {seller ? "Open your dashboard" : "Send your agent shopping"}
        </Link>
        <Link href={seller ? "/seller" : "/orders"} className="btn btn-secondary w-full">
          {seller ? "Your phone view" : "Your orders"}
        </Link>
        <Link href="/agent" className="btn btn-quiet w-full">
          Your agent&apos;s settings
        </Link>
      </div>
    </div>
  );
}

function HaggleReplay() {
  return (
    <figure className="panel relative overflow-hidden p-5 sm:p-6" aria-label="An example negotiation between two agents">
      <figcaption className="flex items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <p className="font-semibold">Handwoven Banarasi silk scarf</p>
          <p className="text-sm text-ink-3">Varanasi to London, negotiated by two AI agents</p>
        </div>
        <p className="text-right text-sm text-ink-3">
          Budget <span className="money block text-base text-ink">£90</span>
        </p>
      </figcaption>
      <NegotiationChat
        className="mt-4"
        stagger
        left="Meera's agent"
        right="Sarah's agent"
        lines={HAGGLE.map((m, i) => ({ id: String(i), from: m.who, text: m.text, price: m.price }))}
        outcome={{ kind: "agreed", price: 80, held: "£80 held by PayPal until it ships" }}
      />
    </figure>
  );
}
