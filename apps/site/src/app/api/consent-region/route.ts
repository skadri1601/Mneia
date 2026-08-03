import { isLimitedDataUseRegion, requiresPriorConsent } from '@/lib/consent';

export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  const country = request.headers.get('cf-ipcountry');
  const region = request.headers.get('cf-region-code');

  return Response.json(
    {
      gated: requiresPriorConsent(country),
      limitedDataUse: isLimitedDataUseRegion(country, region),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
