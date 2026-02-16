import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export async function extractTextFromPdf(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;
  let fullText = '';
  const rawParts = [];
  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const items = content.items.filter((x) => x.str != null);
    rawParts.push(items.map((x) => x.str).join(' '));
    const byLine = {};
    items.forEach((item) => {
      const y = item.transform ? item.transform[5] : 0;
      const x = item.transform ? item.transform[4] : 0;
      const key = Math.round(y);
      if (!byLine[key]) byLine[key] = [];
      byLine[key].push({ str: item.str, x });
    });
    let lineKeys = Object.keys(byLine).map(Number).sort((a, b) => b - a);
    // Merge lines that are very close (same table row with different Y)
    const tol = 8;
    const bands = [];
    for (let i = 0; i < lineKeys.length; i++) {
      const band = [lineKeys[i]];
      while (i + 1 < lineKeys.length && lineKeys[i] - lineKeys[i + 1] <= tol) {
        i++;
        band.push(lineKeys[i]);
      }
      bands.push(band);
    }
    let lines = bands.map((band) => {
      const all = band.flatMap((k) => byLine[k]).sort((a, b) => a.x - b.x);
      return all.map((i) => i.str).join(' ');
    });
    // Merge "Total" line with next line when next line is only a $ amount or digits (table row split)
    const merged = [];
    for (let j = 0; j < lines.length; j++) {
      const line = lines[j].trim();
      const next = (lines[j + 1] || '').trim();
      const nextIsAmount = /^\$?\s*[\d,]+\.\d{1,2}\s*$/.test(next) || /^[\d,]+\.\d{1,2}\s*$/.test(next) || /^₪?\s*[\d,]+\.\d{1,2}\s*$/.test(next);
      if (nextIsAmount && /(?:Total|סך הכל|סה״כ|סיכום|סכום לתשלום)/i.test(line)) {
        const amountPart = (next.startsWith('$') || next.trim().startsWith('₪')) ? next : '$ ' + next;
        merged.push(line + ' ' + amountPart);
        j++;
      } else {
        merged.push(lines[j]);
      }
    }
    fullText += merged.join('\n') + '\n';
  }
  return { text: fullText, textRaw: rawParts.join(' ').trim(), numPages };
}
