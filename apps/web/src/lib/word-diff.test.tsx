import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { WordDiff } from "./word-diff"

describe("the word diff", () => {
  it("leaves the words both versions share unmarked", () => {
    const { container } = render(
      <WordDiff before="Shipped 3 things" after="Shipped 4 things" />
    )

    // Split into fragments rather than shown twice, which is the whole point
    // of a word diff over an old-to-new arrow.
    expect(screen.getByText("3")).toBeInTheDocument()
    expect(screen.getByText("4")).toBeInTheDocument()
    expect(container).toHaveTextContent("Shipped")
    expect(container).toHaveTextContent("things")
  })

  it("strikes the removed words through and highlights the added ones", () => {
    render(<WordDiff before="Led engineers" after="Led 6 engineers" />)

    expect(screen.getByText("6")).toHaveClass("bg-primary/14")
  })

  it("treats an empty side as an outright addition", () => {
    render(<WordDiff before="" after="A new summary." />)

    expect(screen.getByText("A new summary.")).toHaveClass("bg-primary/14")
  })
})
