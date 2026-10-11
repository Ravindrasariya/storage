---
name: External VPS package portability
description: Replit-internal tarball URLs can make the same lockfile uninstallable on Hostinger.
---

Package tooling in the Replit environment can leave package-firewall.replit.internal tarball URLs in the lockfile. They are not reachable from the user's Hostinger production VPS.

**Why:** A production npm install failed resolving that internal host. The corresponding public npm packages were verified to have matching versions and integrity hashes.

**How to apply:** Before external deployment, check the final lockfile for internal URLs. Prefer verified public tarball URLs while preserving package versions and integrity hashes. Merely passing a public registry flag does not override an explicit internal tarball URL. Do not delete the lockfile or change production DNS to solve this.
