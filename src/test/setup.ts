import "@testing-library/jest-dom/vitest";
import { transferableAbortController } from "node:util";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import "@/i18n";

/**
 * A Request of Node, which jsdom leaves in place, takes no relative URL: in a
 * browser, it resolves against the page, as the API client (`/api/…`) expects.
 */
class PageRequest extends Request {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(typeof input === "string" ? new URL(input, window.location.href) : input, init);
  }
}
globalThis.Request = PageRequest;

/**
 * jsdom puts its own AbortController in place of Node's, whose signals the
 * Request of Node refuses: the controllers of the page are Node's again, as
 * those of a browser are the ones its fetch takes.
 */
const nodeController = transferableAbortController();
globalThis.AbortController = nodeController.constructor as typeof AbortController;
globalThis.AbortSignal = nodeController.signal.constructor as typeof AbortSignal;

// jsdom does not scroll the window, which the router asks at each navigation.
window.scrollTo = () => undefined;

// Without the globals of vitest, Testing Library cannot unmount by itself.
afterEach(() => {
  cleanup();
});
