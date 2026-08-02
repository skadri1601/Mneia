interface MneiaMarkProps {
  readonly className?: string | undefined;
}

export function MneiaMark({ className }: MneiaMarkProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      focusable="false"
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M13 9h30l8 8v38H13Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="6"
      />
      <path
        d="M23 46V25l9 12 9-12v21"
        fill="none"
        stroke="var(--mark-signal)"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="6"
      />
      <path d="M43 9v9h8" fill="none" stroke="currentColor" strokeWidth="6" />
    </svg>
  );
}
