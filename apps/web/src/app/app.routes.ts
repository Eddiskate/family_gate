import { Routes } from '@angular/router';
import { DashboardComponent } from './dashboard.component';
import { HistoryComponent } from './history.component';
import { LoginComponent } from './login.component';
import { authGuard } from './auth.guard';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: '', component: DashboardComponent, canActivate: [authGuard] },
  { path: 'history', component: HistoryComponent, canActivate: [authGuard] },
  { path: '**', redirectTo: '' },
];
