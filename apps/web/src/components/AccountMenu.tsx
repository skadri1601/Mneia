'use client';

import { UserButton } from '@clerk/nextjs';
import { MARKETING_SITE_URL } from '../site.js';

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
        <UserButton.Link
          label="Contact"
          href={`${MARKETING_SITE_URL}/contact`}
          labelIcon={<LinkIcon />}
        />
      </UserButton.MenuItems>
    </UserButton>
  );
}
