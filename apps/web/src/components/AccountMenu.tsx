'use client';

import { UserButton } from '@clerk/nextjs';

const SITE = 'https://mneia.dev';

const LINKS = [
  { label: 'Home', href: SITE },
  { label: 'About', href: `${SITE}/about` },
  { label: 'FAQ', href: `${SITE}/faq` },
  { label: 'Contact', href: `${SITE}/contact` },
  { label: 'Privacy', href: `${SITE}/privacy` },
  { label: 'Terms', href: `${SITE}/terms` },
] as const;

function LinkIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M6 3h7v7M13 3 4 12"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export function AccountMenu() {
  return (
    <UserButton appearance={{ elements: { avatarBox: { width: '32px', height: '32px' } } }}>
      <UserButton.MenuItems>
        {LINKS.map((link) => (
          <UserButton.Link
            key={link.href}
            label={link.label}
            href={link.href}
            labelIcon={<LinkIcon />}
          />
        ))}
      </UserButton.MenuItems>
    </UserButton>
  );
}
