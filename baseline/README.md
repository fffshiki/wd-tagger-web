# v18 recovery baseline

`v18-original.html` is a byte-for-byte copy of the supplied v18 HTML, before any changes.

This directory contains application source only. No user images, teacher JSON, imported dictionaries or outfit presets are included. Browser localStorage is not embedded in the HTML.

The Git tag `v18-baseline` records this recovery point. Export the original from Git using:

```powershell
git archive --format=zip --output=v18-recovery.zip v18-baseline baseline/
```

Keep the original Desktop HTML in place. Do not run a destructive reset to recover it.
