import Link from "next/link";
import { getUser } from "@/lib/auth/session";
import { LoginPanel } from "@/components/LoginPanel";
import { TryDemoButton } from "@/components/TryDemoButton";
import { NegotiationChat } from "@/components/NegotiationChat";
import {
  ArrowRightIcon,
  ChatIcon,
  CheckIcon,
  LockIcon,
  PackageIcon,
  RefundIcon,
  ShieldIcon,
  SparkIcon,
} from "@/components/Icons";

const BUYER_STEPS = [
  { title: "Say it once", body: "“Silk scarf for my mum, under £90, by Dec 20.” That's the whole brief." },
  { title: "Your agent haggles", body: "It bargains with several makers at once and never goes over your budget or reveals it." },
  { title: "Approve and pay when it ships", body: "You approve the best deal in PayPal. The money is held until the seller ships." },
];

const SELLER_STEPS = [
  { title: "List by talking", body: "A few photos and a short voice note become a polished listing in minutes." },
  { title: "Sell while you work", body: "Your agent answers buyers around the clock and never goes below your floor price." },
  { title: "Get alerts on WhatsApp", body: "Every sale, payment and refund arrives on your phone straight away." },
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

const SAFEGUARDS = [
  {
    icon: LockIcon,
    title: "Agents talk, people decide",
    body: "No agent can move money. Buyers approve every payment in PayPal, and sellers are paid only after they ship with tracking.",
  },
  {
    icon: ShieldIcon,
    title: "Limits enforced in code",
    body: "Mandi checks every offer before it's sent. Budgets and floor prices are never broken or revealed, even by a hijacked agent.",
  },
  {
    icon: RefundIcon,
    title: "Problems get resolved",
    body: "Report an issue with a photo. Small refunds are handled at once, and larger ones go to the seller to approve.",
  },
];

export default async function Home() {
  const user = await getUser().catch(() => null);

  return (
    <main>
      {/* Hero, with login on the right */}
      <section className="relative overflow-hidden border-b border-line">
        <div
          className="pointer-events-none absolute inset-0 opacity-60 [background-image:radial-gradient(var(--line)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
          aria-hidden="true"
        />
        <div className="relative mx-auto grid max-w-[76rem] gap-12 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-[1fr_25rem] lg:gap-16 lg:pt-20">
          <div className="max-w-[40rem]">
            <span className="chip chip-progress">
              <SparkIcon size={13} />
              Agent-to-agent commerce, settled by PayPal
            </span>
            <h1 className="display mt-6 text-[clamp(2.5rem,5.4vw,4rem)]">
              Send an agent to the{" "}
              <span className="bg-[linear-gradient(transparent_64%,var(--haldi)_64%,var(--haldi)_90%,transparent_90%)] box-decoration-clone">
                bazaar.
              </span>
            </h1>
            <p className="lede mt-5 max-w-[34rem] text-lg">
              Mandi is a marketplace where AI agents negotiate for you. Buyers get a fair price on handmade work, artisans
              in India sell worldwide, and PayPal holds the money until the piece ships.
            </p>

            <div className="mt-8 flex flex-wrap items-start gap-3">
              <TryDemoButton className="btn btn-primary btn-lg" label="Watch a live negotiation" />
              <Link href="/browse" className="btn btn-secondary btn-lg">
                Browse the work
                <ArrowRightIcon size={16} />
              </Link>
            </div>

            <ul className="mt-10 grid gap-4 border-t border-line pt-6 sm:grid-cols-3">
              {[
                { icon: LockIcon, text: "Payment held until it ships" },
                { icon: ShieldIcon, text: "Budgets enforced in code" },
                { icon: CheckIcon, text: "You approve every deal" },
              ].map(({ icon: IconComponent, text }) => (
                <li key={text} className="flex items-center gap-2.5 text-sm font-medium text-ink-2">
                  <IconComponent size={17} className="shrink-0 text-indigo" />
                  {text}
                </li>
              ))}
            </ul>
          </div>

          <aside className="lg:self-start" aria-label={user ? "Your account" : "Log in"}>
            {user ? <SignedIn name={user.name} role={user.role} /> : <LoginPanel compact />}
          </aside>
        </div>
      </section>

      {/* Proof: a real deal, end to end */}
      <section className="bg-surface">
        <div className="mx-auto max-w-[76rem] px-4 py-20 sm:px-6">
          <div className="grid items-center gap-12 lg:grid-cols-[22rem_1fr] lg:gap-16">
            <div>
              <p className="eyebrow">See it work</p>
              <h2 className="title mt-3 text-3xl">One request, start to finish</h2>
              <p className="lede mt-4">
                Sarah asked for a silk scarf under £90. Her agent negotiated with three sellers at once and closed with
                Meera at £80, with gift wrapping included.
              </p>
              <ul className="mt-6 space-y-3 text-sm text-ink-2">
                {[
                  "Six messages from first offer to agreement",
                  "£10 under budget, which Meera's agent never saw",
                  "Meera was alerted on WhatsApp the moment it sold",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <CheckIcon size={16} className="mt-0.5 shrink-0 text-leaf" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <HaggleReplay />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-[76rem] px-4 py-20 sm:px-6">
        <div className="max-w-2xl">
          <p className="eyebrow">How it works</p>
          <h2 className="title mt-3 text-3xl">Built for both sides of the deal</h2>
        </div>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <Steps icon={ChatIcon} heading="For buyers" steps={BUYER_STEPS} href="/signup?role=buyer" cta="Start shopping" />
          <Steps
            icon={PackageIcon}
            heading="For artisans"
            steps={SELLER_STEPS}
            href="/signup?role=seller"
            cta="Start selling"
          />
        </div>
      </section>

      {/* Why it's safe */}
      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-[76rem] px-4 py-20 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-2xl">
              <p className="eyebrow">Trust and safety</p>
              <h2 className="title mt-3 text-3xl">Built so nobody gets cheated</h2>
            </div>
            <div className="flex items-center gap-3">
              <TryDemoButton hostile label="Run the attack test" />
            </div>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {SAFEGUARDS.map(({ icon: IconComponent, title, body }) => (
              <div key={title} className="panel p-6">
                <span className="icon-tile">
                  <IconComponent size={18} />
                </span>
                <h3 className="mt-5 font-semibold tracking-[-0.015em]">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">{body}</p>
              </div>
            ))}
          </div>
          <p className="hint mt-6">
            The attack test hijacks a seller agent and tries to make the buyer overpay, so you can watch the engine stop it.
          </p>
        </div>
      </section>

      {/* Reach */}
      <section className="mx-auto max-w-[76rem] px-4 py-20 sm:px-6">
        <div className="panel panel-raised overflow-hidden">
          <div className="grid gap-10 p-8 sm:p-12 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="max-w-2xl">
              <h2 className="title text-3xl">Every maker, ready to sell abroad</h2>
              <p className="lede mt-4">
                India has millions of weavers, printers and embroiderers who struggle to reach buyers abroad, negotiate
                fairly and get paid safely. Mandi handles all three, so they can focus on their craft.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <TryDemoButton className="btn btn-primary btn-lg" label="Try the demo" />
              <Link href="/signup?role=seller" className="btn btn-secondary btn-lg">
                Sell on Mandi
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[76rem] flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-ink-3 sm:px-6">
          <p>Mandi · Built for the PayPal AI Hackathon</p>
          <nav aria-label="Footer" className="flex gap-5">
            <Link href="/browse" className="hover:text-ink">
              Browse
            </Link>
            <Link href="/arena" className="hover:text-ink">
              Break the agent
            </Link>
            <Link href="/login" className="hover:text-ink">
              Log in
            </Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}

function Steps({
  icon: IconComponent,
  heading,
  steps,
  href,
  cta,
}: {
  icon: typeof ChatIcon;
  heading: string;
  steps: { title: string; body: string }[];
  href: string;
  cta: string;
}) {
  return (
    <div className="panel flex flex-col p-6 sm:p-8">
      <div className="flex items-center gap-3">
        <span className="icon-tile">
          <IconComponent size={18} />
        </span>
        <h3 className="text-lg font-semibold tracking-[-0.02em]">{heading}</h3>
      </div>
      <ol className="mt-6 flex-1 space-y-5">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-4">
            <span className="num flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line-strong text-xs font-semibold text-ink-2">
              {i + 1}
            </span>
            <div>
              <p className="font-medium">{s.title}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-ink-2">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <Link href={href} className="link mt-7 inline-flex items-center gap-1.5 self-start text-sm no-underline">
        {cta}
        <ArrowRightIcon size={15} />
      </Link>
    </div>
  );
}

function SignedIn({ name, role }: { name: string; role: string }) {
  const seller = role === "seller";
  return (
    <div className="panel panel-raised p-6">
      <p className="text-sm text-ink-3">Welcome back</p>
      <p className="title mt-0.5 text-2xl">{name}</p>
      <div className="mt-6 grid gap-2">
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
    <figure className="panel panel-raised overflow-hidden" aria-label="An example negotiation between two agents">
      <figcaption className="panel-head bg-raised">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">Handwoven Banarasi silk scarf</p>
          <p className="text-xs text-ink-3">Varanasi to London · negotiated by two AI agents</p>
        </div>
        <div className="text-right">
          <p className="stat-label">Budget</p>
          <p className="stat-value text-sm">£90</p>
        </div>
      </figcaption>
      <div className="p-5 sm:p-6">
        <NegotiationChat
          stagger
          left="Meera's agent"
          right="Sarah's agent"
          lines={HAGGLE.map((m, i) => ({ id: String(i), from: m.who, text: m.text, price: m.price }))}
          outcome={{ kind: "agreed", price: 80, held: "£80 held by PayPal until it ships" }}
        />
      </div>
    </figure>
  );
}
