# Parallel PDF Viewer

A static web page that shows several PDFs side by side. No server code,
no build step. Upload these files to any static host.

## Files
- `index.html` - the page; edit the `window.PARALLEL` block to list your PDFs
- `viewer.js`, `viewer.css` - the viewer itself
- `docs/` - put your PDFs here

## Adding PDFs
1. Copy the PDFs into `docs/`.
2. List each one in `index.html`:
   `{ title: "Report A", src: "docs/report-a.pdf" },`
3. Upload the folder again.

With an empty list, visitors can still use **Add PDF** or drag files onto
the page. Those files open in the visitor's own browser and are never
uploaded anywhere.

## Hosting on GitHub Pages
1. Create a new public repository on GitHub and upload the contents of
   this folder (index.html at the top level).
2. Repository Settings > Pages > deploy from the main branch, root folder.
3. The site appears at https://<username>.github.io/<repository>/

Netlify (drag the folder onto app.netlify.com/drop), Cloudflare Pages
and Vercel work the same way.

## Putting it inside an existing site
Host the folder somewhere, then embed it with:

    <iframe src="https://your-site/parallel-pdf-viewer/" style="width:100%;height:85vh;border:0"></iframe>

PDFs listed in `docs` must be on the same site as the page (or on a host
that allows cross-origin requests). Opening `index.html` straight from
your computer (file://) won't load listed PDFs; use a host, or run
`python -m http.server` in the folder and visit http://localhost:8000.
