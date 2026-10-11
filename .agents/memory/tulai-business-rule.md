---
name: Tulai business rule
description: Difference between Tulai and Kata and the user's requirement to preserve Kata.
---

Tulai is manual weighing done by Himmal and is collected to be paid to Himmal. Kata is weighing done by a heavy machine and is income for the cold store owner.

Tulai is an optional sale charge; null means zero. The user wants the same downstream billing and calculation impacts as sale-level Kata, without changing Kata or anything associated with it.

**Why:** The user stated these business rules and explained that Tulai is currently managed through workarounds.

**How to apply:** Keep Tulai separate from Kata. Include its sale-charge effects throughout the relevant calculations and outputs, but do not assume it has Kata's income-only accounting treatment. Standalone Kata collections remain outside this feature's scope.
