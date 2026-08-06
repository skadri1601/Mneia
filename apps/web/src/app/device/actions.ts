'use server';

import { redirect } from 'next/navigation';
import { getCurrentAccount } from '../../server/current-account.js';
import { normalizeUserCode } from '../../server/device-codes.js';
import { deviceStore } from '../../server/device-runtime.js';
import { DeviceError } from '../../server/store/device-store.js';

const textField = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
};

export async function decideDeviceAction(formData: FormData): Promise<void> {
  const userCode = normalizeUserCode(textField(formData, 'userCode'));
  const confirmationCode = textField(formData, 'confirmationCode');
  const approve = textField(formData, 'decision') === 'approve';

  if (userCode.length === 0) {
    redirect('/device?error=invalid_user_code');
  }
  if (!/^\d{4}$/.test(confirmationCode)) {
    redirect(`/device?user_code=${encodeURIComponent(userCode)}&error=invalid_confirmation_code`);
  }

  const account = await getCurrentAccount();

  try {
    await deviceStore.decide({
      workspaceId: account.workspace.id,
      actorId: account.actor.id,
      userCode,
      confirmationCode,
      approve,
    });
  } catch (error) {
    if (error instanceof DeviceError) {
      redirect(`/device?user_code=${encodeURIComponent(userCode)}&error=${error.code}`);
    }
    throw error;
  }

  redirect(
    `/device?outcome=${approve ? 'approved' : 'denied'}&workspace=${encodeURIComponent(
      account.workspace.displayName,
    )}`,
  );
}
