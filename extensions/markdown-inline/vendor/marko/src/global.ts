// Standalone browser build: exposes window.Marko without a bundler.
import * as Marko from "./index";

declare global { interface Window { Marko: typeof Marko } }
window.Marko = Marko;
