# VigilTech desktop release

The latest published v0.1.5 still targets the previous Cohnsoft commit. The rebrand pipeline built six new packages but retained the already-published version instead of replacing it. Publish version 0.1.6 as a new release, preserving every existing installer basename and old release URL. Add Debian packages alongside the existing Linux AppImages; the six-platform smoke gate stays enabled and the publisher verifies all eight installers/checksums before publication.

App/bundle IDs, profile and project data, update feeds and published artifact filenames are unchanged. New .deb files are additional formats. macOS is ad-hoc signed unless real Developer ID/notarization credentials are configured; Windows installers are unsigned. Existing upstream notices stay bundled. No old release is overwritten.
