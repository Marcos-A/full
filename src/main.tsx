import { createRoot } from 'react-dom/client';
import { APP_NAME } from './config';
import { ws } from './doc/workspace';
import { language } from './strings';
import { App } from './ui/App';
import { installPrintFallback } from './ui/print';
import './ui/styles.css';

document.title = APP_NAME;
document.documentElement.lang = language;
createRoot(document.getElementById('root')!).render(<App />);
installPrintFallback(() => ws.active);

/** Settles once the app can open files. The desktop entry point waits for it. */
export const started = ws.start();
