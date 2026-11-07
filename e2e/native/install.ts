import { ws } from '../../src/doc/workspace';
import { DESKTOP_STRINGS } from '../../src/platform/desktopStrings';
import { setHost } from '../../src/platform/host';
import { overrideStrings } from '../../src/strings';
import { createFakeHost } from './fakeHost';

const { host, controls } = createFakeHost();
setHost(host);
overrideStrings(DESKTOP_STRINGS);
Object.assign(window, { __fake: controls, __ws: ws });
