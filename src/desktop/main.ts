// The order matters: the host has to be in place before the app starts.
import './install';
import { started } from '../main';
import { connectNativeEvents } from './connect';

void started.finally(connectNativeEvents);
