// Sets window.pdfjsLib for holdings-import.js to use (Task 10.3HD).
// Pulled out of an inline <script type="module"> in register.html so the
// page's Content-Security-Policy can allow it via script-src 'self' - an
// external, same-origin file needs no inline-script hash or 'unsafe-inline'.
import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
window.pdfjsLib = pdfjsLib;
