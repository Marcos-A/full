import { createRoot } from 'react-dom/client';
import { APP_NAME } from './config';
import { ws } from './doc/workspace';
import { App } from './ui/App';
import './ui/styles.css';

document.title = APP_NAME;
createRoot(document.getElementById('root')!).render(<App />);
void ws.start();
