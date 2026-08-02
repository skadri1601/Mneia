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
        d="M8 52V12c0-2.2 2.5-3.5 4.3-2.2l17.5 12.8c1.5 1.1 1.5 3.3 0 4.4L18.7 35v10.2l9.6-7c1.8-1.3 4.3 0 4.3 2.2v11.5c0 .9-.4 1.7-1.1 2.2L12.3 56.2C10.5 57.5 8 56.2 8 54Z"
        fill="currentColor"
      />
      <path
        d="M56 52V12c0-2.2-2.5-3.5-4.3-2.2L34.2 22.6c-1.5 1.1-1.5 3.3 0 4.4L45.3 35v10.2l-9.6-7c-1.8-1.3-4.3 0-4.3 2.2v11.5c0 .9.4 1.7 1.1 2.2l19.2 2.1C53.5 57.5 56 56.2 56 54Z"
        fill="var(--mark-signal)"
      />
      <circle cx="32" cy="31" fill="var(--mark-signal)" r="6" />
    </svg>
  );
}
