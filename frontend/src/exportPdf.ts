import html2canvas from "html2canvas";
import jsPDF from "jspdf";

/** Renders a DOM element to a (possibly multi-page) A4 PDF via html2canvas + jsPDF.
 *
 * jsPDF's built-in fonts have no Hebrew glyphs, so drawing Hebrew text directly with
 * `pdf.text()` renders blank/garbled — this rasterizes the element with the browser's
 * own text engine (html2canvas) and embeds the result as an image instead, which
 * sidesteps the font problem entirely at the cost of the PDF being an image, not
 * selectable text. Good enough for a summary report; not meant for huge tables. */
export async function exportElementToPdf(element: HTMLElement, filename: string) {
  const canvas = await html2canvas(element, { scale: 2, backgroundColor: "#ffffff" });
  const imgData = canvas.toDataURL("image/png");

  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = 0;

  pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
  heightLeft -= pageHeight;

  while (heightLeft > 0) {
    position -= pageHeight;
    pdf.addPage();
    pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
  }

  pdf.save(filename);
}
