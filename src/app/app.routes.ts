import { Routes } from '@angular/router';
import { Categories } from './pages/categories';
import { Ideas } from './pages/ideas';
import { Settings } from './pages/settings';
import { Stats } from './pages/stats';
import { TemplateEdit } from './pages/template-edit';
import { Templates } from './pages/templates';
import { Time } from './pages/time';
import { TodoDetail } from './pages/todo-detail';
import { TodoEdit } from './pages/todo-edit';
import { TodoList } from './pages/todo-list';
import { Trash } from './pages/trash';

export const routes: Routes = [
  { path: '', component: TodoList, pathMatch: 'full' },
  { path: 'neu', component: TodoEdit },
  { path: 'aufgabe/:id', component: TodoDetail },
  { path: 'aufgabe/:id/bearbeiten', component: TodoEdit },
  { path: 'ideen', component: Ideas },
  { path: 'papierkorb', component: Trash },
  { path: 'vorlagen', component: Templates },
  { path: 'vorlagen/neu', component: TemplateEdit },
  { path: 'vorlagen/:id', component: TemplateEdit },
  { path: 'zeit', component: Time },
  { path: 'statistik', component: Stats },
  { path: 'kategorien', component: Categories },
  { path: 'einstellungen', component: Settings },
  { path: '**', redirectTo: '' },
];
