import 'server-only';

export const COMPANY_SIZES = ['1-9', '10-49', '50-199', '200-499', '500+'] as const;
export type CompanySize = (typeof COMPANY_SIZES)[number];

export const TEAM_FUNCTIONS = [
  'engineering',
  'product',
  'design',
  'sales',
  'marketing',
  'support',
  'success',
  'operations',
  'finance',
  'other',
] as const;
export type TeamFunction = (typeof TEAM_FUNCTIONS)[number];

export type OnboardingErrorCode =
  | 'invalid_company_name'
  | 'invalid_company_size'
  | 'invalid_team_function'
  | 'invalid_display_name'
  | 'rollback_failed'
  | 'session_cleanup_failed';

export class OnboardingError extends Error {
  readonly code: OnboardingErrorCode;

  constructor(code: OnboardingErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'OnboardingError';
    this.code = code;
  }
}

export interface OnboardingProfile {
  readonly companyName: string;
  readonly companySize: CompanySize | null;
  readonly teamFunction: TeamFunction;
  readonly displayName: string;
}

export interface SaveOnboardingInput {
  readonly workspaceId: string;
  readonly teamId: string;
  readonly actorId: string;
  readonly profile: OnboardingProfile;
}

export interface OnboardingStore {
  save(input: SaveOnboardingInput): Promise<void>;
}

export const isCompanySize = (value: string): value is CompanySize =>
  (COMPANY_SIZES as readonly string[]).includes(value);

export const isTeamFunction = (value: string): value is TeamFunction =>
  (TEAM_FUNCTIONS as readonly string[]).includes(value);

export const parseOnboardingProfile = (input: {
  readonly companyName: string;
  readonly companySize: string;
  readonly teamFunction: string;
  readonly displayName: string;
}): OnboardingProfile => {
  const companyName = input.companyName.trim();
  if (companyName.length === 0 || companyName.length > 200) {
    throw new OnboardingError(
      'invalid_company_name',
      'Expected a company name of 1 to 200 characters',
    );
  }

  const displayName = input.displayName.trim();
  if (displayName.length === 0 || displayName.length > 200) {
    throw new OnboardingError('invalid_display_name', 'Expected a name of 1 to 200 characters');
  }

  const size = input.companySize.trim();
  let companySize: CompanySize | null = null;
  if (size.length > 0) {
    if (!isCompanySize(size)) {
      throw new OnboardingError(
        'invalid_company_size',
        `Expected company size to be one of ${COMPANY_SIZES.join(', ')}; received "${size}"`,
      );
    }
    companySize = size;
  }

  const teamFunction = input.teamFunction.trim();
  if (!isTeamFunction(teamFunction)) {
    throw new OnboardingError(
      'invalid_team_function',
      `Expected team function to be one of ${TEAM_FUNCTIONS.join(', ')}; received "${teamFunction}"`,
    );
  }

  return { companyName, companySize, teamFunction, displayName };
};
