# Apty Agent: the SE's guide

One page for solution engineers in the pilot. The Agent reads the Apty KB
pack loaded on your machine and the Apty Client's files on the customer's
tab; nothing leaves your browser unless you copy or download it, or your
organization's policy approves an AI model.

## Before the first message

The side panel shows **Before you start** until it has what it needs: a KB
pack for each Apty version (4.x and 5.x), an AI key or **Use without an AI
key**, the Apty Client connected, and your organization's policy. Each row
has a button to the Options page that fixes it.

## What to put in the first message

- The symptom in one sentence, in the user's words: "the tooltip balloon
  flickers", "workflow X is not showing in the widget".
- The name of the item (workflow, tooltip, launcher, segment) when there is
  one, in quotes: `workflow "Take a tour"`.
- Open the customer's tab first. The Agent reads the Apty version from the
  Client's files ("4.x, from the Client's files" in the context bar); if it
  asks "Which version does this tenant run?", answer once for that site.
- One problem per message; one site per case.

## How to read the answer

The line above each answer, and **Why this answer** under it, say where the
answer came from.

| You see | It means | Do this |
| --- | --- | --- |
| A check verdict (cause found, rules, evidence) | A check read the Client's files and found the cause | Apply the fix; **Prepare support bundle** if Apty has to act |
| A check with no cause, and a card's layers 1 and 2 | The rules read the files correctly and found nothing; the card says what to look at next | Work through the card's layers, then the next check it names |
| KB cards | The KB has cards for this symptom; layer 1 is settings, 2 Console and Elements, 3 network data, 4 support | Use the layer buttons (L1 to L4); **This helped** if it answered, **Wrong card** if it is not the right one |
| "The KB has a card for this, but its … text is not written yet" | A stub | Tell the KB owner; the card's link is there |
| "This does not exist in Apty 4.x" (or 5.x) | The feature has no equivalent in that version | Say so to the customer |
| "No KB card matched (coverage …)" | Not covered | Rephrase with the user's own words once; if still nothing, send it to the KB owner |
| "No KB card matched: only common words matched." | The question used words most cards share | Add the item name or the exact symptom |
| "The KB has no setting called …" | You named a setting no card has; the closest cards are listed, and they may not mention it | Check Studio or Admin; **Ask the AI anyway** only if you want a general answer |
| "No 4.x pack is loaded." (or "No KB pack is loaded.") | No pack for that version | Import one (Options → Knowledge base) |
| "The 4.x pack expired on …", "… is not signed by a key this extension trusts", "… is signed by a revoked key" | The pack is not used | Ask the KB owner for a new pack |
| "Not from the KB or a check" | The AI model answered with no card; it was told not to describe Apty settings | Treat it as general advice; underlined phrases were not found in the KB |
| "Closest KB cards, may not match" under a model's answer | The KB did not cover the question; these cards came closest | Open them before you rely on them; if one was right, tell the KB owner |

## Wrong card

On a KB card, **Wrong card** records which card should have answered: type
part of its title (or its page id) and pick it from the list with the arrow
keys and Enter, or the mouse. **This helped** records that the card answered.
The KB owner reads these weekly; they are the only way real misses get
fixed.

## Prepare support bundle

On a verdict or in the case strip. It holds the case's ids, version, checks,
finding and card links, with Strict redaction and the customer's host
replaced by `customer-app`. Review it in the dialog, then copy or download
it. It is disabled until the case has a check, a finding or a KB card.

## Pasting into a ticket or a chat

- Replace customer names with `customer-a`, `customer-b`. Options →
  General → Cases → **Show sites as customer-a, customer-b** does this in
  the panel too.
- Copy **Why this answer** with its Copy button: it holds ids and codes,
  never card text or your question.
- Do not paste KB card text outside Apty.

## When a pack expires

Options and Preflight warn 7 days ahead. An expired pack is not used: you
get "The 4.x pack expired on <date>." under each answer. Import the new pack from the KB
owner's restricted page, or wait for the nightly delivery if IT set it up.

## Who to contact

- A wrong or missing card, an expired pack: the KB owner.
- The extension, the policy, AI keys: IT.
- A cause the Agent found that Apty must fix: Apty support, with the support
  bundle.
- Send the Feedback export (Options → General → Feedback → Export CSV) to
  the KB owner every week of the pilot.
