import { ImageResponse } from 'next/og';
import { PRIVACY, TERMS } from '@/content/legal';
import {
  ABOUT_INTRO,
  FEATURES_INTRO,
  HANDOFF_INTRO,
  HOME_INTRO,
  PRICING_INTRO,
} from '@/content/pages';
import { OG_PALETTE } from '@/styles/theme';
import { type RoutePath, routeFor, SITE_NAME, SITE_TAGLINE } from './site';

export const OG_SIZE = { width: 1200, height: 630 };

export const OG_CONTENT_TYPE = 'image/png';

const HEADINGS: Record<RoutePath, string> = {
  '/': HOME_INTRO.heading,
  '/handoff': HANDOFF_INTRO.heading,
  '/features': FEATURES_INTRO.heading,
  '/pricing': PRICING_INTRO.heading,
  '/about': ABOUT_INTRO.heading,
  '/terms': TERMS.title,
  '/privacy': PRIVACY.title,
};

function truncate(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  const clipped = text.slice(0, limit);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${clipped.slice(0, lastSpace > 0 ? lastSpace : limit).trimEnd()}...`;
}

export function ogAlt(path: RoutePath): string {
  return `${SITE_NAME}: ${HEADINGS[path]}`;
}

export function ogImage(path: RoutePath): ImageResponse {
  const route = routeFor(path);
  const heading = HEADINGS[path];
  const subline = truncate(path === '/' ? SITE_TAGLINE : route.description, 120);

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        backgroundColor: OG_PALETTE.canvas,
        padding: '72px 80px',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            fontSize: 26,
            letterSpacing: 2,
            textTransform: 'uppercase',
            color: OG_PALETTE.accent,
          }}
        >
          {path === '/' ? SITE_NAME : route.name}
        </div>
        <div
          style={{
            marginTop: 28,
            fontSize: heading.length > 44 ? 76 : 92,
            lineHeight: 1.08,
            letterSpacing: -2,
            color: OG_PALETTE.ink,
          }}
        >
          {heading}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 30, lineHeight: 1.42, color: OG_PALETTE.faint }}>{subline}</div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginTop: 40,
            fontSize: 28,
            color: OG_PALETTE.ink,
          }}
        >
          <div
            style={{
              width: 44,
              height: 4,
              marginRight: 20,
              backgroundColor: OG_PALETTE.accent,
            }}
          />
          {SITE_NAME}
        </div>
      </div>
    </div>,
    OG_SIZE,
  );
}
