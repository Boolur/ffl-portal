'use client';

export type PortalTopic = 'tasks' | 'pipeline' | 'overview';
export type PortalUpdate = { topics: PortalTopic[]; source: 'remote' | 'local' | 'focus' };
const listeners = new Map<PortalTopic, Set<(event: PortalUpdate) => void>>();
const resetListeners = new Set<() => void>();

export function subscribePortalUpdates(topic: PortalTopic, callback: (event: PortalUpdate) => void) {
  let callbacks = listeners.get(topic);
  if (!callbacks) { callbacks = new Set(); listeners.set(topic, callbacks); }
  callbacks.add(callback);
  return () => { callbacks.delete(callback); };
}

export function dispatchPortalUpdates(event: PortalUpdate) {
  const callbacks = new Set(event.topics.flatMap(topic => [...(listeners.get(topic) || [])]));
  callbacks.forEach(callback => callback(event));
}

export function publishPortalUpdates(topics: PortalTopic[]) {
  dispatchPortalUpdates({ topics: [...new Set(topics)], source: 'local' });
}

export function onPortalIdentityReset(callback: () => void) {
  resetListeners.add(callback);
  return () => { resetListeners.delete(callback); };
}

export function resetPortalIdentity() {
  resetListeners.forEach(callback => callback());
}

export function portalTopicForPath(pathname: string): PortalTopic | null {
  if (pathname === '/') return 'overview';
  if (pathname === '/tasks') return 'tasks';
  if (pathname === '/pipeline') return 'pipeline';
  return null;
}
