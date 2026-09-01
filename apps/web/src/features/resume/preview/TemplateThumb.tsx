import type { TemplateDefinition } from "@workspace/resume-render"
import { cn } from "@workspace/ui/lib/utils"

const Bar = ({ w, color }: { w: string; color?: string }) => (
  <span
    className="block h-[2px] rounded-[1px] bg-border"
    style={{ width: w, ...(color ? { background: color } : {}) }}
  />
)

/**
 * The miniature page drawn on a template card. It is a schematic, not a render:
 * `twoColumn` and `ruledHeader` come from the template definition so the sketch
 * cannot drift from what the PDF actually produces.
 */
export function TemplateThumb({
  template,
  className,
}: {
  template: TemplateDefinition
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex aspect-[1/1.3] flex-col gap-[5px] rounded-[2px] border border-border bg-paper px-[6px] py-[7px]",
        className
      )}
    >
      <div
        className={cn(
          template.ruledHeader ? "pb-[5px]" : "pb-[2px]",
          template.ruledHeader && "border-b-[1.5px]"
        )}
        style={
          template.ruledHeader
            ? { borderBottomColor: template.accent }
            : undefined
        }
      >
        <span className="block h-[4px] w-[64%] rounded-[1px] bg-foreground" />
        <span className="mt-[3px] block h-[2px] w-[42%] rounded-[1px] bg-muted-foreground/60" />
      </div>

      <div className="flex min-h-0 flex-1 gap-[4px]">
        {template.twoColumn ? (
          <div className="flex w-[34%] flex-col gap-[2.5px]">
            <Bar w="80%" color={template.accent} />
            <Bar w="92%" />
            <Bar w="74%" />
          </div>
        ) : null}
        <div className="flex flex-1 flex-col gap-[2.5px]">
          <Bar w="34%" color={template.accent} />
          <Bar w="96%" />
          <Bar w="86%" />
          <Bar w="92%" />
        </div>
      </div>
    </div>
  )
}

/** The smaller sketch used on the resume cards in the left rail. */
export function ResumeThumb({ accent }: { accent: string }) {
  return (
    <div className="flex h-[52px] w-[38px] shrink-0 flex-col gap-[2.5px] rounded-[3px] border border-border bg-paper px-[5px] py-[6px]">
      <span className="block h-[3px] w-[70%] rounded-[1px] bg-foreground" />
      <span className="block h-[2px] w-[46%] rounded-[1px] bg-muted-foreground/60" />
      <span
        className="mt-[3px] block h-[2px] w-[34%] rounded-[1px]"
        style={{ background: accent }}
      />
      <Bar w="88%" />
      <Bar w="76%" />
      <Bar w="82%" />
    </div>
  )
}
