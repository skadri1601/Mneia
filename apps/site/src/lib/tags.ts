export const GA4_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID ?? '';

export const GOOGLE_ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID ?? '';

export const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID ?? '';

export const GOOGLE_TAG_ID = GA4_MEASUREMENT_ID || GOOGLE_ADS_ID;

export const HAS_GOOGLE_TAGS = GOOGLE_TAG_ID.length > 0;

export const HAS_META_PIXEL = META_PIXEL_ID.length > 0;

export const HAS_ANY_TAG = HAS_GOOGLE_TAGS || HAS_META_PIXEL;
