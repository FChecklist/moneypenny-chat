// C10: Worker entry for veridian-aios. The bundle comes from "bun scripts/build-widget.mjs veridian-aios" (run by wrangler before deploy).
import config from './instance.json' with { type: 'json' };
import strings from './strings.json' with { type: 'json' };
import widgetJs from './dist/widget.js' with { type: 'text' };
import { makeWorker } from '../lib/worker.js';
export default makeWorker({ config, strings, widgetJs });
