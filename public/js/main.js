// The board's script. Every page works without it; with it you get GOV.UK's component
// behaviour, fading success notices, the theme switch, and live columns.
import { initAll } from '/govuk/govuk-frontend.min.js';
import { startLiveColumns } from './live.js';
import { fadeSuccessNotice } from './notices.js';
import { startThemeSwitch } from './theme.js';

initAll();
fadeSuccessNotice();
startThemeSwitch();
startLiveColumns();
