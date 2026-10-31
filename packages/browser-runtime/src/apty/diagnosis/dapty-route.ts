/**
 * Recognises a message about the end user's Ask Dapty chat, which the
 * Ask Dapty check answers from the chat calls with no model call. A how-to
 * question about Dapty, or a request to investigate, stays with the model.
 */

const DAPTY =
  /\b(?:ask[ -]?dapty|dapty|ai assistant|ai chat|widget chat|chat ?bot)\b|助手|聊天/;

const PROBLEM = new RegExp(
  [
    "(?:\\bnot|n't|\\bnever|\\bno)\\b[^.?!]{0,40}\\b(?:work(?:ing|s)?|answer(?:s|ed|ing)?|open(?:s|ed|ing)?|launch(?:es|ed|ing)?|load(?:s|ed|ing)?|show(?:s|n|ing)?|respond(?:s|ed|ing)?|repl(?:y|ies|ied)|help(?:s|ed)?|find|found)\\b",
    "\\b(?:can't|cannot|couldn't|could not|unable to|fails? to|failed to)\\s+(?:answer|find|open|launch|load|respond|help)\\b",
    "\\b(?:wrong|broken|fails?|failing|failed|errors?|stuck|blank|empty|nothing happens|does nothing|did nothing)\\b",
    "\\b(?:suggest(?:s|ed|ion|ions)?|recommend(?:s|ed)?)\\b",
    "\\bcouldn't find information\\b",
    "\\bwhat did (?:it|dapty|the (?:assistant|bot)) (?:say|answer|suggest)\\b",
  ].join("|"),
);
const PROBLEM_ZH = /没有|不能|无法|错误|失败|打不开|没反应/;

const HOW_TO =
  /^\s*(?:how (?:do|does|can|could|would|will|to|should|is|are)|what (?:is|are|does)|where (?:do|does|can|is|are)|explain|tell me (?:how|about)|(?:can|could) you explain|(?:should|would|could|can) (?:i|we)\b|is it possible|write|draft|give me)\b/;
const INVESTIGATE = /\binvestigat(?:e|ion)\b/;

/** The message is about what Ask Dapty did for a user, so the check reads the chat. */
export function asksAboutDapty(message: string): boolean {
  const lower = message.toLowerCase();
  if (HOW_TO.test(lower) || INVESTIGATE.test(lower)) return false;
  return DAPTY.test(lower) && (PROBLEM.test(lower) || PROBLEM_ZH.test(lower));
}
