/**
 * Shared recording-state flag.
 *
 * Tracked here so both the sidepanel port lifecycle (which resets it and
 * broadcasts stop-capture on disconnect) and the message router (which
 * flips it on start-recording/stop-recording) see the same value.
 */
let isRecording = false;

export function getIsRecording(): boolean {
  return isRecording;
}

export function setIsRecording(value: boolean): void {
  isRecording = value;
}
