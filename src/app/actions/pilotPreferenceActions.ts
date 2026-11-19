'use server';
import { prisma } from '@/lib/prisma';
import { getPilotPreferenceActor, pilotPracticeAvailable, pilotViewAvailable, practiceResult } from '@/lib/pilotPracticeAccess';

export async function getPilotPreferences() {
  return practiceResult(async () => {
    const actor = await getPilotPreferenceActor();
    const officerView = actor.role === 'LOAN_OFFICER';
    return { role: actor.role, eligible: true, available: pilotViewAvailable(), practiceAvailable: !officerView && pilotPracticeAvailable(),
      enabled: pilotViewAvailable() && (officerView ? actor.loanOfficerPilotEnabled : actor.pilotViewEnabled) };
  });
}
export async function setPilotViewEnabled(enabled: boolean, expectedRole?: string) {
  return practiceResult(async () => {
    const actor = await getPilotPreferenceActor();
    if (expectedRole !== undefined && actor.role !== expectedRole) throw new Error('Your active role changed. Reopen the dashboard.');
    if (typeof enabled !== 'boolean') throw new Error('Choose a valid view.');
    if (enabled && !pilotViewAvailable()) throw new Error('Pilot view is not enabled yet.');
    const officerView = actor.role === 'LOAN_OFFICER';
    await prisma.user.update({ where: { id: actor.id }, data: officerView ? { loanOfficerPilotEnabled: enabled } : { pilotViewEnabled: enabled } });
    return { eligible: true, available: pilotViewAvailable(), practiceAvailable: !officerView && pilotPracticeAvailable(), enabled };
  });
}
