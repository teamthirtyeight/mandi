// Shared layout for log in, sign up and password reset: product points on
// the left on wide screens, and a focused form on the right.
import { CheckIcon, LockIcon, ShieldIcon } from "./Icons";

const POINTS = [
  { icon: ShieldIcon, title: "Limits that hold", body: "Budgets and floor prices are checked on every offer and never revealed." },
  { icon: LockIcon, title: "Payment held by PayPal", body: "Money is released to the seller only after the item ships." },
  { icon: CheckIcon, title: "You stay in control", body: "Agents negotiate, but nothing is bought without your approval." },
];

export function AuthShell({
  title,
  subtitle,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  /** Wider form column, for longer forms like sign-up. */
  wide?: boolean;
}) {
  return (
    <main className="grid min-h-[calc(100vh-61px)] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden overflow-hidden border-r border-line bg-surface lg:block">
        <div
          className="pointer-events-none absolute inset-0 opacity-70 [background-image:radial-gradient(var(--line-strong)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:linear-gradient(to_bottom,black,transparent_90%)]"
          aria-hidden="true"
        />
        <div className="sticky top-[61px] flex h-[calc(100vh-61px)] max-w-xl flex-col justify-center px-12 py-16 xl:px-16">
          <p className="eyebrow">Mandi</p>
          <p className="display mt-4 text-[2.25rem]">Agents negotiate. PayPal protects. You decide.</p>
          <ul className="mt-10 space-y-6">
            {POINTS.map(({ icon: IconComponent, title: t, body }) => (
              <li key={t} className="flex gap-4">
                <span className="icon-tile bg-raised shadow-[var(--shadow-xs)]">
                  <IconComponent size={18} />
                </span>
                <span>
                  <span className="block font-semibold tracking-[-0.015em]">{t}</span>
                  <span className="mt-0.5 block text-sm leading-relaxed text-ink-2">{body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <section className="flex justify-center px-4 py-10 sm:px-6 sm:py-16 lg:items-center">
        <div className={`w-full ${wide ? "max-w-xl" : "max-w-md"}`}>
          <h1 className="title text-[1.75rem]">{title}</h1>
          {subtitle && <div className="mt-2 text-ink-2">{subtitle}</div>}
          <div className="mt-8">{children}</div>
        </div>
      </section>
    </main>
  );
}
