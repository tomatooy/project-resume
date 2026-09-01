/**
 * Page counts each template must produce for each fixture, measured from real
 * renders. The template suite asserts against this table, so a layout change
 * that silently costs a page fails the build. `ledger` fitting `twoPage` on one
 * page is the point of that template, not an error.
 */
export const pageExpectations = {
  lisbon: {
    minimal: 1,
    starter: 1,
    onePage: 1,
    twoPage: 2,
    longBullets: 1,
    unicode: 1,
  },
  meridian: {
    minimal: 1,
    starter: 1,
    onePage: 1,
    twoPage: 2,
    longBullets: 1,
    unicode: 1,
  },
  plainsong: {
    minimal: 1,
    starter: 1,
    onePage: 1,
    twoPage: 2,
    longBullets: 1,
    unicode: 1,
  },
  harbor: {
    minimal: 1,
    starter: 1,
    onePage: 1,
    twoPage: 2,
    longBullets: 1,
    unicode: 1,
  },
  ledger: {
    minimal: 1,
    starter: 1,
    onePage: 1,
    twoPage: 1,
    longBullets: 1,
    unicode: 1,
  },
  atlas: {
    minimal: 1,
    starter: 1,
    onePage: 1,
    twoPage: 2,
    longBullets: 1,
    unicode: 1,
  },
} as const

export type ExpectationTemplateId = keyof typeof pageExpectations
export type FixtureName = keyof (typeof pageExpectations)["lisbon"]
