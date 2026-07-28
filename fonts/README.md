# Fonts

`IBMPlexMono-subset.woff2` — IBM Plex Mono Regular, subset for this site.

- Upstream: https://github.com/IBM/plex (SIL Open Font License 1.1)
- Regenerate with the `pyftsubset` command in
  `docs/superpowers/plans/2026-07-28-v0-shell-and-spirit-level.md`, Task 7.
- Subset covers ASCII plus the degree sign, middle dot, dashes, curly quotes,
  ellipsis and minus sign.
- `tnum` (tabular figures) and `zero` (slashed zero) are retained deliberately:
  both are mandatory for every numeric readout on the site. `zero` is present
  as an OpenType GSUB feature in the subset. `tnum` is not present as a
  separate feature because IBM Plex Mono Regular is a fully monospaced
  design — every glyph, including all ten digits, already shares one advance
  width (600 units), so there is no proportional variant for `tnum` to
  substitute away. Tabular alignment is guaranteed structurally rather than
  via a swappable feature; `font-variant-numeric: tabular-nums` and
  `font-feature-settings: 'tnum' 1` in `css/site.css` remain in place as
  harmless, future-proof declarations.
