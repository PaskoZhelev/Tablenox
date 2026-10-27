import { useSyncExternalStore } from 'react';

export type Route = { name: 'library' } | { name: 'edit'; id: string } | { name: 'play'; id: string };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '');
  const m = /^\/(edit|play)\/([A-Za-z0-9-]+)$/.exec(path);
  if (m) return { name: m[1] as 'edit' | 'play', id: m[2] };
  return { name: 'library' };
}

export function routeHref(route: Route): string {
  return route.name === 'library' ? '#/' : `#/${route.name}/${route.id}`;
}

export function navigate(route: Route): void {
  window.location.hash = routeHref(route);
}

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

export function useHash(): string {
  return useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => '',
  );
}
