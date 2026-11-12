'use server';
import { prisma } from '@/lib/prisma';
import { getPilotActor, pilotPracticeAvailable, pilotViewAvailable, practiceResult } from '@/lib/pilotPracticeAccess';

export async function getPilotPreferences() {
  return practiceResult(async () => {
    const actor = await getPilotActor(false);
    return { eligible: true, available: pilotViewAvailable(), practiceAvailable: pilotPracticeAvailable(), enabled: pilotViewAvailable() && actor.pilotViewEnabled };
  });
}
export async function setPilotViewEnabled(enabled: boolean) {
  return practiceResult(async () => {
    const actor = await getPilotActor(false);
    if (typeof enabled !== 'boolean') throw new Error('Choose a valid view.');
    if (enabled && !pilotViewAvailable()) throw new Error('Pilot view is not enabled yet.');
    await prisma.user.update({ where: { id: actor.id }, data: { pilotViewEnabled: enabled } });
    return { eligible: true, available: pilotViewAvailable(), practiceAvailable: pilotPracticeAvailable(), enabled };
  });
}
