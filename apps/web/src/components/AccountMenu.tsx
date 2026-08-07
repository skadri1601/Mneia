'use client';

import { UserButton } from '@clerk/nextjs';

const appearance = {
  elements: {
    avatarBox: { width: '28px', height: '28px' },
    userButtonOuterIdentifier: {
      color: 'var(--ink)',
      fontSize: 'var(--size-fine-print)',
      paddingInlineStart: 'var(--space-xs)',
    },
  },
};

export function AccountMenu() {
  return <UserButton appearance={appearance} showName />;
}
