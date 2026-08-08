import type { ContextItemReview } from '@mneia/core';

const textField = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

export function readReviews(formData: FormData): readonly ContextItemReview[] {
  const reviews: ContextItemReview[] = [];

  for (const itemId of formData.getAll('itemId')) {
    if (typeof itemId !== 'string' || itemId.length === 0) {
      continue;
    }

    const decision = textField(formData, `decision:${itemId}`);
    if (decision !== 'accept' && decision !== 'reject') {
      continue;
    }

    const title = textField(formData, `title:${itemId}`).trim();
    const body = textField(formData, `body:${itemId}`);
    const loadBearing = formData.get(`loadBearing:${itemId}`) === 'on';

    reviews.push({
      itemId,
      decision,
      ...(title.length === 0 ? {} : { title }),
      body: body.trim().length === 0 ? null : body,
      loadBearing,
    });
  }

  return reviews;
}
