// Public surface of the dashboard feature: the live dashboard, built only from API responses.
export { DashboardPage } from './components/dashboard-page';
export { DashboardControls } from './components/dashboard-controls';
export {
  DEFAULT_SELECTION,
  readSelection,
  selectionToQuery,
  type DashboardSelection,
} from './dashboard-selection';
