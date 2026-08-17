/**
 * 이미지로 평탄화한 페이지들을 하나의 PDF로 묶는다.
 *
 * 원본 PDF 객체를 복사하지 않고 JPEG 이미지만 새 PDF에 넣기 때문에
 * 텍스트·폼·주석·첨부파일이 결과 파일에 남지 않는다.
 */

function joinByteArrays(parts) {
  let totalLength = 0;
  parts.forEach(function (part) {
    totalLength += part.length;
  });

  const joined = new Uint8Array(totalLength);
  let offset = 0;
  parts.forEach(function (part) {
    joined.set(part, offset);
    offset += part.length;
  });
  return joined;
}

function createImageOnlyPdfBlob(pages) {
  if (!pages.length) {
    throw new Error("PDF로 만들 페이지가 없습니다.");
  }

  const encoder = new TextEncoder();
  const objectCount = 2 + pages.length * 3;
  const objects = new Array(objectCount + 1);
  const pageObjectIds = [];

  objects[1] = [encoder.encode("<< /Type /Catalog /Pages 2 0 R >>")];

  pages.forEach(function (page, index) {
    const pageObjectId = 3 + index * 3;
    const contentObjectId = pageObjectId + 1;
    const imageObjectId = pageObjectId + 2;
    pageObjectIds.push(pageObjectId);

    // 긴 변을 A4 세로 높이와 비슷한 842pt로 맞추고 원본 비율을 유지한다.
    const pointScale = 842 / Math.max(page.width, page.height);
    const pageWidth = Math.round(page.width * pointScale * 100) / 100;
    const pageHeight = Math.round(page.height * pointScale * 100) / 100;
    const content = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ`;

    objects[pageObjectId] = [encoder.encode(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
      `/Resources << /XObject << /Im0 ${imageObjectId} 0 R >> >> ` +
      `/Contents ${contentObjectId} 0 R >>`
    )];
    objects[contentObjectId] = [encoder.encode(
      `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}\nendstream`
    )];
    objects[imageObjectId] = [
      encoder.encode(
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
        `/Length ${page.jpegBytes.length} >>\nstream\n`
      ),
      page.jpegBytes,
      encoder.encode("\nendstream"),
    ];
  });

  objects[2] = [encoder.encode(
    `<< /Type /Pages /Count ${pages.length} /Kids [` +
    pageObjectIds.map((objectId) => `${objectId} 0 R`).join(" ") +
    "] >>"
  )];

  const outputParts = [encoder.encode("%PDF-1.4\n% image-only masked document\n")];
  const objectOffsets = new Array(objectCount + 1).fill(0);
  let byteOffset = outputParts[0].length;

  for (let objectId = 1; objectId <= objectCount; objectId++) {
    objectOffsets[objectId] = byteOffset;
    const objectParts = [
      encoder.encode(`${objectId} 0 obj\n`),
      ...objects[objectId],
      encoder.encode("\nendobj\n"),
    ];
    objectParts.forEach(function (part) {
      outputParts.push(part);
      byteOffset += part.length;
    });
  }

  const xrefOffset = byteOffset;
  let xref = `xref\n0 ${objectCount + 1}\n`;
  xref += "0000000000 65535 f \n";
  for (let objectId = 1; objectId <= objectCount; objectId++) {
    xref += `${String(objectOffsets[objectId]).padStart(10, "0")} 00000 n \n`;
  }
  xref +=
    `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;
  outputParts.push(encoder.encode(xref));

  return new Blob([joinByteArrays(outputParts)], { type: "application/pdf" });
}
