import { useRef, useState } from "react"
import { Button } from "@workspace/ui/components/button"

function tellHost(message: object) {
  window.parent.postMessage(message, "https://www.linkedin.com")
}
export function Widget() {
  const drag = useRef<{ id: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState(false)
  const finish = () => {
    if (!drag.current) return
    drag.current = null
    setDragging(false)
    tellHost({ type: "widget-save" })
  }
  return (
    <div className="edge-widget" data-dragging={dragging}>
      <div className="edge-surface">
        <Button
          className="edge-open"
          aria-label="Open VS:Résumé side panel"
          title={
            error
              ? "Use the extension toolbar icon to open the panel"
              : "Open VS:Résumé"
          }
          onClick={() => {
            setError(false)
            void chrome.runtime.sendMessage({ type: "widget-open" }).then(
              (reply: unknown) =>
                setError(
                  typeof reply !== "object" ||
                    reply === null ||
                    !("ok" in reply) ||
                    reply.ok !== true
                ),
              () => setError(true)
            )
          }}
        >
          <img src="/icons/32.png" width={32} height={32} alt="" />
        </Button>
        <Button
          className="edge-drag edge-control"
          aria-label="Move widget up or down"
          title="Drag to move. Arrow keys also move the widget."
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.currentTarget.setPointerCapture(event.pointerId)
            drag.current = { id: event.pointerId, y: event.screenY }
            setDragging(true)
          }}
          onPointerMove={(event) => {
            if (!drag.current || drag.current.id !== event.pointerId) return
            tellHost({
              type: "widget-move",
              delta: event.screenY - drag.current.y,
            })
            drag.current.y = event.screenY
          }}
          onPointerUp={finish}
          onPointerCancel={finish}
          onLostPointerCapture={finish}
          onKeyDown={(event) => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
            event.preventDefault()
            tellHost({
              type: "widget-move",
              delta: event.key === "ArrowUp" ? -24 : 24,
            })
            tellHost({ type: "widget-save" })
          }}
        >
          <svg viewBox="0 0 16 24" width="16" height="24" aria-hidden="true">
            {[5, 12, 19].flatMap((cy) =>
              [4, 12].map((cx) => (
                <circle
                  key={`${cx}-${cy}`}
                  cx={cx}
                  cy={cy}
                  r="2"
                  fill="currentColor"
                />
              ))
            )}
          </svg>
        </Button>
      </div>
      <Button
        className="edge-close edge-control"
        aria-label="Hide widget for this tab"
        title="Hide for this tab. You can still open the panel from the toolbar."
        onClick={() => tellHost({ type: "widget-dismiss" })}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path
            d="m4 4 8 8M12 4l-8 8"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </Button>
      <span className="sr-only" role="status">
        {error
          ? "Could not open the panel. Use the extension toolbar icon."
          : ""}
      </span>
    </div>
  )
}
