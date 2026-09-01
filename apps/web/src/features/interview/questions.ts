export type InterviewCategory = "Behavioral" | "Craft" | "Systems"

export type InterviewQuestion = {
  id: string
  category: InterviewCategory
  text: string
  beats: { label: "Context" | "Action" | "Result"; text: string }[]
}

/**
 * Fixed content, not generated.
 *
 * Interview prep appears in the design but has no schema, skill or server
 * function behind it in either spec. Rather than fake a generator, this ships
 * as a worked example of the format so the screen is real and honest. Replacing
 * this array with a `generateQuestions` server function is the whole change.
 */
export const DEMO_QUESTIONS: InterviewQuestion[] = [
  {
    id: "q1",
    category: "Behavioral",
    text: "Walk me through a redesign you led end to end.",
    beats: [
      {
        label: "Context",
        text: "Name the metric that was stuck, how long it had been stuck, and who owned it before you.",
      },
      {
        label: "Action",
        text: "Say what you cut, not just what you added. Interviewers hear a hundred people who added things.",
      },
      {
        label: "Result",
        text: "Give the before and after, and say how long it held. A number that moved for one week is a different story.",
      },
    ],
  },
  {
    id: "q2",
    category: "Systems",
    text: "How did you get other teams to adopt your design system?",
    beats: [
      {
        label: "Context",
        text: "How many components, how many teams, and what were the holdouts doing instead?",
      },
      {
        label: "Action",
        text: "Adoption is a migration problem. Talk about the tooling and the office hours, not the component count.",
      },
      {
        label: "Result",
        text: "Percentage of new surfaces on the system beats total components shipped.",
      },
    ],
  },
  {
    id: "q3",
    category: "Craft",
    text: "Tell me about a decision where research changed your mind.",
    beats: [
      {
        label: "Context",
        text: "State the assumption you held, and say plainly that you held it.",
      },
      {
        label: "Action",
        text: "What did you run, with how many people, and what did you drop as a result?",
      },
      {
        label: "Result",
        text: "The strongest version names something you killed, not only something you built.",
      },
    ],
  },
  {
    id: "q4",
    category: "Behavioral",
    text: "Tell me about a time you disagreed with an engineering lead.",
    beats: [
      {
        label: "Context",
        text: "Describe the disagreement as a tradeoff, not as a person being wrong.",
      },
      {
        label: "Action",
        text: "Show how you made the disagreement testable rather than louder.",
      },
      {
        label: "Result",
        text: "Say what shipped, and be willing to say if the other position was partly right.",
      },
    ],
  },
]

export const INTERVIEW_FILTERS = [
  "All",
  "Behavioral",
  "Craft",
  "Systems",
] as const
