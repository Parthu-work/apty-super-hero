import type { UIToolPart } from "../../types";

type ToolComponentState =
  | "input-streaming"
  | "input-available"
  | "executing"
  | "output-available"
  | "output-error";

export function mapToolState(state: UIToolPart["state"]): ToolComponentState {
  switch (state) {
    case "pending":
      return "input-streaming";
    case "executing":
      return "executing";
    case "completed":
      return "output-available";
    case "error":
      return "output-error";
    default:
      return "input-available";
  }
}
