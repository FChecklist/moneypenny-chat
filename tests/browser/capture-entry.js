// Test entry, bundled with Bun.build and put into the page by masking.browser.mjs: it hands the REAL capture library (core/widget/shot/*) to the page.
// The picture engine (DOM to pixels) is not part of the shipped widget yet (docs/DECISIONS.md, C10 to C12), so the test supplies one.
import { makeCapture, takePicture } from '../../core/widget/shot/capture.js';
import { maskSecrets } from '../../core/widget/shot/mask.js';
window.__mpcShot = { makeCapture, takePicture, maskSecrets };
