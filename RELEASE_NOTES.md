## What's new in v0.2.15

- Screen recording now works the way it was meant to: press the video button, drag the area you want to record, talk through what you're showing, and press ■ in ContextBrain when you're done. Esc in the picker cancels.
- Under the hood the app no longer relies on macOS's video recorder (which has no area picker and can't be stopped cleanly): it snaps the selected area once a second and records your voice, then keeps the moments where the screen changed plus a transcript of what you said.
