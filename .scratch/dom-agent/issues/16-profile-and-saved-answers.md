# 16: Profile and saved answers in the web app

**What to build:** The account-level surfaces for the new question identity, so a company-specific answer can be kept and reused without anyone adding an enum member.

**Blocked by:** 08

**Status:** ready-for-agent

- [ ] A saved answer can be created, reloaded, edited and deleted with no concept enumeration involved anywhere in the path.
- [ ] Saving for reuse requires an explicit scope, and an unknown scope prevents saving for reuse and says why.
- [ ] Legacy rows remain readable, and an unsafe match stays visible for the user to resolve.
- [ ] Profile preserves unknown versus explicit yes or no, and unanswered versus answered versus decline.
- [ ] Salary is stored as amount, currency and period separately, and the control receives the numeric representation rather than a display string.
- [ ] Work authorization keeps its country and time scope.
