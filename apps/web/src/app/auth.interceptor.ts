import { HttpInterceptorFn } from '@angular/common/http';

const KEY = 'fg_auth';

export function getAuthHeader(): string | null {
  return sessionStorage.getItem(KEY);
}

export function setAuthPassword(password: string): void {
  const token = btoa(`parent:${password}`);
  sessionStorage.setItem(KEY, `Basic ${token}`);
}

export function clearAuth(): void {
  sessionStorage.removeItem(KEY);
}

export function isLoggedIn(): boolean {
  return Boolean(getAuthHeader());
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = getAuthHeader();
  if (auth && req.url.startsWith('/api')) {
    return next(req.clone({ setHeaders: { Authorization: auth } }));
  }
  return next(req);
};
