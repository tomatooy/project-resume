import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react"
import { cn } from "@workspace/ui/lib/utils"
import { useState } from "react"
import { useResumeState } from "../resume/session-context"
import { useTabScroll } from "../workspace/use-tab-scroll"

import {
  DEMO_QUESTIONS,
  INTERVIEW_FILTERS,
  type InterviewQuestion,
} from "./questions"

export function InterviewScreen() {
  const resumeId = useResumeState((s) => s.resumeId)
  const scroll = useTabScroll(`resume:${resumeId}:interview`)
  const [filter, setFilter] =
    useState<(typeof INTERVIEW_FILTERS)[number]>("All")
  const [openId, setOpenId] = useState<string | null>(
    DEMO_QUESTIONS[0]?.id ?? null
  )

  const questions = DEMO_QUESTIONS.filter(
    (question) => filter === "All" || question.category === filter
  )

  return (
    <div ref={scroll} className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto max-w-[820px] px-[26px] pt-[26px] pb-[110px]">
        <h2 className="font-heading text-[19px] font-semibold tracking-[-0.015em]">
          Interview prep
        </h2>
        <p className="mt-1.5 text-[12.5px] text-muted-foreground">
          Each question opens with a context, action and result outline: the
          shape of an answer, not the answer itself.
        </p>

        <p className="mt-3 mb-4 rounded-[9px] border border-dashed border-border px-3.5 py-2.5 text-[11.5px] leading-[1.5] text-muted-foreground">
          These four are a worked example. Generating questions from your own
          bullets needs an agent skill that is not built yet, so nothing here is
          drawn from the resume on the left.
        </p>

        <div className="mb-4 flex flex-wrap gap-2">
          {INTERVIEW_FILTERS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setFilter(option)}
              className={cn(
                "h-[29px] rounded-full border px-3 text-[12px] font-medium transition-colors",
                option === filter
                  ? "border-transparent bg-foreground text-background"
                  : "border-border bg-card text-foreground/80 hover:bg-muted"
              )}
            >
              {option}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2.5">
          {questions.map((question) => (
            <QuestionCard
              key={question.id}
              question={question}
              open={openId === question.id}
              onToggle={() =>
                setOpenId(openId === question.id ? null : question.id)
              }
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function QuestionCard({
  question,
  open,
  onToggle,
}: {
  question: InterviewQuestion
  open: boolean
  onToggle: () => void
}) {
  return (
    <div
      className={cn(
        "rounded-[10px] border bg-card transition-shadow",
        open
          ? "border-primary/35 shadow-[0_6px_20px_-14px] shadow-foreground/25"
          : "border-border"
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-[11px] px-4 py-3.5 text-left"
      >
        <span className="mt-px flex-none rounded-[5px] bg-muted px-2 py-1 text-[10px] font-bold tracking-[0.04em] text-primary-text uppercase">
          {question.category}
        </span>
        <span className="flex-1 text-[13.5px] leading-[1.45] font-semibold tracking-[-0.01em] text-pretty">
          {question.text}
        </span>
        <span className="mt-[3px] w-3 flex-none text-center text-muted-foreground">
          {open ? (
            <CaretUpIcon className="size-3" />
          ) : (
            <CaretDownIcon className="size-3" />
          )}
        </span>
      </button>

      {open ? (
        <div className="flex flex-col gap-2.5 px-4 pb-4">
          {question.beats.map((beat) => (
            <div
              key={beat.label}
              className="flex items-start gap-3 border-t border-border pt-[11px]"
            >
              <span className="mt-0.5 w-[58px] flex-none text-[10.5px] font-bold tracking-[0.04em] text-primary-text uppercase">
                {beat.label}
              </span>
              <span className="flex-1 text-[12.5px] leading-[1.55] text-pretty">
                {beat.text}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
