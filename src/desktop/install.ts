import { DESKTOP_STRINGS } from '../platform/desktopStrings';
import { setHost } from '../platform/host';
import { overrideStrings } from '../strings';
import { desktopHost } from './host';

setHost(desktopHost);
overrideStrings(DESKTOP_STRINGS);
