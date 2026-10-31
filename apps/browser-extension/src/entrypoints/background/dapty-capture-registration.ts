/** Ask Dapty capture: the passive webRequest listener, and the reads the side panel asks the worker for. */
import {
  handleDaptyCaptureMessage,
  startDaptyPageCapture,
} from "@apty/browser-runtime/apty/dapty-page-capture";
import { handleDaptyWidgetTurnsMessage } from "@apty/browser-runtime/apty/dapty-widget-reader";

startDaptyPageCapture();
chrome.runtime.onMessage.addListener(handleDaptyCaptureMessage);
chrome.runtime.onMessage.addListener(handleDaptyWidgetTurnsMessage);
