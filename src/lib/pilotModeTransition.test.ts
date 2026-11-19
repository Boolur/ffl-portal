import { describe, expect, it } from 'vitest';
import { pilotModeTransition } from './pilotModeTransition';

describe('Pilot preference changes across tabs', () => {
  it('preserves an open Standard form on another tab and resumes it if the preference is restored', () => {
    expect(pilotModeTransition(false, true, true)).toBe('preserve-draft');
    expect(pilotModeTransition(false, false, true)).toBe('unchanged');
  });
  it('reloads a clean Standard tab and always clears a departing Pilot view', () => {
    expect(pilotModeTransition(false, true, false)).toBe('reload');
    expect(pilotModeTransition(true, false, true)).toBe('reload');
    expect(pilotModeTransition(true, false, false)).toBe('reload');
  });
});
