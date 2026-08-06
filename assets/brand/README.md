# Brand asset contract

The approved source icon lives at `odoo-health-ext-cs-icon.svg`. It is an Odoo-purple letter O with
a green cross inside, presented on a pure-white square with softly rounded corners. The white base
keeps the mark legible across browser chrome, operating systems, and light or dark themes.

The packaging pipeline derives every browser and store PNG from this SVG and refuses a tagged
release when the source is missing. Review the generated 16 px and 128 px assets after every source
change.

The original parallel-design deliverables remain in `/icons` for provenance. Do not replace the
canonical SVG without product approval.
