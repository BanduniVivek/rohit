import { auth } from './firebase';

export type PortalRole = 'RIDER' | 'DRIVER' | 'ADMIN';

let activePortal: PortalRole = 'RIDER';

export function setActivePortal(portal: PortalRole) {
  activePortal = portal;
}

export function getActivePortal(): PortalRole {
  return activePortal;
}

export async function apiRequest<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Authentication required');
  }
  const token = await user.getIdToken();

  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('X-App-Portal', activePortal);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data as T;
}
