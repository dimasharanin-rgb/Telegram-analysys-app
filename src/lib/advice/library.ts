/**
 * Written-in-advance guidance, free of any model call.
 *
 * Most of what someone wants from an advice page is not specific to their
 * conversation - "how do I start a difficult conversation" has a good answer
 * that does not require reading anyone's messages. Answering those from a
 * library rather than from the model makes the free tier genuinely useful
 * and keeps the metered requests for the thing only the model can do:
 * applying this to the exchange in front of you.
 *
 * Written to the same rules as the rest of the product - concrete, short, no
 * therapy-speak, no promises about outcomes. These are options, not
 * instructions, and none of them claims to know the other person.
 */

export interface AdviceTopic {
  id: string;
  title: string;
  /** One line, shown in the list. */
  summary: string;
  /** What to actually do, in order. */
  steps: string[];
  /** Phrasings that tend to make it harder. */
  avoid: string[];
  /** A concrete opener someone can adapt. */
  example: string;
}

export const ADVICE_LIBRARY: AdviceTopic[] = [
  {
    id: "difficult-conversation",
    title: "Starting a difficult conversation",
    summary: "Open it so the other person can answer rather than defend.",
    steps: [
      "Say what it is about in the first sentence, so they are not braced for something worse.",
      "Pick a moment neither of you is about to leave. A hard subject raised at the door gets a hurried answer.",
      "Name one thing, not a list. A list reads as a case being made.",
      "Say what you want out of the conversation — to understand, to decide, to be heard.",
    ],
    avoid: [
      "\"We need to talk\" with no subject: it buys dread without buying clarity.",
      "Opening with a question you already know the answer to.",
      "Stacking several grievances into one message.",
    ],
    example:
      "Can we talk about the money side of the move this evening? I'd rather sort it together than keep circling it.",
  },
  {
    id: "apologising",
    title: "Apologising",
    summary: "Name the specific thing, without attaching a defence to it.",
    steps: [
      "Say what you did, in their terms rather than yours.",
      "Leave out the reason it happened unless they ask. An explanation next to an apology reads as a defence.",
      "Say what you will do differently, only if you mean it.",
      "Then stop. An apology that continues becomes a request for reassurance.",
    ],
    avoid: [
      "\"I'm sorry you felt…\" — that apologises for their reaction, not your part.",
      "\"…but you also…\" — anything after the \"but\" is the actual message.",
      "Apologising repeatedly for the same thing, which moves the burden to them.",
    ],
    example:
      "I'm sorry I said that about your job. It wasn't fair and I'd taken a bad day out on you.",
  },
  {
    id: "boundary",
    title: "Setting a boundary",
    summary: "State what you will do, not what they must stop doing.",
    steps: [
      "Describe the specific behaviour, not the character behind it.",
      "Say what you will do about it — that part is yours to decide and does not need their agreement.",
      "Keep it short. A boundary explained at length invites negotiation.",
      "Expect it to be tested once. Repeating it calmly is the whole method.",
    ],
    avoid: [
      "Framing it as an ultimatum you are not prepared to follow through on.",
      "Explaining it so thoroughly that it becomes a request for permission.",
      "Delivering it in the middle of an argument, when it will be heard as a threat.",
    ],
    example:
      "I'm not going to keep talking about this after midnight — I stop making sense. I'll pick it up tomorrow.",
  },
  {
    id: "clarification",
    title: "Asking for clarification",
    summary: "Ask about the message, not about their motive.",
    steps: [
      "Quote or describe the specific thing you are unsure about.",
      "Say what you took it to mean, so they can correct the reading rather than restate the message.",
      "Ask one question. Two questions get you an answer to the easier one.",
    ],
    avoid: [
      "\"What did you mean by that?\" with no reading offered — it lands as an accusation.",
      "Guessing at their intent out loud before they have answered.",
    ],
    example:
      "When you said you'd sort it — did you mean this week, or after the trip? I read it as this week and I'd rather check.",
  },
  {
    id: "de-escalating",
    title: "De-escalating an argument",
    summary: "Slow it down before trying to solve it.",
    steps: [
      "Answer the calmest thing they said, not the sharpest.",
      "Say one thing you agree with, if there genuinely is one.",
      "Shorten your messages. Length reads as pressure when tempers are up.",
      "Offer a pause with a return time attached, so it is not read as walking out.",
    ],
    avoid: [
      "Correcting the record mid-argument. Accuracy does not cool anything down.",
      "\"Calm down\" in any of its forms.",
      "Bringing in a second, older grievance as support.",
    ],
    example:
      "I think we're both too wound up for this to go anywhere good. Can we come back to it after dinner?",
  },
  {
    id: "silence",
    title: "Responding to silence",
    summary: "Ask once, plainly, and say what you will do next.",
    steps: [
      "Give it longer than feels comfortable — people are busy more often than they are angry.",
      "Send one message, not a sequence. A sequence answers itself.",
      "Say what you are assuming and invite a correction.",
      "Say what you will do if you do not hear back, then do that.",
    ],
    avoid: [
      "A follow-up that is only \"?\" — it asks for an account of themselves.",
      "Reading the silence aloud as a verdict on the relationship.",
      "Escalating across channels to get a reply.",
    ],
    example:
      "No rush on this — I'm assuming you're flat out. If I don't hear by Friday I'll book the later slot and we can change it.",
  },
  {
    id: "recurring-issue",
    title: "Discussing something that keeps coming back",
    summary: "Talk about the pattern, not this instance of it.",
    steps: [
      "Say that it has happened before, without producing the full list of occasions.",
      "Describe what happens, in sequence, as neutrally as you can manage.",
      "Ask what they notice about it — a pattern needs two readings to be worth anything.",
      "Agree on one thing to change, not a new arrangement for everything.",
    ],
    avoid: [
      "\"You always\" and \"you never\" — both invite a search for the counterexample.",
      "Producing evidence. It turns a conversation into a hearing.",
    ],
    example:
      "I've noticed we keep ending up here whenever plans change late. I don't think either of us is doing it on purpose — can we work out what to do differently?",
  },
  {
    id: "ending-respectfully",
    title: "Ending a conversation respectfully",
    summary: "Close it deliberately instead of letting it trail off.",
    steps: [
      "Say that you are stopping, rather than going quiet.",
      "Summarise anything you actually agreed, in one line.",
      "Name what is still open, so it is not mistaken for settled.",
      "Say when you will come back to it, if you will.",
    ],
    avoid: [
      "Leaving on the last sharp thing said.",
      "\"Fine.\" and its relatives, which end the conversation without ending the subject.",
    ],
    example:
      "Let's leave it there for tonight. We've agreed on the dates; the money side is still open. I'll come back to it on Sunday.",
  },
];

export function getAdviceTopic(id: string): AdviceTopic | null {
  return ADVICE_LIBRARY.find((topic) => topic.id === id) ?? null;
}
