import Link from "next/link";
import { TryDemoButton } from "@/components/TryDemoButton";

// A real negotiation from the demo, replayed as the hero: the thing Mandi does.
const HAGGLE: { who: "seller" | "buyer"; text: string; price: string }[] = [
  { who: "seller", text: "Pure mulberry silk with a zari border, woven on a pit loom over four days.", price: "£95" },
  { who: "buyer", text: "It's lovely, and it's for my mum. Would you do £70?", price: "£70" },
  { who: "seller", text: "For a gift, I can come down to £88 and add gift wrapping.", price: "£88" },
  { who: "buyer", text: "Could we meet at £78?", price: "£78" },
  { who: "seller", text: "£83, wrapped, and shipped within two days.", price: "£83" },
  { who: "buyer", text: "£80 with the wrapping and I'll buy it now.", price: "£80" },
];

const STEPS = [
  {
    title: "Say what you want",
    body: "One sentence: the item, your budget, when it has to arrive. Your agent never goes over the budget, and it never tells a seller what it is.",
  },
  {
    title: "Agents haggle",
    body: "Your agent bargains with several sellers' agents at once. Every offer passes a rules engine, so neither side can break its limits or leak the other's.",
  },
  {
    title: "PayPal holds the money",
    body: "You approve the best deal in PayPal. The money is held, not paid, until the seller ships. If something's wrong, the seller's agent can refund you.",
  },
];

export default function Home() {
  return (
    <main>
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-20">
        <div>
          <h1 className="display text-[clamp(2.75rem,7vw,4.75rem)]">Send an agent to the bazaar.</h1>
          <p className="mt-6 max-w-[34rem] text-xl text-ink-2">
            Tell it what you want and what you&apos;ll pay. It bargains with the agents of artisan sellers in India, and
            PayPal holds your money until the piece ships.
          </p>
          <div className="mt-8 flex flex-wrap items-start gap-3">
            <TryDemoButton />
            <Link href="/browse" className="btn btn-secondary btn-lg">
              Browse the work
            </Link>
          </div>
          <p className="hint mt-4 max-w-md">
            The demo sends Sarah&apos;s agent after a silk scarf under £90, by 20 December, against three sellers. It takes
            about a minute.
          </p>
        </div>

        <HaggleReplay />
      </section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="title text-3xl">How a deal happens</h2>
          <ol className="mt-8 grid gap-8 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-4">
                <span className="display flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo text-lg text-on-indigo">
                  {i + 1}
                </span>
                <div>
                  <h3 className="title text-xl">{s.title}</h3>
                  <p className="mt-2 text-ink-2">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 md:grid-cols-[1fr_auto]">
        <div className="max-w-xl">
          <h2 className="title text-3xl">For sellers, it works in their language</h2>
          <p className="mt-4 text-lg text-ink-2">
            Record a voice note in Hindi and add photos. Mandi writes the English listing and checks your price against
            similar products. Your agent sells within the floor price you set, and every sale arrives in Hindi, in rupees.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/signup?role=seller" className="btn btn-primary">
              Start selling
            </Link>
            <Link href="/login?next=/seller" className="btn btn-secondary">
              See the seller&apos;s phone
            </Link>
          </div>
        </div>
        <div className="mx-auto w-64 rounded-[2rem] border-[6px] border-ink bg-raised p-3 shadow-[0_24px_60px_-24px_rgb(21_25_53/0.5)]" lang="hi" aria-label="Example sale notification on a seller's phone">
          <div className="rounded-2xl bg-leaf px-4 py-3 text-paper">
            <p className="text-sm opacity-80">Mandi, Meera</p>
            <p className="title text-xl">मेरी बिक्री</p>
          </div>
          <div className="mt-3 rounded-2xl border border-line p-3">
            <p className="text-sm text-ink-3">Banarasi silk scarf</p>
            <p className="title mt-1 text-lg">बिक गया! ₹10,057</p>
            <p className="text-sm text-ink-2">2 दिन में भेजें। पैसा PayPal में सुरक्षित है।</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <div className="panel flex flex-wrap items-center justify-between gap-6 p-6 sm:p-8">
          <div className="max-w-xl">
            <h2 className="title text-2xl">Judging Mandi?</h2>
            <p className="mt-2 text-ink-2">
              One-click demo accounts are on the login page. To see the safety rules work, run a negotiation where a
              seller&apos;s agent has been hijacked and tries to get the buyer to overpay.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <TryDemoButton hostile label="Run the attack test" />
            <Link href="/login" className="btn btn-secondary">
              Demo accounts
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function HaggleReplay() {
  return (
    <figure className="panel relative overflow-hidden p-5 sm:p-6" aria-label="An example negotiation between two agents">
      <figcaption className="flex items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <p className="font-semibold">Handwoven Banarasi silk scarf</p>
          <p className="text-sm text-ink-3">Meera&apos;s agent, Varanasi, and Sarah&apos;s agent, London</p>
        </div>
        <p className="text-right text-sm text-ink-3">
          Budget <span className="money block text-base text-ink">£90</span>
        </p>
      </figcaption>
      <ol className="mt-4 space-y-2.5">
        {HAGGLE.map((m, i) => (
          <li
            key={i}
            className={`haggle-line flex items-end gap-3 ${m.who === "buyer" ? "flex-row-reverse text-right" : ""}`}
            style={{ animationDelay: `${300 + i * 420}ms` }}
          >
            <p
              className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-[0.9375rem] leading-snug ${
                m.who === "seller" ? "rounded-bl-md bg-surface" : "rounded-br-md bg-indigo-soft"
              }`}
            >
              {m.text}
            </p>
            <span className="money shrink-0 pb-1.5 text-lg">{m.price}</span>
          </li>
        ))}
      </ol>
      <div className="haggle-line mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4" style={{ animationDelay: `${300 + HAGGLE.length * 420 + 200}ms` }}>
        <span className="display rounded-xl bg-haldi px-3 py-1.5 text-xl text-ink">Agreed at £80</span>
        <span className="chip chip-safe">£80 held by PayPal until it ships</span>
      </div>
      <style>{`
        .haggle-line { animation: haggle-in 420ms cubic-bezier(.2,.7,.2,1) both; }
        @keyframes haggle-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
      `}</style>
    </figure>
  );
}
