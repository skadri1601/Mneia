import { ImageResponse } from 'next/og';
import { OG_PALETTE } from '@/styles/theme';

export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: OG_PALETTE.accent,
        color: OG_PALETTE.canvas,
        fontSize: 340,
        letterSpacing: -12,
      }}
    >
      M
    </div>,
    size,
  );
}
