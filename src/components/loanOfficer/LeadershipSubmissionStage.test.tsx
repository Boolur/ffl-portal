import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LeadershipSubmissionStage } from './LeadershipSubmissionStage';

vi.mock('@/app/actions/taskActions', () => ({ checkLeadershipSubmissionStage: vi.fn() }));

const checkedAt = '2026-11-19T20:00:00Z';
function render(props: Partial<React.ComponentProps<typeof LeadershipSubmissionStage>>) {
  return renderToStaticMarkup(<LeadershipSubmissionStage ready checking={false}
    onCheck={() => {}} panelRef={{ current: null }} {...props} />);
}

describe('Pilot Processing Details stage check', () => {
  it('asks for identifying fields before offering an Arive read', () => {
    const html = render({ ready: false });
    expect(html).toContain('Loan details needed');
    expect(html).not.toContain('<button');
  });

  it('shows the actual ineligible stage and how to unlock Documents', () => {
    const html = render({ result: { success: true, eligible: false, stageLabel: 'Application Intake', checkedAt } });
    expect(html).toContain('Application Intake');
    expect(html).toContain('Update the loan to Preapproved or Submitted to Underwriting in Arive');
    expect(html).toContain('Recheck Arive');
    expect(html).toContain(checkedAt);
  });

  it('confirms a qualifying stage, and leaves a failed or pending check unverified', () => {
    const approved = render({ result: { success: true, eligible: true, stageLabel: 'Submitted to Underwriting', checkedAt } });
    expect(approved).toContain('Submitted to Underwriting');
    expect(approved).toContain('This stage allows you to continue to Documents.');
    const failed = render({ result: { success: false, error: 'The primary borrower or subject property differs.' } });
    expect(failed).toContain('Unable to verify');
    expect(failed).toContain('subject property differs');
    expect(failed).toContain('Recheck Arive');
    const pending = render({ checking: true });
    expect(pending).toContain('Checking Arive');
    expect(pending).toContain('disabled=""');
  });
});
