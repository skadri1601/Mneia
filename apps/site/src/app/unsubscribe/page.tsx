import prose from '@/components/Prose.module.css';
import { Rise } from '@/components/Reveal';
import { Tile } from '@/components/Tile';
import { UnsubscribeForm } from '@/components/UnsubscribeForm';

export const metadata = {
  title: 'Unsubscribe',
  description: 'Remove your address from the Mneia waitlist.',
  robots: { index: false, follow: false },
};

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <Tile surface="canvas">
      <Rise step={0}>
        <p className={prose.eyebrow}>Waitlist</p>
      </Rise>
      <Rise step={1}>
        <h1 className={prose.hero}>Come off the list</h1>
      </Rise>
      <Rise step={2}>
        <p className={prose.lead}>
          You asked for early access to Mneia. If you would rather not hear from us, remove your
          address here.
        </p>
      </Rise>
      <Rise step={3}>
        <UnsubscribeForm token={token ?? ''} />
      </Rise>
    </Tile>
  );
}
