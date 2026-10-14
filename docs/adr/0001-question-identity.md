# Question identity is deterministic and scope-explicit

A saved answer has to find its question again on a different application, but
everything a page offers for identification is transient or non-unique: DOM ids
that get recycled, generated class names, accessible names that repeat across
rows, and browser node handles that die with the document. We decided a
question's persistent identity is a deterministic key over its normalized
wording, kind, explicit scope (country, employer, time, currency and period,
record where relevant), and option signature. No part of it is authored by the
model, and no browser reference is ever persisted as identity. The alternatives
were letting the reasoner name the question, which makes identity change silently
whenever the model or prompt changes, and extending the existing closed concept
enumeration, which cannot represent company-specific questions and is precisely
what this redesign removes.

## Consequences

- Legacy `autofill_scoped_answers` rows carry `Concept` plus `AnswerMeaning` and
  `AnswerConditions`, a different vocabulary. They are mapped into the new shape
  when read. A row that cannot be matched safely stays visible for the user to
  resolve rather than being deleted or generalized.
- Two questions that a person would call "the same question" but that differ in
  scope produce two keys, which is the intended behaviour: scope is meaning.
- Any future change to the normalization or to the scope dimensions is a
  migration, not a refactor, because it re-keys stored answers.
