import type { ComponentProps } from "react"
import { Streamdown } from "streamdown"

type StreamdownComponents = NonNullable<
  ComponentProps<typeof Streamdown>["components"]
>

/**
 * Headings would blow out a 12.5px panel, so they keep the emphasis and lose
 * the scale.
 */
const Heading: StreamdownComponents["h1"] = ({ children }) => (
  <p className="font-semibold [&:not(:first-child)]:mt-2">{children}</p>
)

/**
 * Cut down to what reads in a narrow side panel. `img` and `hr` render nothing:
 * a model has no business emitting a remote URL the browser would then fetch,
 * and a rule across an 88%-width bubble is noise.
 */
const components: StreamdownComponents = {
  p: ({ children }) => (
    <p className="[&:not(:first-child)]:mt-1.5">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => (
    <ul className="list-disc pl-4 [&:not(:first-child)]:mt-1.5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-4 [&:not(:first-child)]:mt-1.5">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="mt-0.5">{children}</li>,
  code: ({ children }) => (
    <code className="rounded bg-canvas px-1 py-px font-mono text-[11.5px]">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-[7px] bg-canvas p-2 text-[11px] [&:not(:first-child)]:mt-1.5">
      {children}
    </pre>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="underline underline-offset-2"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-border border-l-2 pl-2 text-muted-foreground [&:not(:first-child)]:mt-1.5">
      {children}
    </blockquote>
  ),
  h1: Heading,
  h2: Heading,
  h3: Heading,
  h4: Heading,
  h5: Heading,
  h6: Heading,
  img: () => null,
  hr: () => null,
}

/**
 * Model-authored text, rendered as markdown.
 *
 * Streamdown rather than react-markdown because it closes unterminated marks
 * mid-stream: a half-arrived `**bold` renders bold instead of flashing literal
 * asterisks and snapping when the closing pair lands.
 *
 * `mode` is `static` by default, which is right for tool output (gaps, reasons,
 * the follow-up question) since those arrive whole. The streaming text part
 * passes `streaming`.
 */
export function MessageMarkdown({
  children,
  mode = "static",
}: {
  children: string
  mode?: "static" | "streaming"
}) {
  return (
    <Streamdown mode={mode} components={components}>
      {children}
    </Streamdown>
  )
}
