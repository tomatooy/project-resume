import { afterEach, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { Widget } from "../src/widget/Widget"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
it("opens the side panel only when the launcher is clicked", async () => {
  const sendMessage = vi.fn(async () => ({ ok: true }))
  vi.stubGlobal("chrome", { runtime: { sendMessage } })
  render(<Widget />)
  expect(sendMessage).not.toHaveBeenCalled()
  fireEvent.click(
    screen.getByRole("button", { name: "Open VS:Résumé side panel" })
  )
  await waitFor(() =>
    expect(sendMessage).toHaveBeenCalledWith({ type: "widget-open" })
  )
})
it("supports keyboard movement and hiding without opening the panel", () => {
  const post = vi
    .spyOn(window.parent, "postMessage")
    .mockImplementation(() => {})
  render(<Widget />)
  fireEvent.keyDown(
    screen.getByRole("button", { name: "Move widget up or down" }),
    { key: "ArrowDown" }
  )
  expect(post).toHaveBeenCalledWith(
    { type: "widget-move", delta: 24 },
    "https://www.linkedin.com"
  )
  expect(post).toHaveBeenCalledWith(
    { type: "widget-save" },
    "https://www.linkedin.com"
  )
  fireEvent.click(
    screen.getByRole("button", { name: "Hide widget for this tab" })
  )
  expect(post).toHaveBeenCalledWith(
    { type: "widget-dismiss" },
    "https://www.linkedin.com"
  )
})

it("drags vertically using screen coordinates and saves on release", () => {
  const post = vi
    .spyOn(window.parent, "postMessage")
    .mockImplementation(() => {})
  vi.stubGlobal("PointerEvent", MouseEvent)
  render(<Widget />)
  const handle = screen.getByRole("button", { name: "Move widget up or down" })
  Object.defineProperty(handle, "setPointerCapture", { value: vi.fn() })
  fireEvent.pointerDown(handle, { button: 0, screenY: 200 })
  fireEvent.pointerMove(handle, { screenY: 245 })
  fireEvent.pointerUp(handle)
  expect(post).toHaveBeenCalledWith(
    { type: "widget-move", delta: 45 },
    "https://www.linkedin.com"
  )
  expect(post).toHaveBeenCalledWith(
    { type: "widget-save" },
    "https://www.linkedin.com"
  )
})
