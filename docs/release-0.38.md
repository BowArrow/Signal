# Signal 0.38: owned creative runtime and application branding

Signal can set up a private Windows ComfyUI engine from Creative studio. When an existing portable installation is found, setup copies its Python and core files into the Signal profile, excluding model weights, custom nodes, user data, input and output files. Existing weights remain reusable through an explicit model-path configuration. Editing or updating the original engine does not change Signal's copied engine. Removing the shared weights will still require restoring those model files.

Without a portable source, setup downloads the pinned official NVIDIA portable 0.34.0 release, checks its exact size and SHA-256, then extracts it into staging. Setup reports progress, supports cancellation, checks disk space, and activates only a completed installation. An interrupted or cancelled setup does not replace an existing engine. Managed setup currently targets Windows; the downloadable package targets NVIDIA. Other local servers remain an advanced option.

The owned engine uses port 8190 and keeps outputs and its ComfyUI profile inside Signal's user data. No browser or command window is launched. Manual and agent image jobs start the engine on demand after reserving the media lane. Running jobs on the private engine can be cancelled in Signal; external renderers remain protected from global interruption. Node execution errors appear in the job record. Shutdown stops the process Signal launched and records interrupted media rather than leaving an unowned background renderer.

The existing local H3 incident hold is unchanged. Engine ownership does not establish safe GPU rendering or lift the hold. The copied engine was checked in CPU mode only: memory supervision was enforced, the server listed 639 nodes, and no generation was submitted. Cold startup exceeded the original short probe, so automatic startup allows up to three minutes.

The existing purple broadcast mark is now a reusable SVG, a seven-resolution Windows ICO, a 512px application image, and a tray image. Windows executable, installer and uninstaller configuration, the window, sidebar, and renderer favicon all reference Signal assets. The macOS template tray remains monochrome; no macOS build was performed.

## Validation and installation boundary

- Full suite: 1,366 tests passed in 63 files before the final error-message and startup-window refinements. Final affected tests: 15 passed. Typecheck and targeted ESLint passed.
- Hidden source and packaged offline UI checked at 1440 by 900 and 720 by 800: loaded brand image and favicon, in-app setup, offline installation rejection, no horizontal overflow, no renderer exceptions. The packaged Windows executable's icon was extracted and visually checked.
- The owner-profile engine copy is prepared and its embedded Python starts. Its installation receipt retains the source model directory. The running owner's database/settings were not changed by preparation.
- Installing the update and selecting **Set up Signal engine** activates the prepared copy without another download. It does not start H3 or enable marketing spending.
- Paid acquisition execution remains unfinished. The preliminary Google Search adapter is not connected to Run and is not part of this release's usable capabilities. Funding controls from 0.37 do not launch ads.

## Primary implementation references

- [ComfyUI portable layout and extra model paths](https://docs.comfy.org/installation/comfyui_portable_windows)
- [Pinned official release](https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.34.0), with asset size and digest checked against its release API.
- Local reference: DnDRom `crates/local-runtime/src/lib.rs`, versioned installation, isolated startup and resource supervision. Signal keeps its own engine and database rather than changing DnDRom's runtime.
