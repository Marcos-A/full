import { answerCloseRequest, closeFileOrWindow } from '../../src/desktop/closing';
import { nativeEventHandler } from '../../src/desktop/nativeEvents';
import { ws } from '../../src/doc/workspace';
import { DESKTOP_STRINGS } from '../../src/platform/desktopStrings';
import { setHost } from '../../src/platform/host';
import { overrideStrings } from '../../src/strings';
import { createFakeHost } from './fakeHost';

const { host, controls } = createFakeHost();
setHost(host);
overrideStrings(DESKTOP_STRINGS);
Object.assign(window, {
  __fake: controls,
  __ws: ws,
  __native: nativeEventHandler(controls.readGrant, (files) => ws.openFiles(files), {
    closeFile: () => closeFileOrWindow(() => controls.windowCloses++),
    closeRequested: (id) => void answerCloseRequest(id, (_, answer) => controls.closeAnswers.push(answer)),
  }),
});
