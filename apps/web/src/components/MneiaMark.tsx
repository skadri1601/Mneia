interface MneiaMarkProps {
  readonly className?: string | undefined;
}

export function MneiaLetter({ className }: MneiaMarkProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      focusable="false"
      viewBox="0 0 22 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M2 22V2l9 12 9-12v20"
        fill="none"
        stroke="var(--mark-signal)"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="4"
      />
    </svg>
  );
}
