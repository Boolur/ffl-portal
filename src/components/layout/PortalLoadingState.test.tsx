import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PortalLoadingState } from './PortalLoadingState';

describe('shared portal loading state', () => {
  it('announces the workspace once while keeping its decorative preview silent', () => {
    const html = renderToStaticMarkup(<PortalLoadingState label="Loading tasks" />);
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain('Loading tasks');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('min-h-[60vh]');
    expect(html).toContain('place-items-center');
    expect(html).not.toContain('fixed');
    expect(html).not.toContain('aria-valuenow');
  });

  it.each(['cards', 'table'] as const)('supports an embedded %s preview without taking over the viewport', preview => {
    const html = renderToStaticMarkup(<PortalLoadingState variant="compact" preview={preview} description="" />);
    expect(html).toContain('data-portal-loading="compact"');
    expect(html).not.toContain('min-h-[60vh]');
    expect(html).not.toContain('Getting everything ready');
    expect(html.match(/role="status"/g)).toHaveLength(1);
  });

  it('uses motion only when the viewer has not requested reduced motion', () => {
    const html = renderToStaticMarkup(<PortalLoadingState />);
    const animationClasses = [...html.matchAll(/class="([^"]*)"/g)].flatMap(match => match[1].split(' ')).filter(value => value.includes('animate-'));
    expect(animationClasses.length).toBeGreaterThan(0);
    expect(animationClasses.every(value => value.startsWith('motion-safe:'))).toBe(true);
  });

  it('provides a quiet navigation status without a second page preview', () => {
    const html = renderToStaticMarkup(<PortalLoadingState variant="navigation" label="Opening workspace" />);
    expect(html).toContain('Opening workspace');
    expect(html).toContain('role="status"');
    expect(html).not.toContain('data-portal-loading');
    expect(html).not.toContain('BISU Workspace');
  });
});
