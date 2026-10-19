---
name: Sale remark independence and locking
description: User-defined ownership, copying and payment-lock rules for Sale and Master Nikasi remarks.
---

Sale remarks are independent per sale. A remark entered through Master Nikasi must initially be copied into every individual sale created by that submission; later changes to one must not automatically change the others.

**Why:** The user explicitly requested initial shared comments with no ongoing synchronization.

**How to apply:** Treat the Master Nikasi remark as a creation-time copy, not a live shared value. Keep it separate from lot remarks and payment notes.

Keep the existing lock on all sale edits once a payment is recorded, including remark edits.

**Why:** When asked whether to allow remark-only edits after payment, the user chose “Keep the existing lock on all sale edits.”

**How to apply:** Do not introduce a remark-only payment-lock exemption in the UI or API.
