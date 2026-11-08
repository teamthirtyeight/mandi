// A small set of line icons, drawn on a 24px grid with a 1.75 stroke so they
// sit evenly beside Inter text. Decorative unless given a label.
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 18, children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const ShieldIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" />
    <path d="M9 12l2 2 4-4" />
  </Icon>
);

export const LockIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
    <path d="M8 10.5V7.5a4 4 0 018 0v3" />
  </Icon>
);

export const ChatIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 17l-3 3V6a2 2 0 012-2h12a2 2 0 012 2v9a2 2 0 01-2 2H7z" />
    <path d="M8.5 9.5h7M8.5 12.5h4.5" />
  </Icon>
);

export const PackageIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5v-9z" />
    <path d="M3.5 7.5L12 12l8.5-4.5M12 12v9" />
  </Icon>
);

export const RefundIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 12a8 8 0 1 0 2.4-5.7" />
    <path d="M4 4v4.5h4.5" />
    <path d="M12 8v8M14.5 9.5h-3.25a1.75 1.75 0 000 3.5h1.5a1.75 1.75 0 010 3.5H9.5" />
  </Icon>
);

export const GlobeIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5s1.2-6.1 3.5-8.5z" />
  </Icon>
);

export const SparkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9-1.9 5.1-1.9-5.1-5.1-1.9 5.1-1.9L12 3.5z" />
    <path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z" />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);

export const ArrowRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);

export const BellIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 9.5a6 6 0 0112 0c0 5 2 6.5 2 6.5H4s2-1.5 2-6.5z" />
    <path d="M10 19.5a2.2 2.2 0 004 0" />
  </Icon>
);

/**
 * Mandix's mark: a price tag on a string, with the x of Mandix. Fixed colours,
 * not theme tokens, so the logo looks the same in light and dark mode.
 * Keep in sync with app/icon.svg.
 */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" aria-hidden="true">
      <rect width="96" height="96" rx="22" fill="#0a0b0f" />
      <path
        d="M40 30h32a8 8 0 018 8v32a8 8 0 01-8 8H40a6 6 0 01-4.4-1.9L21 58.1a6 6 0 010-8.2l14.6-18A6 6 0 0140 30z"
        fill="#ffffff"
      />
      <circle cx="37" cy="54" r="5.5" fill="#e9a21b" />
      <path d="M54 46l16 16M70 46L54 62" stroke="#0a0b0f" strokeWidth="6.5" strokeLinecap="round" />
      <path d="M37 54C28 40 22 30 14 22" fill="none" stroke="#e9a21b" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
