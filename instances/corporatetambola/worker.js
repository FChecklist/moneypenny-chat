// C10: Worker entry for corporatetambola. The bundle comes from "bun scripts/build-widget.mjs corporatetambola" (run by wrangler before deploy).
import config from './instance.json' with { type: 'json' };
import strings from './strings.json' with { type: 'json' };
import widgetJs from './dist/widget.js' with { type: 'text' };
import { makeWorker } from '../lib/worker.js';
export default makeWorker({ config, strings, widgetJs });
