import { Fragment } from 'react';
import type { Paragraph } from '@/content/pages';

export function Rich({ paragraph }: { paragraph: Paragraph }) {
  return (
    <>
      {paragraph.map((segment) =>
        segment.strong ? (
          <strong key={segment.text}>{segment.text}</strong>
        ) : (
          <Fragment key={segment.text}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}
