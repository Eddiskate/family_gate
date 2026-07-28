import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { isLoggedIn } from './auth.interceptor';

export const authGuard: CanActivateFn = () => {
  if (isLoggedIn()) return true;
  return inject(Router).createUrlTree(['/login']);
};
