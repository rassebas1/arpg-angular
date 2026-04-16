import {Routes} from '@angular/router';
import {GameComponent} from './game';

export const routes: Routes = [
  {path: '', component: GameComponent},
  {path: '**', redirectTo: ''}
];
